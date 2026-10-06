// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Chainlink price feed (push oracle).
interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @notice Mirai's invest strategy: every invest pocket of every saver holds its own basket of coins,
///         either following the Smart Money weights (set daily by the curator from Nansen) or a mix the
///         saver picked. A basket is keyed by (saver, pocket id).
/// @dev Testnet has no AUSD liquidity for these coins, so deposits "buy" basket units at the price and
///      the vault's AUSD backs withdrawals (gains above deposits come from a reserve the operator tops
///      up; losses stay here). Blue chips are priced by Chainlink; coins without a feed (MON, Monad
///      memecoins) by prices the curator pushes from DEX data. On mainnet buys/sells become Kuru swaps.
///      There is no allocation cap: a saver may go all-in on a memecoin; the app makes the risk explicit.
contract BasketVault {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;

    struct Asset {
        string symbol;
        /// @dev Chainlink feed, or zero for a curator-priced coin.
        IPriceFeed feed;
        bool meme;
    }

    struct Holder {
        /// @dev false: follows the Smart Money weights.
        bool custom;
        /// @dev Smart Money epoch the basket was last weighted at (followers re-weight lazily).
        uint64 epoch;
    }

    IERC20 public immutable asset;
    address public immutable curator;
    uint256 private immutable _scale; // asset units -> 18-decimal USD
    address public mirai;

    Asset[] private _assets;
    mapping(uint256 => uint256) private _curatorPrice; // 18-decimal USD
    uint64 public pricesUpdatedAt;
    uint16[] private _smartWeights;
    uint64 public smartEpoch;

    mapping(bytes32 => Holder) private _holders;
    mapping(bytes32 => uint16[]) private _customWeights;
    mapping(bytes32 => mapping(uint256 => uint256)) private _units; // 18 decimals
    mapping(uint256 => uint256) private _totalUnits;

    event AssetAdded(uint256 indexed id, string symbol, address feed, bool meme);
    event PricesSet(uint256[] ids, uint256[] prices);
    event SmartWeightsSet(uint64 epoch, uint16[] weights);
    event WeightsSet(address indexed user, uint256 indexed pocket, bool custom, uint16[] weights);
    event Deposited(address indexed user, uint256 indexed pocket, uint256 amount);
    event Withdrawn(address indexed user, uint256 indexed pocket, uint256 amount);

    error Unauthorized();
    error AlreadyInitialized();
    error InvalidWeights();
    error InvalidPrice();
    error InsufficientValue();

    modifier onlyCurator() {
        if (msg.sender != curator) revert Unauthorized();
        _;
    }

    modifier onlyMirai() {
        if (msg.sender != mirai) revert Unauthorized();
        _;
    }

    constructor(IERC20 asset_, address curator_) {
        asset = asset_;
        curator = curator_;
        _scale = 10 ** (18 - IERC20Metadata(address(asset_)).decimals());
    }

    /// @notice Links the Mirai contract that deposits and withdraws for savers (once).
    function initMirai(address mirai_) external onlyCurator {
        if (mirai != address(0)) revert AlreadyInitialized();
        mirai = mirai_;
    }

    // ─── Curator ─────────────────────────────────────────────────────────────

    function addAsset(string calldata symbol, IPriceFeed feed, bool meme) external onlyCurator {
        _assets.push(Asset(symbol, feed, meme));
        _smartWeights.push(0);
        emit AssetAdded(_assets.length - 1, symbol, address(feed), meme);
    }

    /// @notice Prices (18-decimal USD) for coins without a Chainlink feed.
    function setPrices(uint256[] calldata ids, uint256[] calldata newPrices) external onlyCurator {
        if (ids.length != newPrices.length) revert InvalidPrice();
        for (uint256 i; i < ids.length; ++i) {
            if (address(_assets[ids[i]].feed) != address(0) || newPrices[i] == 0) revert InvalidPrice();
            _curatorPrice[ids[i]] = newPrices[i];
        }
        pricesUpdatedAt = uint64(block.timestamp);
        emit PricesSet(ids, newPrices);
    }

    /// @notice Smart Money weights; followers move to them on their next action (or `sync`).
    function setSmartWeights(uint16[] calldata weights) external onlyCurator {
        _validate(weights);
        _smartWeights = weights;
        smartEpoch++;
        emit SmartWeightsSet(smartEpoch, weights);
    }

    // ─── Savers ──────────────────────────────────────────────────────────────

    /// @notice Picks a pocket's mix (one bps weight per asset, summing to 10,000), or follows Smart Money
    ///         when `weights` is empty. The pocket's basket is re-weighted at today's prices; value is kept.
    function setWeights(address user, uint256 pocket, uint16[] calldata weights) external {
        if (msg.sender != user) revert Unauthorized();
        bytes32 k = _key(user, pocket);
        Holder storage h = _holders[k];
        if (weights.length == 0) {
            h.custom = false;
            delete _customWeights[k];
        } else {
            _validate(weights);
            h.custom = true;
            _customWeights[k] = weights;
        }
        h.epoch = smartEpoch;
        _rebalance(k);
        emit WeightsSet(user, pocket, h.custom, weightsOf(user, pocket));
    }

    /// @notice Moves a Smart Money follower to the latest weights. Anyone may call it.
    function sync(address user, uint256 pocket) public {
        _sync(_key(user, pocket));
    }

    // ─── Mirai ───────────────────────────────────────────────────────────────

    function deposit(address user, uint256 pocket, uint256 amount) external onlyMirai {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        bytes32 k = _key(user, pocket);
        _sync(k);
        _buy(k, amount);
        emit Deposited(user, pocket, amount);
    }

    function withdraw(address user, uint256 pocket, uint256 amount, address to) external onlyMirai {
        bytes32 k = _key(user, pocket);
        _sync(k);
        uint256 value = _value(k);
        if (amount == 0 || amount > value) revert InsufficientValue();
        // sell the withdrawn fraction of every coin, rounding up so leftovers never overstate value
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 u = _units[k][i];
            if (u == 0) continue;
            uint256 sold = Math.min(Math.mulDiv(u, amount, value, Math.Rounding.Ceil), u);
            _units[k][i] = u - sold;
            _totalUnits[i] -= sold;
        }
        asset.safeTransfer(to, amount);
        emit Withdrawn(user, pocket, amount);
    }

    /// @notice Sells the pocket's whole basket at current prices; returns the AUSD paid out.
    function withdrawAll(address user, uint256 pocket, address to) external onlyMirai returns (uint256 amount) {
        bytes32 k = _key(user, pocket);
        amount = _value(k);
        _clear(k);
        if (amount != 0) {
            asset.safeTransfer(to, amount);
            emit Withdrawn(user, pocket, amount);
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assets() external view returns (Asset[] memory) {
        return _assets;
    }

    function smartWeights() external view returns (uint16[] memory) {
        return _smartWeights;
    }

    function holder(address user, uint256 pocket) external view returns (Holder memory) {
        return _holders[_key(user, pocket)];
    }

    /// @notice The weights a pocket's basket is held at (custom, or Smart Money), one per asset.
    function weightsOf(address user, uint256 pocket) public view returns (uint16[] memory) {
        return _weights(_key(user, pocket));
    }

    function unitsOf(address user, uint256 pocket) external view returns (uint256[] memory u) {
        bytes32 k = _key(user, pocket);
        u = new uint256[](_assets.length);
        for (uint256 i; i < u.length; ++i) {
            u[i] = _units[k][i];
        }
    }

    /// @notice 18-decimal USD prices; zero for a curator-priced coin that has no price yet.
    function prices() external view returns (uint256[] memory p) {
        p = new uint256[](_assets.length);
        for (uint256 i; i < p.length; ++i) {
            if (address(_assets[i].feed) != address(0) || _curatorPrice[i] != 0) p[i] = _price(i);
        }
    }

    /// @notice AUSD value of a pocket's basket at current prices.
    function valueOf(address user, uint256 pocket) external view returns (uint256) {
        return _value(_key(user, pocket));
    }

    /// @notice AUSD value of every basket together (Mirai reads it as the strategy's TVL).
    function totalAssets() external view returns (uint256 value) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 u = _totalUnits[i];
            if (u != 0) value += Math.mulDiv(u, _price(i), 1e18);
        }
        value /= _scale;
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    function _key(address user, uint256 pocket) private pure returns (bytes32) {
        return keccak256(abi.encode(user, pocket));
    }

    function _weights(bytes32 k) private view returns (uint16[] memory w) {
        if (!_holders[k].custom) return _smartWeights;
        uint16[] storage c = _customWeights[k];
        w = new uint16[](_assets.length);
        for (uint256 i; i < c.length; ++i) {
            w[i] = c[i];
        }
    }

    function _value(bytes32 k) private view returns (uint256 value) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 u = _units[k][i];
            if (u != 0) value += Math.mulDiv(u, _price(i), 1e18);
        }
        value /= _scale;
    }

    function _sync(bytes32 k) private {
        Holder storage h = _holders[k];
        if (h.custom || h.epoch == smartEpoch) return;
        h.epoch = smartEpoch;
        _rebalance(k);
    }

    function _buy(bytes32 k, uint256 amount) private {
        uint16[] memory w = _weights(k);
        uint256 usd = amount * _scale;
        uint256 sum;
        for (uint256 i; i < w.length; ++i) {
            sum += w[i];
            if (w[i] == 0) continue;
            uint256 u = Math.mulDiv(usd, uint256(w[i]) * 1e18, uint256(BPS) * _price(i));
            _units[k][i] += u;
            _totalUnits[i] += u;
        }
        // all-zero weights (Smart Money not set yet) would swallow the deposit: refuse instead
        if (sum == 0) revert InvalidWeights();
    }

    function _rebalance(bytes32 k) private {
        uint256 value = _value(k);
        _clear(k);
        if (value != 0) _buy(k, value);
    }

    function _clear(bytes32 k) private {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 u = _units[k][i];
            if (u == 0) continue;
            _totalUnits[i] -= u;
            _units[k][i] = 0;
        }
    }

    function _validate(uint16[] calldata weights) private view {
        if (weights.length != _assets.length) revert InvalidWeights();
        uint256 sum;
        for (uint256 i; i < weights.length; ++i) {
            sum += weights[i];
        }
        if (sum != BPS) revert InvalidWeights();
    }

    /// @dev 18-decimal USD. ponytail: no staleness check (a stale price must not block payments);
    ///      curator prices are refreshed by the Mirai server. Add a max age for mainnet.
    function _price(uint256 i) private view returns (uint256) {
        IPriceFeed feed = _assets[i].feed;
        if (address(feed) == address(0)) {
            uint256 p = _curatorPrice[i];
            if (p == 0) revert InvalidPrice();
            return p;
        }
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer) * 10 ** (18 - feed.decimals());
    }
}
