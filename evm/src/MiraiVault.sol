// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// @notice ERC-4626 vault that holds Mirai savings in AUSD.
/// @dev Yield is any AUSD sent to the vault without minting shares, which raises the share price.
///      On testnet that is a manual top-up.
contract MiraiVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mirai AUSD", "mrAUSD") ERC4626(asset_) {}

    /// @dev 10^6 virtual shares: a donation into an empty (or nearly empty) vault is absorbed by them
    ///      instead of rounding later deposits down to zero shares. Shares carry 12 decimals.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
