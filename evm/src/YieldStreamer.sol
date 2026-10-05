// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Streams yield into a savings vault at a fixed APR, paid from an AUSD reserve held here.
/// @dev Testnet stand-in for a real yield source (on mainnet a vault such as an AUSD lending market
///      earns on its own and needs no streamer). Accrual is simple interest on the vault's assets
///      since the last drip, capped by the reserve. Anyone can call `drip`; Mirai calls it before
///      every deposit and withdrawal so shares always trade at an up-to-date price.
contract YieldStreamer {
    using SafeERC20 for IERC20;

    uint256 private constant YEAR = 365 days;
    uint256 private constant BPS = 10_000;

    IERC20 public immutable asset;
    IERC4626 public immutable vault;
    /// @notice Annual rate in basis points (800 = 8%).
    uint16 public immutable aprBps;
    uint64 public lastDrip;

    event Dripped(uint256 amount);

    constructor(IERC4626 _vault, uint16 _aprBps) {
        vault = _vault;
        asset = IERC20(_vault.asset());
        aprBps = _aprBps;
        lastDrip = uint64(block.timestamp);
    }

    /// @notice Yield accrued since the last drip that the reserve can cover.
    function pending() public view returns (uint256) {
        uint256 accrued = (vault.totalAssets() * aprBps * (block.timestamp - lastDrip)) / (YEAR * BPS);
        uint256 reserve = asset.balanceOf(address(this));
        return accrued < reserve ? accrued : reserve;
    }

    /// @notice Sends accrued yield into the vault, raising its share price. Nothing accrues while empty.
    function drip() external returns (uint256 amount) {
        amount = pending();
        lastDrip = uint64(block.timestamp);
        if (amount != 0) {
            asset.safeTransfer(address(vault), amount);
            emit Dripped(amount);
        }
    }
}
