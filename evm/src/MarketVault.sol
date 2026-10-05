// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Chainlink price feed (push oracle: Chainlink keeps it fresh, nobody here pays for updates).
interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @notice Savings invested in a basket of market coins (ETH / BTC), weighted by what Nansen smart
///         money holds on Monad. Share value follows live Chainlink prices, so it can go down.
/// @dev Testnet has no AUSD liquidity for these coins, so a deposit "buys" basket units at the oracle
///      price instead of swapping, and the vault's AUSD backs withdrawals. Value above the AUSD the
///      vault holds is capped (the operator tops up a reserve); losses stay in the vault. On mainnet
///      `_buy`/`_sell` become swaps through a DEX (Kuru) and the vault holds the coins themselves.
///      AUSD sent here without minting shares does not change the share price (value comes from units).
contract MarketVault is ERC4626 {
    uint16 public constant BPS = 10_000;

    /// @notice Sets basket weights (the Mirai server, from Nansen smart-money holdings).
    address public immutable curator;
    uint256 private immutable _scale; // asset units -> 18-decimal USD

    IPriceFeed[] private _feeds;
    uint16[] private _weights;
    /// @dev Basket coin amounts, 18 decimals.
    uint256[] private _units;
    uint64 public rebalancedAt;

    event Rebalanced(uint16[] weights);

    error Unauthorized();
    error InvalidWeights();
    error InvalidPrice();

    constructor(IERC20 asset_, address curator_, IPriceFeed[] memory feeds_, uint16[] memory weights_)
        ERC20("Mirai Smart Money", "mrSMART")
        ERC4626(asset_)
    {
        curator = curator_;
        _scale = 10 ** (18 - IERC20Metadata(address(asset_)).decimals());
        _feeds = feeds_;
        _units = new uint256[](feeds_.length);
        _setWeights(weights_);
    }

    /// @notice Basket coins: Chainlink feeds, weights (bps), held units (18 decimals) and prices (18-decimal USD).
    function basket()
        external
        view
        returns (IPriceFeed[] memory feeds, uint16[] memory weights, uint256[] memory units, uint256[] memory prices)
    {
        prices = new uint256[](_feeds.length);
        for (uint256 i; i < _feeds.length; ++i) {
            prices[i] = _price(i);
        }
        return (_feeds, _weights, _units, prices);
    }

    /// @notice Market value of the basket in asset units, before the cap.
    function basketValue() public view returns (uint256 value) {
        for (uint256 i; i < _feeds.length; ++i) {
            value += Math.mulDiv(_units[i], _price(i), 1e18);
        }
        value /= _scale;
    }

    function totalAssets() public view override returns (uint256) {
        return Math.min(basketValue(), IERC20(asset()).balanceOf(address(this)));
    }

    /// @notice Re-weights the basket at current prices; total value is unchanged.
    function rebalance(uint16[] calldata weights) external {
        if (msg.sender != curator) revert Unauthorized();
        uint256 value = basketValue();
        _setWeights(weights);
        for (uint256 i; i < _feeds.length; ++i) {
            _units[i] = 0;
        }
        _buy(value);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        _buy(assets);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        // Sell the withdrawn fraction of every coin, rounding up so leftover units never overstate value.
        uint256 total = totalAssets();
        for (uint256 i; total != 0 && i < _feeds.length; ++i) {
            uint256 sold = Math.mulDiv(_units[i], assets, total, Math.Rounding.Ceil);
            _units[i] -= Math.min(sold, _units[i]);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _buy(uint256 assets) private {
        uint256 usd = assets * _scale;
        for (uint256 i; i < _feeds.length; ++i) {
            _units[i] += Math.mulDiv(usd, uint256(_weights[i]) * 1e18, uint256(BPS) * _price(i));
        }
    }

    function _setWeights(uint16[] memory weights) private {
        if (weights.length != _feeds.length) revert InvalidWeights();
        uint256 sum;
        for (uint256 i; i < weights.length; ++i) {
            sum += weights[i];
        }
        if (sum != BPS) revert InvalidWeights();
        _weights = weights;
        rebalancedAt = uint64(block.timestamp);
        emit Rebalanced(weights);
    }

    /// @dev 18-decimal USD price. ponytail: no staleness check (a stale price must not block payments;
    ///      Chainlink's heartbeat is 24h with a 0.5% deviation trigger). Add a max age for mainnet.
    function _price(uint256 i) private view returns (uint256) {
        IPriceFeed feed = _feeds[i];
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer) * 10 ** (18 - feed.decimals());
    }

    /// @dev Same virtual-share offset as MiraiVault: shares carry 12 decimals.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
