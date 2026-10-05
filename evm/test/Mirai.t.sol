// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Mirai, IYieldSource} from "../src/Mirai.sol";
import {MiraiVault} from "../src/MiraiVault.sol";
import {YieldStreamer} from "../src/YieldStreamer.sol";
import {MarketVault, IPriceFeed} from "../src/MarketVault.sol";

/// @dev 6-decimal permit token, shaped like AUSD.
contract MockAUSD is ERC20Permit {
    constructor() ERC20("Agora Dollar", "AUSD") ERC20Permit("Agora Dollar") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFeed is IPriceFeed {
    int256 public answer;

    function set(int256 answer_) external {
        answer = answer_;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}

contract RevertingYieldSource is IYieldSource {
    function drip() external pure returns (uint256) {
        revert("broken");
    }
}

contract MiraiTest is Test {
    Mirai mirai;
    MiraiVault vault; // the default (balanced) strategy's vault
    MiraiVault[3] vaults;
    YieldStreamer[3] streamers;
    MockAUSD ausd;
    MockFeed btc;
    MockFeed eth;
    MarketVault market;
    address curator = address(0xC0FFEE);

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = address(0xBEEF);

    uint256 constant ONE = 1e6;

    function setUp() public {
        alice = vm.addr(alicePk);
        ausd = new MockAUSD();
        uint16[3] memory apr = [uint16(400), 800, 1200];
        IERC4626[4] memory vs;
        IYieldSource[4] memory ys;
        for (uint256 i; i < 3; ++i) {
            vaults[i] = new MiraiVault(ausd);
            // Unfunded streamers drip nothing, so tests that don't fund them see no streamed yield.
            streamers[i] = new YieldStreamer(vaults[i], apr[i]);
            vs[i] = vaults[i];
            ys[i] = IYieldSource(address(streamers[i]));
        }
        (btc, eth) = (new MockFeed(), new MockFeed());
        btc.set(80_000e8);
        eth.set(2500e8);
        IPriceFeed[] memory feeds = new IPriceFeed[](2);
        (feeds[0], feeds[1]) = (btc, eth);
        market = new MarketVault(ausd, curator, feeds, _weights(5000, 5000));
        vs[3] = market;
        vault = vaults[1];
        mirai = new Mirai(vs, ys);
    }

    function _pay(address from, address to, uint256 amount) internal {
        ausd.mint(from, amount);
        vm.startPrank(from);
        ausd.approve(address(mirai), amount);
        mirai.pay(from, to, amount);
        vm.stopPrank();
    }

    function testPayAllocatesSplitAndDepositsSavings() public {
        _pay(alice, bob, 1000 * ONE);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertEq(acc.splitBps, 2000);
        assertEq(acc.spend, 800 * ONE);
        assertEq(acc.savings, 200 * ONE);
        assertEq(ausd.balanceOf(address(vault)), 200 * ONE);
        assertEq(vault.balanceOf(address(mirai)), acc.shares);
        assertEq(ausd.balanceOf(address(mirai)), 800 * ONE);
    }

    function testPayWithPermitIsOneTransaction() public {
        uint256 amount = 50 * ONE;
        ausd.mint(alice, amount);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                address(mirai),
                amount,
                ausd.nonces(alice),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ausd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.prank(alice);
        mirai.payWithPermit(alice, bob, amount, deadline, v, r, s);

        assertEq(mirai.accountOf(bob).spend, 40 * ONE);
        assertEq(mirai.accountOf(bob).savings, 10 * ONE);
    }

    function testPayRejectsThirdPartyPayer() public {
        ausd.mint(alice, ONE);
        vm.prank(alice);
        ausd.approve(address(mirai), ONE);

        vm.prank(bob);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.pay(alice, bob, ONE);
    }

    function testSavingsEarnYield() public {
        _pay(alice, bob, 1000 * ONE);
        // Yield arrives as AUSD sent straight to the vault.
        ausd.mint(address(vault), 20 * ONE);

        uint256 savings = mirai.accountOf(bob).savings;
        assertApproxEqAbs(savings, 220 * ONE, 1);

        vm.prank(bob);
        mirai.withdrawSavings(bob, savings);
        assertEq(ausd.balanceOf(bob), savings);
        assertLe(mirai.accountOf(bob).savings, 1);
    }

    function testLaterPayerDoesNotTakeEarlierYield() public {
        _pay(alice, bob, 1000 * ONE);
        ausd.mint(address(vault), 20 * ONE);
        address carol = address(0xCA201);
        _pay(alice, carol, 1000 * ONE);

        assertApproxEqAbs(mirai.accountOf(bob).savings, 220 * ONE, 1);
        assertApproxEqAbs(mirai.accountOf(carol).savings, 200 * ONE, 1);
    }

    function testDustSavingsStaySpendable() public {
        _pay(alice, bob, 1000 * ONE);
        // Push the share price high enough that a 2-unit savings slice is worth 0 shares
        // (the vault's 10^6 virtual shares make this take a very large donation).
        ausd.mint(address(vault), 1_000_000_000 * ONE);
        address carol = address(0xCA201);
        _pay(alice, carol, 10);

        Mirai.AccountView memory acc = mirai.accountOf(carol);
        assertEq(acc.spend, 10);
        assertEq(acc.shares, 0);
    }

    function testWithdrawSpend() public {
        _pay(alice, bob, 1000 * ONE);

        vm.prank(bob);
        mirai.withdrawSpend(bob, 300 * ONE);
        assertEq(ausd.balanceOf(bob), 300 * ONE);
        assertEq(mirai.accountOf(bob).spend, 500 * ONE);

        vm.prank(bob);
        vm.expectRevert(Mirai.InsufficientSpendable.selector);
        mirai.withdrawSpend(bob, 501 * ONE);
    }

    function testWithdrawSavingsOverBalanceReverts() public {
        _pay(alice, bob, 1000 * ONE);
        vm.prank(bob);
        vm.expectRevert(Mirai.InsufficientShares.selector);
        mirai.withdrawSavings(bob, 201 * ONE);
    }

    function testLockBlocksSavingsWithdraw() public {
        _pay(alice, bob, 1000 * ONE);
        uint64 until = uint64(block.timestamp + 1 days);
        vm.prank(bob);
        mirai.setLock(bob, until);

        vm.prank(bob);
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.withdrawSavings(bob, ONE);

        // Spend stays available while savings are locked.
        vm.prank(bob);
        mirai.withdrawSpend(bob, ONE);

        vm.warp(until);
        vm.prank(bob);
        mirai.withdrawSavings(bob, ONE);
        assertEq(ausd.balanceOf(bob), 2 * ONE);
    }

    function testLockCannotShrinkOrExceedMax() public {
        uint64 until = uint64(block.timestamp + 10 days);
        vm.startPrank(bob);
        mirai.setLock(bob, until);
        vm.expectRevert(Mirai.LockCannotShrink.selector);
        mirai.setLock(bob, until - 1);
        vm.expectRevert(Mirai.LockTooLong.selector);
        mirai.setLock(bob, uint64(block.timestamp + 5 * 365 days + 1));
        vm.stopPrank();
    }

    function testSetSplitBounds() public {
        vm.startPrank(bob);
        mirai.setSplit(bob, 10_000);
        assertEq(mirai.accountOf(bob).splitBps, 10_000);
        vm.expectRevert(Mirai.InvalidBps.selector);
        mirai.setSplit(bob, 10_001);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.setSplit(bob, 0);
    }

    function testGoalStoresOpaqueCiphertext() public {
        bytes memory vault = bytes('{"version":1,"ciphertext":"abc"}');
        vm.prank(bob);
        mirai.setGoal(bob, vault);
        assertEq(mirai.goalOf(bob), vault);

        vm.prank(bob);
        mirai.setGoal(bob, "");
        assertEq(mirai.goalOf(bob).length, 0);
    }

    function testGoalGuards() public {
        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.setGoal(bob, "x");

        vm.prank(bob);
        vm.expectRevert(Mirai.GoalTooLarge.selector);
        mirai.setGoal(bob, new bytes(1025));
    }

    /// Someone donates to the empty vault first; later small savings must still get shares
    /// (otherwise the dust guard silently turns everyone's savings into spend).
    function testDonationToEmptyVaultCannotBlockSavings() public {
        ausd.mint(address(vault), 1_000 * ONE);
        _pay(alice, bob, 10 * ONE);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertGt(acc.shares, 0, "savings were turned into spend");
        assertEq(acc.spend, 8 * ONE);
        assertApproxEqRel(acc.savings, 2 * ONE, 0.01e18);
    }

    function testDefaultStrategyIsBalanced() public {
        assertEq(mirai.accountOf(bob).strategy, 1);
        _pay(alice, bob, 100 * ONE);
        assertEq(vaults[1].balanceOf(address(mirai)), mirai.accountOf(bob).shares);
    }

    function testStreamerPaysAprOverTime() public {
        ausd.mint(address(streamers[1]), 1_000 * ONE);
        _pay(alice, bob, 1000 * ONE); // 200 AUSD saved in the balanced (8%) vault
        vm.warp(block.timestamp + 365 days);
        streamers[1].drip();
        assertApproxEqRel(mirai.accountOf(bob).savings, 216 * ONE, 0.001e18);
    }

    function testNewSaverDoesNotCaptureUndrippedYield() public {
        ausd.mint(address(streamers[1]), 1_000 * ONE);
        _pay(alice, bob, 1000 * ONE);
        vm.warp(block.timestamp + 365 days);
        // Carol's payment drips first, so the year of yield belongs to Bob.
        address carol = address(0xCA201);
        _pay(alice, carol, 1000 * ONE);
        assertApproxEqRel(mirai.accountOf(bob).savings, 216 * ONE, 0.001e18);
        assertApproxEqAbs(mirai.accountOf(carol).savings, 200 * ONE, 1);
    }

    function testStreamerIsCappedByReserve() public {
        ausd.mint(address(streamers[1]), 1 * ONE);
        _pay(alice, bob, 1000 * ONE);
        vm.warp(block.timestamp + 365 days);
        streamers[1].drip();
        assertApproxEqAbs(mirai.accountOf(bob).savings, 201 * ONE, 1);
        assertEq(ausd.balanceOf(address(streamers[1])), 0);
    }

    function testSetStrategyMigratesSavings() public {
        _pay(alice, bob, 1000 * ONE);
        vm.prank(bob);
        mirai.setStrategy(bob, 2);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertEq(acc.strategy, 2);
        assertApproxEqAbs(acc.savings, 200 * ONE, 1);
        assertEq(vaults[1].balanceOf(address(mirai)), 0);
        assertEq(vaults[2].balanceOf(address(mirai)), acc.shares);

        // New savings follow the new strategy, and withdrawals come out of it.
        _pay(alice, bob, 100 * ONE);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 220 * ONE, 2);
        uint256 savings = mirai.accountOf(bob).savings;
        vm.prank(bob);
        mirai.withdrawSavings(bob, savings);
        assertEq(ausd.balanceOf(bob), savings);
    }

    function testSetStrategyAllowedWhileLockedAndGuarded() public {
        _pay(alice, bob, 1000 * ONE);
        vm.startPrank(bob);
        mirai.setLock(bob, uint64(block.timestamp + 30 days));
        mirai.setStrategy(bob, 0);
        assertEq(mirai.accountOf(bob).strategy, 0);
        vm.expectRevert(Mirai.InvalidStrategy.selector);
        mirai.setStrategy(bob, 4);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.setStrategy(bob, 1);
    }

    function testBrokenYieldSourceNeverBlocksPayments() public {
        IERC4626[4] memory vs = [IERC4626(vaults[0]), vaults[1], vaults[2], market];
        IYieldSource broken = new RevertingYieldSource();
        IYieldSource[4] memory ys = [broken, broken, broken, broken];
        Mirai m = new Mirai(vs, ys);

        ausd.mint(alice, 100 * ONE);
        vm.startPrank(alice);
        ausd.approve(address(m), 100 * ONE);
        m.pay(alice, bob, 100 * ONE);
        vm.stopPrank();
        assertApproxEqAbs(m.accountOf(bob).savings, 20 * ONE, 1);
    }

    function _weights(uint16 a, uint16 b) internal pure returns (uint16[] memory w) {
        w = new uint16[](2);
        (w[0], w[1]) = (a, b);
    }

    function _toMarket(address user) internal {
        vm.prank(user);
        mirai.setStrategy(user, 3);
    }

    function testMarketSavingsFollowPrices() public {
        _toMarket(bob);
        _pay(alice, bob, 1000 * ONE); // 200 saved into the basket
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 1);

        // ETH (half the basket) +20%: savings +10%, capped by the vault's AUSD until a reserve is added.
        eth.set(3000e8);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 1);
        ausd.mint(address(market), 100 * ONE); // operator reserve; does not mint value by itself
        assertApproxEqAbs(mirai.accountOf(bob).savings, 220 * ONE, 2);

        // BTC halves: the loss stays in the vault.
        btc.set(40_000e8);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 170 * ONE, 2);

        vm.prank(bob);
        mirai.withdrawSavings(bob, 170 * ONE - 2);
        assertEq(ausd.balanceOf(bob), 170 * ONE - 2);
        assertLe(market.basketValue(), 2);
    }

    function testMarketReserveDonationDoesNotMovePrice() public {
        _toMarket(bob);
        _pay(alice, bob, 1000 * ONE);
        uint256 before = market.convertToAssets(1e12);
        ausd.mint(address(market), 1_000_000 * ONE);
        assertEq(market.convertToAssets(1e12), before);
    }

    function testMarketRebalanceKeepsValueAndIsCuratorOnly() public {
        _toMarket(bob);
        _pay(alice, bob, 1000 * ONE);
        uint256 value = market.basketValue();

        vm.expectRevert(MarketVault.Unauthorized.selector);
        market.rebalance(_weights(2000, 8000));

        vm.prank(curator);
        market.rebalance(_weights(2000, 8000));
        assertApproxEqAbs(market.basketValue(), value, 1);
        (, uint16[] memory w, uint256[] memory units,) = market.basket();
        assertEq(w[1], 8000);
        assertApproxEqRel(units[1], 160e18 / 2500, 1e12); // 80% of $200 in ETH

        vm.prank(curator);
        vm.expectRevert(MarketVault.InvalidWeights.selector);
        market.rebalance(_weights(2000, 7000));
    }

    function testSwitchBetweenYieldAndMarket() public {
        _pay(alice, bob, 1000 * ONE);
        _toMarket(bob);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 2);
        vm.prank(bob);
        mirai.setStrategy(bob, 1);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 3);
        assertLe(market.basketValue(), 2);
    }

    function testWithdrawAllSavingsSurvivesAPriceDrop() public {
        _toMarket(bob);
        _pay(alice, bob, 1000 * ONE);
        uint256 shown = mirai.accountOf(bob).savings; // what the app displayed
        eth.set(2400e8); // the market moves before the transaction lands

        vm.prank(bob);
        vm.expectRevert(Mirai.InsufficientShares.selector);
        mirai.withdrawSavings(bob, shown);

        vm.prank(bob);
        uint256 out = mirai.withdrawAllSavings(bob);
        assertLt(out, shown);
        assertEq(ausd.balanceOf(bob), out);
        assertEq(mirai.accountOf(bob).shares, 0);
    }

    function testWithdrawAllSavingsGuards() public {
        vm.prank(bob);
        vm.expectRevert(Mirai.EmptyWithdrawal.selector);
        mirai.withdrawAllSavings(bob);

        _pay(alice, bob, 1000 * ONE);
        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.withdrawAllSavings(bob);

        vm.startPrank(bob);
        mirai.setLock(bob, uint64(block.timestamp + 1 days));
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.withdrawAllSavings(bob);
        vm.stopPrank();
    }
}
