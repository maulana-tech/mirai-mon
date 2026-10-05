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

/// @notice Splits every incoming payment into a spendable balance and savings held in the ERC-4626
///         vault of the saver's chosen strategy (a yield vault or the market basket).
contract Mirai {
    using SafeERC20 for IERC20;

    struct Account {
        uint16 splitBps;
        uint128 spend;
        uint128 shares;
        uint64 lockUntil;
        uint8 strategy;
    }

    /// @dev `accountOf` result: `savings` is the current asset value of `shares` in the strategy vault.
    struct AccountView {
        uint16 splitBps;
        uint128 spend;
        uint128 shares;
        uint256 savings;
        uint64 lockUntil;
        uint8 strategy;
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

    uint16 public constant MAX_BPS = 10_000;
    uint16 public constant DEFAULT_SPLIT_BPS = 2_000;
    uint64 public constant MAX_LOCK_DURATION = 5 * 365 days;
    /// @dev Upper bound for an encrypted goal blob (a Mera secret vault is ~300 bytes of JSON).
    uint256 public constant MAX_GOAL_BYTES = 1024;
    /// @notice Strategies: 0 conservative, 1 balanced (default), 2 growth (yield), 3 smart money (market
    ///         basket, value can fall). Order is relied on by the web app.
    uint8 public constant STRATEGY_COUNT = 4;
    uint8 public constant DEFAULT_STRATEGY = 1;

    IERC20 public immutable asset;
    IERC4626[4] private _vaults;
    IYieldSource[4] private _yieldSources;

    mapping(address => Account) private _accounts;
    mapping(address => bool) private _initialized;
    /// @dev Opaque, client-side encrypted savings goal. Only ciphertext ever reaches the chain.
    mapping(address => bytes) private _goals;

    event PaymentRouted(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 spendAmount,
        uint256 savingsAmount,
        uint256 shares
    );
    event SpendWithdrawn(address indexed user, uint256 amount);
    event SavingsWithdrawn(address indexed user, uint256 shares, uint256 amountOut);
    event SplitSet(address indexed user, uint16 bps);
    event LockSet(address indexed user, uint64 until);
    event GoalSet(address indexed user);
    event StrategySet(address indexed user, uint8 strategy, uint256 moved);

    /// @param vaults_ One ERC-4626 vault per strategy, all over the same asset.
    /// @param yieldSources_ Dripped before each deposit/withdrawal; zero for vaults that earn natively.
    constructor(IERC4626[4] memory vaults_, IYieldSource[4] memory yieldSources_) {
        if (address(vaults_[0]) == address(0)) revert InvalidAddress();
        asset = IERC20(vaults_[0].asset());
        for (uint256 i; i < STRATEGY_COUNT; ++i) {
            if (address(vaults_[i]) == address(0) || vaults_[i].asset() != address(asset)) revert InvalidAddress();
            _vaults[i] = vaults_[i];
            _yieldSources[i] = yieldSources_[i];
            asset.forceApprove(address(vaults_[i]), type(uint256).max);
        }
    }

    function strategies() external view returns (IERC4626[4] memory vaults, IYieldSource[4] memory yieldSources) {
        return (_vaults, _yieldSources);
    }

    function accountOf(address user) external view returns (AccountView memory out) {
        if (user == address(0)) revert InvalidAddress();
        Account memory acc = _accounts[user];
        uint8 strategy = _initialized[user] ? acc.strategy : DEFAULT_STRATEGY;
        out = AccountView({
            splitBps: _initialized[user] ? acc.splitBps : DEFAULT_SPLIT_BPS,
            spend: acc.spend,
            shares: acc.shares,
            savings: _vaults[strategy].convertToAssets(acc.shares),
            lockUntil: acc.lockUntil,
            strategy: strategy
        });
    }

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
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (amount == 0) revert EmptyWithdrawal();

        Account storage acc = _account(user);
        if (amount > acc.spend) revert InsufficientSpendable();

        acc.spend -= _toUint128(amount);
        asset.safeTransfer(user, amount);
        emit SpendWithdrawn(user, amount);
        return amount;
    }

    /// @notice Withdraw `amount` of the asset from savings, burning the shares it is worth.
    function withdrawSavings(address user, uint256 amount) external returns (uint256 amountOut) {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (amount == 0) revert EmptyWithdrawal();

        Account storage acc = _account(user);
        if (block.timestamp < acc.lockUntil) revert LockActive();
        IERC4626 vault = _vaults[acc.strategy];
        _drip(acc.strategy);
        uint256 shares = vault.previewWithdraw(amount);
        if (shares > acc.shares) revert InsufficientShares();

        acc.shares -= _toUint128(shares);
        vault.withdraw(amount, user, address(this));
        emit SavingsWithdrawn(user, shares, amount);
        return amount;
    }

    /// @notice Withdraw every savings share at whatever it is worth when the transaction executes.
    /// @dev "Withdraw everything" must use this: in the market strategy the value can fall between
    ///      reading it and the transaction landing, so a fixed `withdrawSavings` amount could revert.
    function withdrawAllSavings(address user) external returns (uint256 amountOut) {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();

        Account storage acc = _account(user);
        if (block.timestamp < acc.lockUntil) revert LockActive();
        uint256 shares = acc.shares;
        if (shares == 0) revert EmptyWithdrawal();
        _drip(acc.strategy);

        acc.shares = 0;
        amountOut = _vaults[acc.strategy].redeem(shares, user, address(this));
        emit SavingsWithdrawn(user, shares, amountOut);
    }

    function setSplit(address user, uint16 bps) external {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (bps > MAX_BPS) revert InvalidBps();

        Account storage acc = _account(user);
        acc.splitBps = bps;
        emit SplitSet(user, bps);
    }

    function setLock(address user, uint64 until) external {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (until < block.timestamp) revert LockCannotShrink();
        if (until > block.timestamp + MAX_LOCK_DURATION) revert LockTooLong();

        Account storage acc = _account(user);
        if (until < acc.lockUntil) revert LockCannotShrink();
        acc.lockUntil = until;
        emit LockSet(user, until);
    }

    /// @notice Moves the caller's savings into another strategy's vault (allowed while locked: funds
    ///         stay in savings). Future savings go to the new strategy.
    function setStrategy(address user, uint8 strategy) external {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (strategy >= STRATEGY_COUNT) revert InvalidStrategy();

        Account storage acc = _account(user);
        uint8 previous = acc.strategy;
        if (strategy == previous) return;

        uint256 moved;
        if (acc.shares != 0) {
            _drip(previous);
            _drip(strategy);
            moved = _vaults[previous].redeem(acc.shares, address(this), address(this));
            IERC4626 next = _vaults[strategy];
            if (next.previewDeposit(moved) == 0) {
                // too small to become a share in the new vault: keep it spendable rather than lose it
                acc.shares = 0;
                acc.spend += _toUint128(moved);
            } else {
                acc.shares = _toUint128(next.deposit(moved, address(this)));
            }
        }
        acc.strategy = strategy;
        emit StrategySet(user, strategy, moved);
    }

    /// @notice Stores the caller's encrypted savings goal; empty bytes clear it.
    function setGoal(address user, bytes calldata encrypted) external {
        if (user == address(0)) revert InvalidAddress();
        if (msg.sender != user) revert Unauthorized();
        if (encrypted.length > MAX_GOAL_BYTES) revert GoalTooLarge();

        _goals[user] = encrypted;
        emit GoalSet(user);
    }

    function goalOf(address user) external view returns (bytes memory) {
        return _goals[user];
    }

    function _pay(address from, address to, uint256 amount) private {
        if (to == address(0) || from == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (msg.sender != from) revert Unauthorized();

        Account storage acc = _account(to);
        IERC4626 vault = _vaults[acc.strategy];
        // Settle pending yield first, so a new deposit never buys shares at a stale (too low) price.
        _drip(acc.strategy);
        uint256 savingsAmount = (amount * acc.splitBps) / MAX_BPS;
        // A savings slice worth less than one share would be donated to the vault; keep it spendable.
        if (savingsAmount != 0 && vault.previewDeposit(savingsAmount) == 0) savingsAmount = 0;
        uint256 spendAmount = amount - savingsAmount;

        asset.safeTransferFrom(from, address(this), amount);
        uint256 shares = savingsAmount == 0 ? 0 : vault.deposit(savingsAmount, address(this));

        acc.spend += _toUint128(spendAmount);
        acc.shares += _toUint128(shares);

        emit PaymentRouted(from, to, amount, spendAmount, savingsAmount, shares);
    }

    function _account(address user) private returns (Account storage acc) {
        acc = _accounts[user];
        if (!_initialized[user]) {
            _initialized[user] = true;
            acc.splitBps = DEFAULT_SPLIT_BPS;
            acc.strategy = DEFAULT_STRATEGY;
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
