// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Optional yield source attached to a strategy vault (a YieldStreamer on testnet).
interface IYieldSource {
    function drip() external returns (uint256);
}

/// @dev Per-pocket coin baskets for invest pockets (BasketVault), keyed by (saver, pocket id).
interface IBasket {
    function deposit(address user, uint256 pocket, uint256 amount) external;
    function withdraw(address user, uint256 pocket, uint256 amount, address to) external;
    function withdrawAll(address user, uint256 pocket, address to) external returns (uint256);
    function valueOf(address user, uint256 pocket) external view returns (uint256);
}

/// @notice Splits every incoming payment into a spendable balance and savings, and spreads savings over
///         up to ten pockets ("Laptop", "PS5", ...) at fixed percentages. Each pocket has its own
///         strategy: a yield vault (shares of one of three ERC-4626 vaults) or an invest basket of
///         coins (BasketVault), its own optional lock, and an opaque, passkey-encrypted name/target.
contract Mirai {
    using SafeERC20 for IERC20;

    struct Pocket {
        /// @dev Share of every incoming savings slice; all open pockets sum to 10,000.
        uint16 shareBps;
        /// @dev 0-2 yield vault, 3 invest basket.
        uint8 strategy;
        bool open;
        uint64 lockUntil;
        /// @dev Yield vault shares (yield strategies only).
        uint128 shares;
    }

    struct Account {
        uint16 splitBps;
        uint128 spend;
    }

    /// @dev `pocketsOf` row: `value` is what the pocket is worth now (vault shares or basket).
    struct PocketView {
        uint16 shareBps;
        uint8 strategy;
        bool open;
        uint64 lockUntil;
        uint128 shares;
        uint256 value;
        bytes meta;
    }

    /// @dev `accountOf` result; `savings` is the value of every pocket together.
    struct AccountView {
        uint16 splitBps;
        uint128 spend;
        uint256 savings;
        uint8 pocketCount;
    }

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBps();
    error AmountOverflow();
    error InsufficientSpendable();
    error InsufficientShares();
    error EmptyWithdrawal();
    error Unauthorized();
    error LockActive();
    error LockCannotShrink();
    error LockTooLong();
    error GoalTooLarge();
    error InvalidStrategy();
    error InvalidPocket();
    error TooManyPockets();
    error InvalidShares();

    uint16 public constant MAX_BPS = 10_000;
    uint16 public constant DEFAULT_SPLIT_BPS = 2_000;
    uint64 public constant MAX_LOCK_DURATION = 5 * 365 days;
    /// @dev Upper bound for a pocket's encrypted name/target blob (a Mera secret vault is ~300 bytes).
    uint256 public constant MAX_META_BYTES = 1024;
    uint8 public constant MAX_POCKETS = 10;
    /// @notice Strategies: 0 conservative, 1 balanced (default), 2 growth (yield vaults), 3 invest
    ///         (coin basket). Order is relied on by the web app.
    uint8 public constant YIELD_STRATEGIES = 3;
    uint8 public constant INVEST = 3;
    uint8 public constant DEFAULT_STRATEGY = 1;

    IERC20 public immutable asset;
    IERC4626[3] private _vaults;
    IYieldSource[3] private _yieldSources;
    IBasket public immutable basket;

    mapping(address => Account) private _accounts;
    mapping(address => bool) private _initialized;
    mapping(address => Pocket[]) private _pockets;
    /// @dev Opaque, client-side encrypted pocket name/emoji/target. Only ciphertext reaches the chain.
    mapping(address => mapping(uint256 => bytes)) private _meta;

    event PaymentRouted(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 spendAmount,
        uint256 savingsAmount,
        uint256 shares
    );
    event SpendWithdrawn(address indexed user, uint256 amount);
    event SplitSet(address indexed user, uint16 bps);
    event PocketCreated(address indexed user, uint256 indexed pocket, uint8 strategy);
    /// @notice A payment's savings slice landed in a pocket (per-pocket principal for the indexer).
    event PocketFunded(address indexed user, uint256 indexed pocket, uint256 amount);
    event PocketSharesSet(address indexed user, uint16[] bps);
    event PocketStrategySet(address indexed user, uint256 indexed pocket, uint8 strategy, uint256 moved);
    event PocketLockSet(address indexed user, uint256 indexed pocket, uint64 until);
    event PocketMetaSet(address indexed user, uint256 indexed pocket);
    event PocketWithdrawn(address indexed user, uint256 indexed pocket, uint256 amount);
    event PocketClosed(address indexed user, uint256 indexed pocket, uint256 indexed into, uint256 moved);

    /// @param vaults_ One ERC-4626 vault per yield strategy, all over the same asset.
    /// @param yieldSources_ Dripped before each deposit/withdrawal; zero for vaults that earn natively.
    /// @param basket_ The invest pockets' BasketVault (its `mirai` must be set to this contract).
    constructor(IERC4626[3] memory vaults_, IYieldSource[3] memory yieldSources_, IBasket basket_) {
        if (address(vaults_[0]) == address(0) || address(basket_) == address(0)) revert InvalidAddress();
        asset = IERC20(vaults_[0].asset());
        for (uint256 i; i < YIELD_STRATEGIES; ++i) {
            if (address(vaults_[i]) == address(0) || vaults_[i].asset() != address(asset)) revert InvalidAddress();
            _vaults[i] = vaults_[i];
            _yieldSources[i] = yieldSources_[i];
            asset.forceApprove(address(vaults_[i]), type(uint256).max);
        }
        basket = basket_;
        asset.forceApprove(address(basket_), type(uint256).max);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice The yield vaults and their yield sources, with the basket at index 3 (no yield source).
    function strategies() external view returns (address[4] memory vaults, address[4] memory yieldSources) {
        for (uint256 i; i < YIELD_STRATEGIES; ++i) {
            vaults[i] = address(_vaults[i]);
            yieldSources[i] = address(_yieldSources[i]);
        }
        vaults[INVEST] = address(basket);
    }

    function accountOf(address user) external view returns (AccountView memory out) {
        if (user == address(0)) revert InvalidAddress();
        PocketView[] memory pockets = pocketsOf(user);
        uint256 savings;
        for (uint256 i; i < pockets.length; ++i) {
            savings += pockets[i].value;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        out = AccountView({
            splitBps: _initialized[user] ? _accounts[user].splitBps : DEFAULT_SPLIT_BPS,
            spend: _accounts[user].spend,
            savings: savings,
            pocketCount: uint8(pockets.length)
        });
    }

    /// @notice Every pocket slot (closed ones too, flagged `open: false`); a fresh account shows the
    ///         default pocket it will get on first use: 100% of savings, balanced yield.
    function pocketsOf(address user) public view returns (PocketView[] memory out) {
        Pocket[] storage list = _pockets[user];
        if (list.length == 0) {
            out = new PocketView[](1);
            out[0] = PocketView(MAX_BPS, DEFAULT_STRATEGY, true, 0, 0, 0, "");
            return out;
        }
        out = new PocketView[](list.length);
        for (uint256 i; i < list.length; ++i) {
            Pocket memory p = list[i];
            out[i] =
                PocketView(p.shareBps, p.strategy, p.open, p.lockUntil, p.shares, _valueOf(user, i, p), _meta[user][i]);
        }
    }

    // ─── Payments & spending ─────────────────────────────────────────────────

    function pay(address from, address to, uint256 amount) external {
        _pay(from, to, amount);
    }

    /// @notice `pay` with an EIP-2612 permit, so the payer needs one transaction instead of two.
    function payWithPermit(address from, address to, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        // A front-run permit consumes the signature but still sets the allowance, so a failed
        // permit is ignored and transferFrom decides.
        try IERC20Permit(address(asset)).permit(from, address(this), amount, deadline, v, r, s) {} catch {}
        _pay(from, to, amount);
    }

    function withdrawSpend(address user, uint256 amount) external returns (uint256 withdrawn) {
        _auth(user);
        if (amount == 0) revert EmptyWithdrawal();
        Account storage acc = _account(user);
        if (amount > acc.spend) revert InsufficientSpendable();

        acc.spend -= _toUint128(amount);
        asset.safeTransfer(user, amount);
        emit SpendWithdrawn(user, amount);
        return amount;
    }

    function setSplit(address user, uint16 bps) external {
        _auth(user);
        if (bps > MAX_BPS) revert InvalidBps();
        _account(user).splitBps = bps;
        emit SplitSet(user, bps);
    }

    // ─── Pockets ─────────────────────────────────────────────────────────────

    /// @notice Opens a pocket with 0% of incoming savings (set shares with `setPocketShares`); reuses
    ///         a closed slot when there is one. Returns its id.
    function createPocket(address user, uint8 strategy, bytes calldata meta) external returns (uint256 id) {
        _auth(user);
        if (strategy > INVEST) revert InvalidStrategy();
        if (meta.length > MAX_META_BYTES) revert GoalTooLarge();
        _account(user);
        Pocket[] storage list = _pockets[user];
        id = list.length;
        for (uint256 i; i < list.length; ++i) {
            if (!list[i].open) {
                id = i;
                break;
            }
        }
        if (id == list.length) {
            if (list.length >= MAX_POCKETS) revert TooManyPockets();
            list.push();
        }
        list[id] = Pocket({shareBps: 0, strategy: strategy, open: true, lockUntil: 0, shares: 0});
        _meta[user][id] = meta;
        emit PocketCreated(user, id, strategy);
        emit PocketMetaSet(user, id);
    }

    /// @notice How incoming savings are spread: one bps per pocket slot, open slots summing to 10,000,
    ///         closed slots 0. Only future savings follow; existing balances stay where they are.
    function setPocketShares(address user, uint16[] calldata bps) external {
        _auth(user);
        _account(user);
        Pocket[] storage list = _pockets[user];
        if (bps.length != list.length) revert InvalidShares();
        uint256 sum;
        for (uint256 i; i < bps.length; ++i) {
            if (!list[i].open && bps[i] != 0) revert InvalidShares();
            sum += bps[i];
        }
        if (sum != MAX_BPS) revert InvalidShares();
        for (uint256 i; i < bps.length; ++i) {
            list[i].shareBps = bps[i];
        }
        emit PocketSharesSet(user, bps);
    }

    /// @notice Moves a pocket's money into another strategy (yield vault or invest basket). Allowed
    ///         while locked: the money stays in the pocket.
    function setPocketStrategy(address user, uint256 id, uint8 strategy) external {
        _auth(user);
        if (strategy > INVEST) revert InvalidStrategy();
        Pocket storage p = _openPocket(user, id);
        if (strategy == p.strategy) return;
        uint256 moved = _takeAll(user, id, p, address(this));
        p.strategy = strategy;
        if (moved != 0 && !_put(user, id, p, moved)) _account(user).spend += _toUint128(moved);
        emit PocketStrategySet(user, id, strategy, moved);
    }

    function setPocketMeta(address user, uint256 id, bytes calldata meta) external {
        _auth(user);
        if (meta.length > MAX_META_BYTES) revert GoalTooLarge();
        _openPocket(user, id);
        _meta[user][id] = meta;
        emit PocketMetaSet(user, id);
    }

    /// @notice Locks a pocket's withdrawals until `until` (extend-only, at most five years ahead).
    function setPocketLock(address user, uint256 id, uint64 until) external {
        _auth(user);
        if (until < block.timestamp) revert LockCannotShrink();
        if (until > block.timestamp + MAX_LOCK_DURATION) revert LockTooLong();
        Pocket storage p = _openPocket(user, id);
        if (until < p.lockUntil) revert LockCannotShrink();
        p.lockUntil = until;
        emit PocketLockSet(user, id, until);
    }

    /// @notice Withdraws `amount` of the asset from one pocket.
    function withdrawPocket(address user, uint256 id, uint256 amount) external returns (uint256) {
        _auth(user);
        if (amount == 0) revert EmptyWithdrawal();
        Pocket storage p = _openPocket(user, id);
        if (block.timestamp < p.lockUntil) revert LockActive();
        if (p.strategy == INVEST) {
            if (amount > basket.valueOf(user, id)) revert InsufficientShares();
            basket.withdraw(user, id, amount, user);
        } else {
            IERC4626 vault = _vaults[p.strategy];
            _drip(p.strategy);
            uint256 shares = vault.previewWithdraw(amount);
            if (shares > p.shares) revert InsufficientShares();
            p.shares -= _toUint128(shares);
            vault.withdraw(amount, user, address(this));
        }
        emit PocketWithdrawn(user, id, amount);
        return amount;
    }

    /// @notice Withdraws everything in one pocket at what it is worth when the transaction executes.
    /// @dev "Withdraw everything" must use this: an invest pocket's value can fall between reading it and
    ///      the transaction landing, so a fixed `withdrawPocket` amount could revert.
    function withdrawAllPocket(address user, uint256 id) external returns (uint256 amount) {
        _auth(user);
        Pocket storage p = _openPocket(user, id);
        if (block.timestamp < p.lockUntil) revert LockActive();
        amount = _takeAll(user, id, p, user);
        if (amount == 0) revert EmptyWithdrawal();
        emit PocketWithdrawn(user, id, amount);
    }

    /// @notice Closes a pocket: its money and its share of incoming savings move to pocket `into`.
    ///         A locked pocket can't be closed.
    function closePocket(address user, uint256 id, uint256 into) external {
        _auth(user);
        if (id == into) revert InvalidPocket();
        Pocket storage p = _openPocket(user, id);
        Pocket storage dest = _openPocket(user, into);
        if (block.timestamp < p.lockUntil) revert LockActive();
        uint256 moved = _takeAll(user, id, p, address(this));
        if (moved != 0 && !_put(user, into, dest, moved)) _account(user).spend += _toUint128(moved);
        dest.shareBps += p.shareBps;
        p.shareBps = 0;
        p.open = false;
        delete _meta[user][id];
        emit PocketClosed(user, id, into, moved);
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    function _pay(address from, address to, uint256 amount) private {
        if (to == address(0) || from == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (msg.sender != from) revert Unauthorized();

        Account storage acc = _account(to);
        asset.safeTransferFrom(from, address(this), amount);
        uint256 savings = (amount * acc.splitBps) / MAX_BPS;
        uint256 saved;
        uint256 minted;
        Pocket[] storage list = _pockets[to];
        uint256 left = savings;
        for (uint256 i; i < list.length && left != 0; ++i) {
            Pocket storage p = list[i];
            if (p.shareBps == 0) continue;
            // the last funded pocket takes the rounding remainder, so nothing is lost
            uint256 part = _isLastFunded(list, i) ? left : (savings * p.shareBps) / MAX_BPS;
            left -= part;
            uint128 before = p.shares;
            // a slice too small to become a vault share stays spendable instead
            if (part != 0 && _put(to, i, p, part)) {
                saved += part;
                minted += p.shares - before;
                emit PocketFunded(to, i, part);
            }
        }
        uint256 spendAmount = amount - saved;
        acc.spend += _toUint128(spendAmount);
        emit PaymentRouted(from, to, amount, spendAmount, saved, minted);
    }

    function _isLastFunded(Pocket[] storage list, uint256 i) private view returns (bool) {
        for (uint256 j = i + 1; j < list.length; ++j) {
            if (list[j].shareBps != 0) return false;
        }
        return true;
    }

    /// @dev Moves all of a pocket's money to `to`; returns the asset amount.
    function _takeAll(address user, uint256 id, Pocket storage p, address to) private returns (uint256) {
        if (p.strategy == INVEST) return basket.withdrawAll(user, id, to);
        uint256 shares = p.shares;
        if (shares == 0) return 0;
        _drip(p.strategy);
        p.shares = 0;
        return _vaults[p.strategy].redeem(shares, to, address(this));
    }

    /// @dev Puts `amount` (already held here) into a pocket's strategy; false if it is too small to
    ///      become a vault share (it would be donated to the vault).
    function _put(address user, uint256 id, Pocket storage p, uint256 amount) private returns (bool) {
        if (p.strategy == INVEST) {
            basket.deposit(user, id, amount);
            return true;
        }
        IERC4626 vault = _vaults[p.strategy];
        // Settle pending yield first, so a new deposit never buys shares at a stale (too low) price.
        _drip(p.strategy);
        if (vault.previewDeposit(amount) == 0) return false;
        p.shares += _toUint128(vault.deposit(amount, address(this)));
        return true;
    }

    function _valueOf(address user, uint256 id, Pocket memory p) private view returns (uint256) {
        if (p.strategy == INVEST) return basket.valueOf(user, id);
        return _vaults[p.strategy].convertToAssets(p.shares);
    }

    function _openPocket(address user, uint256 id) private returns (Pocket storage p) {
        _account(user);
        if (id >= _pockets[user].length || !_pockets[user][id].open) revert InvalidPocket();
        p = _pockets[user][id];
    }

    function _auth(address user) private view {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
    }

    /// @dev First touch sets the default split and opens pocket 0: 100% of savings, balanced yield.
    function _account(address user) private returns (Account storage acc) {
        acc = _accounts[user];
        if (!_initialized[user]) {
            _initialized[user] = true;
            acc.splitBps = DEFAULT_SPLIT_BPS;
            _pockets[user].push(
                Pocket({shareBps: MAX_BPS, strategy: DEFAULT_STRATEGY, open: true, lockUntil: 0, shares: 0})
            );
            emit PocketCreated(user, 0, DEFAULT_STRATEGY);
        }
    }

    /// @dev A failing yield source must never block payments or withdrawals.
    function _drip(uint8 strategy) private {
        IYieldSource source = _yieldSources[strategy];
        if (address(source) != address(0)) {
            try source.drip() {} catch {}
        }
    }

    function _toUint128(uint256 x) private pure returns (uint128) {
        if (x > type(uint128).max) revert AmountOverflow();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(x);
    }
}
