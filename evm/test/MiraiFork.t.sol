// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Mirai, IYieldSource} from "../src/Mirai.sol";
import {MiraiVault} from "../src/MiraiVault.sol";

interface IAusdFaucet {
    function requestFunds(address to) external;
}

/// @dev Runs against real AUSD on Monad testnet. Skipped unless MONAD_RPC_URL is set:
///      MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork
contract MiraiForkTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;

    function testPermitPayAgainstRealAusd() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        (address alice, uint256 alicePk) = makeAddrAndKey("alice");
        address bob = makeAddr("bob");
        IERC4626[4] memory vs = [
            IERC4626(new MiraiVault(IERC20(AUSD))),
            new MiraiVault(IERC20(AUSD)),
            new MiraiVault(IERC20(AUSD)),
            new MiraiVault(IERC20(AUSD))
        ];
        IYieldSource[4] memory none;
        Mirai mirai = new Mirai(vs, none);

        IAusdFaucet(FAUCET).requestFunds(alice);
        uint256 amount = IERC20(AUSD).balanceOf(alice);
        assertGt(amount, 0, "faucet sent nothing");

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                address(mirai),
                amount,
                IERC20Permit(AUSD).nonces(alice),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(AUSD).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.prank(alice);
        mirai.payWithPermit(alice, bob, amount, deadline, v, r, s);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertEq(acc.spend + acc.savings, amount);
        assertEq(acc.savings, amount / 5);
    }
}
