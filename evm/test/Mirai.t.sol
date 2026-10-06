// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Mirai, IYieldSource, IBasket} from "../src/Mirai.sol";
import {MiraiVault} from "../src/MiraiVault.sol";
import {YieldStreamer} from "../src/YieldStreamer.sol";
import {BasketVault, IPriceFeed} from "../src/BasketVault.sol";

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
    MockFeed usdc;
    MockFeed btc;
    MockFeed eth;
    BasketVault basket;
    address curator = address(0xC0FFEE);
    // basket asset ids
    uint256 constant USDC = 0;
    uint256 constant BTC = 1;
    uint256 constant ETH = 2;
    uint256 constant MEME = 3;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = address(0xBEEF);

    uint256 constant ONE = 1e6;

    function setUp() public {
        alice = vm.addr(alicePk);
        ausd = new MockAUSD();
        uint16[3] memory apr = [uint16(400), 800, 1200];
        IERC4626[3] memory vs;
        IYieldSource[3] memory ys;
        for (uint256 i; i < 3; ++i) {
            vaults[i] = new MiraiVault(ausd);
            // Unfunded streamers drip nothing, so tests that don't fund them see no streamed yield.
            streamers[i] = new YieldStreamer(vaults[i], apr[i]);
            vs[i] = vaults[i];
            ys[i] = IYieldSource(address(streamers[i]));
        }
        (usdc, btc, eth) = (new MockFeed(), new MockFeed(), new MockFeed());
        usdc.set(1e8);
        btc.set(80_000e8);
        eth.set(2500e8);
        basket = new BasketVault(ausd, curator);
        vm.startPrank(curator);
        basket.addAsset("USDC", usdc, false);
        basket.addAsset("BTC", btc, false);
        basket.addAsset("ETH", eth, false);
        basket.addAsset("CHOG", IPriceFeed(address(0)), true);
        basket.setPrices(_ids(MEME), _prices(1e15)); // $0.001
        basket.setSmartWeights(_w(1000, 4000, 5000, 0));
        vm.stopPrank();
        vault = vaults[1];
        mirai = new Mirai(vs, ys, IBasket(address(basket)));
        vm.prank(curator);
        basket.initMirai(address(mirai));
    }

    function _shares(address user) internal view returns (uint256) {
        return mirai.pocketsOf(user)[0].shares;
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
        assertEq(vault.balanceOf(address(mirai)), _shares(bob));
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
        mirai.withdrawPocket(bob, 0, savings);
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
        assertEq(_shares(carol), 0);
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
        mirai.withdrawPocket(bob, 0, 201 * ONE);
    }

    function testLockBlocksSavingsWithdraw() public {
        _pay(alice, bob, 1000 * ONE);
        uint64 until = uint64(block.timestamp + 1 days);
        vm.prank(bob);
        mirai.setPocketLock(bob, 0, until);

        vm.prank(bob);
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.withdrawPocket(bob, 0, ONE);

        // Spend stays available while savings are locked.
        vm.prank(bob);
        mirai.withdrawSpend(bob, ONE);

        vm.warp(until);
        vm.prank(bob);
        mirai.withdrawPocket(bob, 0, ONE);
        assertEq(ausd.balanceOf(bob), 2 * ONE);
    }

    function testLockCannotShrinkOrExceedMax() public {
        uint64 until = uint64(block.timestamp + 10 days);
        vm.startPrank(bob);
        mirai.setPocketLock(bob, 0, until);
        vm.expectRevert(Mirai.LockCannotShrink.selector);
        mirai.setPocketLock(bob, 0, until - 1);
        vm.expectRevert(Mirai.LockTooLong.selector);
        mirai.setPocketLock(bob, 0, uint64(block.timestamp + 5 * 365 days + 1));
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

    /// Someone donates to the empty vault first; later small savings must still get shares
    /// (otherwise the dust guard silently turns everyone's savings into spend).
    function testDonationToEmptyVaultCannotBlockSavings() public {
        ausd.mint(address(vault), 1_000 * ONE);
        _pay(alice, bob, 10 * ONE);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertGt(_shares(bob), 0, "savings were turned into spend");
        assertEq(acc.spend, 8 * ONE);
        assertApproxEqRel(acc.savings, 2 * ONE, 0.01e18);
    }

    function testDefaultStrategyIsBalanced() public {
        assertEq(mirai.pocketsOf(bob)[0].strategy, 1);
        _pay(alice, bob, 100 * ONE);
        assertEq(vaults[1].balanceOf(address(mirai)), _shares(bob));
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
        mirai.setPocketStrategy(bob, 0, 2);

        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertEq(mirai.pocketsOf(bob)[0].strategy, 2);
        assertApproxEqAbs(acc.savings, 200 * ONE, 1);
        assertEq(vaults[1].balanceOf(address(mirai)), 0);
        assertEq(vaults[2].balanceOf(address(mirai)), _shares(bob));

        // New savings follow the new strategy, and withdrawals come out of it.
        _pay(alice, bob, 100 * ONE);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 220 * ONE, 2);
        uint256 savings = mirai.accountOf(bob).savings;
        vm.prank(bob);
        mirai.withdrawPocket(bob, 0, savings);
        assertEq(ausd.balanceOf(bob), savings);
    }

    function testSetStrategyAllowedWhileLockedAndGuarded() public {
        _pay(alice, bob, 1000 * ONE);
        vm.startPrank(bob);
        mirai.setPocketLock(bob, 0, uint64(block.timestamp + 30 days));
        mirai.setPocketStrategy(bob, 0, 0);
        assertEq(mirai.pocketsOf(bob)[0].strategy, 0);
        vm.expectRevert(Mirai.InvalidStrategy.selector);
        mirai.setPocketStrategy(bob, 0, 4);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.setPocketStrategy(bob, 0, 1);
    }

    function testBrokenYieldSourceNeverBlocksPayments() public {
        IERC4626[3] memory vs = [IERC4626(vaults[0]), vaults[1], vaults[2]];
        IYieldSource broken = new RevertingYieldSource();
        IYieldSource[3] memory ys = [broken, broken, broken];
        Mirai m = new Mirai(vs, ys, IBasket(address(basket)));

        ausd.mint(alice, 100 * ONE);
        vm.startPrank(alice);
        ausd.approve(address(m), 100 * ONE);
        m.pay(alice, bob, 100 * ONE);
        vm.stopPrank();
        assertApproxEqAbs(m.accountOf(bob).savings, 20 * ONE, 1);
    }

    function _w(uint16 a, uint16 b, uint16 c, uint16 d) internal pure returns (uint16[] memory w) {
        w = new uint16[](4);
        (w[0], w[1], w[2], w[3]) = (a, b, c, d);
    }

    function _ids(uint256 id) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = id;
    }

    function _prices(uint256 price) internal pure returns (uint256[] memory p) {
        p = new uint256[](1);
        p[0] = price;
    }

    /// the default pocket switches to an invest basket
    function _toBasket(address user) internal {
        vm.prank(user);
        mirai.setPocketStrategy(user, 0, 3);
    }

    function testBasketFollowsSmartMoney() public {
        _toBasket(bob);
        _pay(alice, bob, 1000 * ONE); // 200 saved: 10% USDC, 40% BTC, 50% ETH
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 2);
        uint256[] memory u = basket.unitsOf(bob, 0);
        assertApproxEqRel(u[BTC], 80e18 / 80_000, 1e12);
        assertApproxEqRel(u[ETH], 100e18 / 2500, 1e12);
        assertEq(u[MEME], 0);
        assertEq(_shares(bob), 0); // the basket holds it, not vault shares
    }

    function testAllInMemecoinIsAllowed() public {
        _toBasket(bob);
        vm.prank(bob);
        basket.setWeights(bob, 0, _w(0, 0, 0, 10_000)); // 100% CHOG: the app warns, the contract allows
        _pay(alice, bob, 50 * ONE); // 10 saved
        assertApproxEqAbs(mirai.accountOf(bob).savings, 10 * ONE, 1);

        ausd.mint(address(basket), 100 * ONE); // operator reserve backs gains
        vm.prank(curator);
        basket.setPrices(_ids(MEME), _prices(3e15)); // CHOG triples
        assertApproxEqAbs(mirai.accountOf(bob).savings, 30 * ONE, 1);

        vm.prank(curator);
        basket.setPrices(_ids(MEME), _prices(1e14)); // then loses 97%
        assertApproxEqAbs(mirai.accountOf(bob).savings, 1 * ONE, 1);
    }

    function testCustomMixIsRebalancedAtTodaysPrices() public {
        _toBasket(bob);
        _pay(alice, bob, 1000 * ONE);
        uint256 before = mirai.accountOf(bob).savings;
        vm.prank(bob);
        basket.setWeights(bob, 0, _w(1000, 7000, 0, 2000)); // BTC 70, meme 20, stable 10
        assertApproxEqAbs(mirai.accountOf(bob).savings, before, 3);
        uint256[] memory u = basket.unitsOf(bob, 0);
        assertEq(u[ETH], 0);
        assertApproxEqRel(u[BTC], 140e18 / 80_000, 1e12);
        assertTrue(basket.holder(bob, 0).custom);

        vm.prank(bob);
        basket.setWeights(bob, 0, new uint16[](0)); // back to following Smart Money
        assertFalse(basket.holder(bob, 0).custom);
        assertEq(basket.weightsOf(bob, 0)[ETH], 5000);
    }

    function testFollowersMoveToNewSmartWeights() public {
        _toBasket(bob);
        _toBasket(alice);
        _pay(alice, bob, 1000 * ONE);
        vm.prank(alice);
        basket.setWeights(alice, 0, _w(10_000, 0, 0, 0)); // alice picks her own mix
        _pay(bob, alice, 1000 * ONE);

        vm.prank(curator);
        basket.setSmartWeights(_w(0, 2000, 6000, 2000));
        uint256 value = mirai.accountOf(bob).savings;
        basket.sync(bob, 0); // anyone can move a follower to the new weights
        assertApproxEqAbs(mirai.accountOf(bob).savings, value, 3);
        assertGt(basket.unitsOf(bob, 0)[MEME], 0);
        assertEq(basket.weightsOf(alice, 0)[USDC], 10_000); // custom mixes never follow
        assertEq(basket.unitsOf(alice, 0)[MEME], 0);
    }

    function testBasketWithdrawPartialThenAll() public {
        _toBasket(bob);
        _pay(alice, bob, 1000 * ONE);
        vm.startPrank(bob);
        mirai.withdrawPocket(bob, 0, 50 * ONE);
        assertEq(ausd.balanceOf(bob), 50 * ONE);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 150 * ONE, 3);
        vm.expectRevert(Mirai.InsufficientShares.selector);
        mirai.withdrawPocket(bob, 0, 151 * ONE);
        uint256 out = mirai.withdrawAllPocket(bob, 0);
        vm.stopPrank();
        assertApproxEqAbs(out, 150 * ONE, 3);
        assertEq(basket.valueOf(bob, 0), 0);
        vm.prank(bob);
        vm.expectRevert(Mirai.EmptyWithdrawal.selector);
        mirai.withdrawAllPocket(bob, 0);
    }

    function testWithdrawAllSavingsSurvivesAPriceDrop() public {
        _toBasket(bob);
        _pay(alice, bob, 1000 * ONE);
        uint256 shown = mirai.accountOf(bob).savings; // what the app displayed
        eth.set(2400e8); // the market moves before the transaction lands

        vm.prank(bob);
        vm.expectRevert(Mirai.InsufficientShares.selector);
        mirai.withdrawPocket(bob, 0, shown);

        vm.prank(bob);
        uint256 out = mirai.withdrawAllPocket(bob, 0);
        assertLt(out, shown);
        assertEq(ausd.balanceOf(bob), out);
    }

    function testWithdrawAllSavingsGuards() public {
        vm.prank(bob);
        vm.expectRevert(Mirai.EmptyWithdrawal.selector);
        mirai.withdrawAllPocket(bob, 0);

        _pay(alice, bob, 1000 * ONE);
        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.withdrawAllPocket(bob, 0);

        vm.startPrank(bob);
        mirai.setPocketLock(bob, 0, uint64(block.timestamp + 1 days));
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.withdrawAllPocket(bob, 0);
        vm.stopPrank();
    }

    function testBasketGuards() public {
        vm.expectRevert(BasketVault.Unauthorized.selector);
        basket.deposit(bob, 0, 1); // only Mirai moves money in
        vm.expectRevert(BasketVault.Unauthorized.selector);
        basket.setPrices(_ids(MEME), _prices(1)); // only the curator prices coins
        vm.expectRevert(BasketVault.Unauthorized.selector);
        basket.setWeights(bob, 0, _w(10_000, 0, 0, 0)); // only bob picks bob's mix
        vm.prank(curator);
        vm.expectRevert(BasketVault.AlreadyInitialized.selector);
        basket.initMirai(address(1));

        vm.startPrank(bob);
        vm.expectRevert(BasketVault.InvalidWeights.selector);
        basket.setWeights(bob, 0, _w(5000, 0, 0, 0)); // must sum to 100%
        vm.stopPrank();
        vm.prank(curator);
        vm.expectRevert(BasketVault.InvalidPrice.selector);
        basket.setPrices(_ids(BTC), _prices(1)); // Chainlink assets can't be overridden
    }

    function testNoSmartWeightsRefusesDepositsInsteadOfLosingThem() public {
        BasketVault fresh = new BasketVault(ausd, curator);
        vm.prank(curator);
        fresh.addAsset("USDC", usdc, false);
        IERC4626[3] memory vs = [IERC4626(vaults[0]), vaults[1], vaults[2]];
        IYieldSource[3] memory ys;
        Mirai m = new Mirai(vs, ys, IBasket(address(fresh)));
        vm.prank(curator);
        fresh.initMirai(address(m));
        vm.prank(bob);
        m.setPocketStrategy(bob, 0, 3);

        ausd.mint(alice, 100 * ONE);
        vm.startPrank(alice);
        ausd.approve(address(m), 100 * ONE);
        vm.expectRevert(BasketVault.InvalidWeights.selector);
        m.pay(alice, bob, 100 * ONE);
        vm.stopPrank();
    }

    // ─── Pockets ─────────────────────────────────────────────────────────────

    function _shares2(uint16 a, uint16 b, uint16 c) internal pure returns (uint16[] memory bps) {
        bps = new uint16[](3);
        (bps[0], bps[1], bps[2]) = (a, b, c);
    }

    /// bob: pocket 0 (default, balanced yield), 1 = "PS5" growth yield, 2 = "Car" invest basket
    function _threePockets() internal {
        vm.startPrank(bob);
        assertEq(mirai.createPocket(bob, 2, "ps5"), 1);
        assertEq(mirai.createPocket(bob, 3, "car"), 2);
        mirai.setPocketShares(bob, _shares2(5000, 3000, 2000));
        vm.stopPrank();
    }

    function testFreshAccountHasOneDefaultPocket() public view {
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertEq(ps.length, 1);
        assertEq(ps[0].shareBps, 10_000);
        assertEq(ps[0].strategy, 1);
        assertTrue(ps[0].open);
    }

    function testPaymentSpreadsOverPocketsAndStrategies() public {
        _threePockets();
        _pay(alice, bob, 1000 * ONE); // 200 saved: 100 balanced, 60 growth, 40 basket
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertApproxEqAbs(ps[0].value, 100 * ONE, 1);
        assertApproxEqAbs(ps[1].value, 60 * ONE, 1);
        assertApproxEqAbs(ps[2].value, 40 * ONE, 2);
        assertEq(ps[2].shares, 0); // the basket holds pocket 2, not a vault
        assertEq(vaults[2].balanceOf(address(mirai)), ps[1].shares);
        assertApproxEqAbs(mirai.accountOf(bob).savings, 200 * ONE, 3);
        assertEq(mirai.accountOf(bob).spend, 800 * ONE);
        assertEq(ps[1].meta, bytes("ps5")); // opaque bytes (the app stores passkey-encrypted JSON)
    }

    function testRoundingRemainderGoesToTheLastFundedPocket() public {
        vm.startPrank(bob);
        mirai.createPocket(bob, 1, "");
        mirai.createPocket(bob, 1, "");
        mirai.setPocketShares(bob, _shares2(3333, 3333, 3334));
        vm.stopPrank();
        _pay(alice, bob, 50); // 10 units saved
        Mirai.AccountView memory acc = mirai.accountOf(bob);
        assertEq(acc.spend + acc.savings, 50); // nothing lost to rounding
    }

    function testPocketSharesMustCoverEverything() public {
        _threePockets();
        vm.startPrank(bob);
        vm.expectRevert(Mirai.InvalidShares.selector);
        mirai.setPocketShares(bob, _shares2(5000, 3000, 1000)); // 90%
        uint16[] memory two = new uint16[](2);
        (two[0], two[1]) = (5000, 5000);
        vm.expectRevert(Mirai.InvalidShares.selector);
        mirai.setPocketShares(bob, two); // one per slot
        vm.stopPrank();
    }

    function testWithdrawFromOnePocketOnly() public {
        _threePockets();
        _pay(alice, bob, 1000 * ONE);
        vm.startPrank(bob);
        mirai.withdrawPocket(bob, 1, 20 * ONE); // from "PS5"
        vm.expectRevert(Mirai.InsufficientShares.selector);
        mirai.withdrawPocket(bob, 1, 41 * ONE);
        uint256 out = mirai.withdrawAllPocket(bob, 2); // the whole "Car" basket
        vm.stopPrank();
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertApproxEqAbs(ps[1].value, 40 * ONE, 1);
        assertApproxEqAbs(out, 40 * ONE, 2);
        assertEq(ps[2].value, 0);
        assertApproxEqAbs(ps[0].value, 100 * ONE, 1); // untouched
        assertApproxEqAbs(ausd.balanceOf(bob), 60 * ONE, 2);
    }

    function testEachPocketHasItsOwnLock() public {
        _threePockets();
        _pay(alice, bob, 1000 * ONE);
        vm.startPrank(bob);
        mirai.setPocketLock(bob, 1, uint64(block.timestamp + 30 days)); // lock "PS5"
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.withdrawPocket(bob, 1, ONE);
        mirai.withdrawPocket(bob, 0, ONE); // other pockets stay free
        vm.expectRevert(Mirai.LockActive.selector);
        mirai.closePocket(bob, 1, 0);
        mirai.setPocketStrategy(bob, 1, 0); // moving strategy is fine: money stays in the pocket
        vm.stopPrank();
    }

    function testPocketStrategySwitchMovesItsMoney() public {
        _threePockets();
        _pay(alice, bob, 1000 * ONE);
        vm.prank(bob);
        mirai.setPocketStrategy(bob, 1, 3); // "PS5" from growth yield to an invest basket
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertEq(ps[1].strategy, 3);
        assertEq(ps[1].shares, 0);
        assertApproxEqAbs(ps[1].value, 60 * ONE, 2);
        assertApproxEqAbs(basket.valueOf(bob, 2), 40 * ONE, 2); // the other basket is separate
    }

    function testClosingAPocketMovesMoneyAndShare() public {
        _threePockets();
        _pay(alice, bob, 1000 * ONE);
        vm.prank(bob);
        mirai.closePocket(bob, 2, 0); // "Car" into the default pocket
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertFalse(ps[2].open);
        assertEq(ps[2].shareBps, 0);
        assertEq(ps[2].meta.length, 0);
        assertEq(ps[0].shareBps, 7000);
        assertApproxEqAbs(ps[0].value, 140 * ONE, 3);
        vm.prank(bob);
        vm.expectRevert(Mirai.InvalidPocket.selector);
        mirai.withdrawPocket(bob, 2, ONE);

        vm.prank(bob);
        assertEq(mirai.createPocket(bob, 0, "laptop"), 2); // the closed slot is reused
    }

    function testAtMostTenPockets() public {
        vm.startPrank(bob);
        for (uint256 i = 1; i < 10; ++i) {
            mirai.createPocket(bob, 1, "");
        }
        vm.expectRevert(Mirai.TooManyPockets.selector);
        mirai.createPocket(bob, 1, "");
        vm.stopPrank();
        assertEq(mirai.accountOf(bob).pocketCount, 10);
    }

    function testPocketGuards() public {
        vm.prank(alice);
        vm.expectRevert(Mirai.Unauthorized.selector);
        mirai.createPocket(bob, 1, "");
        vm.startPrank(bob);
        vm.expectRevert(Mirai.InvalidStrategy.selector);
        mirai.createPocket(bob, 4, "");
        vm.expectRevert(Mirai.GoalTooLarge.selector);
        mirai.createPocket(bob, 1, new bytes(1025));
        vm.expectRevert(Mirai.InvalidPocket.selector);
        mirai.withdrawPocket(bob, 5, ONE);
        vm.expectRevert(Mirai.InvalidPocket.selector);
        mirai.closePocket(bob, 0, 0);
        mirai.setPocketMeta(bob, 0, "renamed");
        vm.stopPrank();
        assertEq(mirai.pocketsOf(bob)[0].meta, bytes("renamed"));
    }

    function testFullPaymentToLastPocketWhenOthersAreZero() public {
        vm.startPrank(bob);
        mirai.createPocket(bob, 3, "car");
        uint16[] memory bps = new uint16[](2);
        (bps[0], bps[1]) = (0, 10_000);
        mirai.setPocketShares(bob, bps);
        vm.stopPrank();
        _pay(alice, bob, 1000 * ONE);
        Mirai.PocketView[] memory ps = mirai.pocketsOf(bob);
        assertEq(ps[0].value, 0);
        assertApproxEqAbs(ps[1].value, 200 * ONE, 2);
    }

    function testPaymentEmitsPerPocketFunding() public {
        _threePockets();
        ausd.mint(alice, 1000 * ONE);
        vm.startPrank(alice);
        ausd.approve(address(mirai), 1000 * ONE);
        vm.expectEmit(true, true, false, true);
        emit Mirai.PocketFunded(bob, 0, 100 * ONE);
        vm.expectEmit(true, true, false, true);
        emit Mirai.PocketFunded(bob, 1, 60 * ONE);
        vm.expectEmit(true, true, false, true);
        emit Mirai.PocketFunded(bob, 2, 40 * ONE);
        mirai.pay(alice, bob, 1000 * ONE);
        vm.stopPrank();
    }
}
