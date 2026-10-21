// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";

/// Limit and stop orders, take-profit / stop-loss, partial closes and margin withdrawal.
contract OrdersTest is Base {
    uint256 internal constant NYC0 = 850_000 * P;

    function fee(uint256 size) internal pure returns (uint256) {
        return (size * 6 + 9_999) / 10_000;
    }

    // ---------------------------------------------------------------- orders

    function test_LimitLongFillsOnlyAtOrBelowTrigger() public {
        uint256 start = totalUsdg();
        uint256 trigger = 845_000 * P;
        vm.prank(alice);
        uint256 oid = perps.placeOrder(NYC, true, 1_000 * U, 10, trigger, false, 0, 0);
        assertEq(usdg.balanceOf(address(perps)), 1_000 * U + fee(10_000 * U), "collateral and fee escrowed");
        assertEq(perps.ordersOf(alice).length, 1);

        vm.prank(keeper);
        vm.expectRevert(StoxhomesPerps.TriggerNotMet.selector);
        perps.executeOrder(oid);

        walkPrice(NYC, 844_000 * P); // through the trigger
        vm.prank(keeper); // anyone may execute
        uint256 pid = perps.executeOrder(oid);
        StoxhomesPerps.Position memory p = perps.position(pid);
        assertEq(p.owner, alice);
        assertEq(p.entryPrice, 844_000 * P, "fills at the oracle price, better than the limit");
        assertEq(p.size, 10_000 * U);
        assertEq(perps.ordersOf(alice).length, 0);
        assertEq(perps.openOrderCount(), 0);
        assertEq(usdg.balanceOf(address(perps)), 1_000 * U, "only the collateral stays");
        assertEq(totalUsdg(), start);
    }

    function test_StopShortFillsBelowTrigger() public {
        vm.prank(bob);
        uint256 oid = perps.placeOrder(NYC, false, 500 * U, 20, 840_000 * P, false, 0, 0);
        walkPrice(NYC, 839_000 * P);
        uint256 pid = perps.executeOrder(oid);
        StoxhomesPerps.Position memory p = perps.position(pid);
        assertFalse(p.isLong);
        assertEq(p.entryPrice, 839_000 * P);
    }

    function test_CancelRefundsEverything() public {
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 oid = perps.placeOrder(NYC, true, 1_000 * U, 50, 800_000 * P, false, 0, 0);
        vm.prank(bob);
        vm.expectRevert(StoxhomesPerps.NotOwner.selector);
        perps.cancelOrder(oid);
        vm.prank(owner);
        perps.pause();
        vm.prank(alice); // cancelling works while paused
        perps.cancelOrder(oid);
        assertEq(usdg.balanceOf(alice), before);
        assertEq(usdg.balanceOf(address(perps)), 0);
        vm.prank(owner);
        perps.unpause();
        vm.expectRevert(StoxhomesPerps.NoOrder.selector);
        perps.executeOrder(oid);
    }

    function test_OrderLimitsAndValidation() public {
        vm.startPrank(alice);
        vm.expectRevert(StoxhomesPerps.BadLeverage.selector);
        perps.placeOrder(NYC, true, 100 * U, 101, NYC0, false, 0, 0);
        vm.expectRevert(StoxhomesPerps.CollateralTooSmall.selector);
        perps.placeOrder(NYC, true, 1 * U, 10, NYC0, false, 0, 0);
        vm.expectRevert(StoxhomesPerps.BadParams.selector);
        perps.placeOrder(NYC, true, 100 * U, 10, 0, false, 0, 0);
        // a long's take-profit must be above the trigger and its stop-loss below
        vm.expectRevert(StoxhomesPerps.BadTriggers.selector);
        perps.placeOrder(NYC, true, 100 * U, 10, NYC0, false, NYC0 - 1, 0);
        vm.expectRevert(StoxhomesPerps.BadTriggers.selector);
        perps.placeOrder(NYC, true, 100 * U, 10, NYC0, false, 0, NYC0 + 1);
        for (uint256 i; i < perps.MAX_ORDERS_PER_OWNER(); ++i) perps.placeOrder(NYC, true, 10 * U, 2, NYC0 / 2, false, 0, 0);
        vm.expectRevert(StoxhomesPerps.TooManyOrders.selector);
        perps.placeOrder(NYC, true, 10 * U, 2, NYC0 / 2, false, 0, 0);
        vm.stopPrank();
    }

    function test_OrderCarriesTriggersToThePosition() public {
        vm.prank(alice);
        uint256 oid = perps.placeOrder(NYC, true, 1_000 * U, 10, 845_000 * P, false, 900_000 * P, 800_000 * P);
        walkPrice(NYC, 845_000 * P);
        uint256 pid = perps.executeOrder(oid);
        StoxhomesPerps.Position memory p = perps.position(pid);
        assertEq(p.takeProfit, 900_000 * P);
        assertEq(p.stopLoss, 800_000 * P);
    }

    // ---------------------------------------------------------------- take-profit / stop-loss

    function test_TakeProfitClosesForTheOwner() public {
        uint256 start = totalUsdg();
        vm.prank(alice);
        uint256 id = perps.openWithTriggers(NYC, true, 1_000 * U, 10, type(uint256).max, 858_500 * P, 0);
        vm.expectRevert(StoxhomesPerps.TriggerNotMet.selector);
        perps.executeTriggers(id);

        setPrice(NYC, 858_500 * P); // +1%
        uint256 before = usdg.balanceOf(alice);
        vm.prank(keeper);
        uint256 paid = perps.executeTriggers(id);
        assertApproxEqAbs(paid, 1_000 * U + 100 * U - 6 * U, 1);
        assertEq(usdg.balanceOf(alice) - before, paid, "paid to the owner, not the executor");
        assertEq(perps.position(id).owner, address(0));
        assertEq(totalUsdg(), start);
    }

    function test_StopLossOnShort() public {
        vm.prank(bob);
        uint256 id = perps.openWithTriggers(NYC, false, 1_000 * U, 10, 0, 0, 858_500 * P);
        setPrice(NYC, 860_000 * P); // beyond the stop
        uint256 paid = perps.executeTriggers(id);
        // -1.176% on 10,000 ≈ -117.65, minus 6 close fee
        assertApproxEqAbs(paid, 1_000 * U - 117_647_059 - 6 * U, 2);
    }

    function test_SetTriggersOwnerOnlyAndValidated() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(StoxhomesPerps.NotOwner.selector);
        perps.setTriggers(id, 900_000 * P, 0);
        vm.startPrank(alice);
        vm.expectRevert(StoxhomesPerps.BadTriggers.selector);
        perps.setTriggers(id, 840_000 * P, 0); // a take-profit below a long's price
        perps.setTriggers(id, 900_000 * P, 820_000 * P);
        assertEq(perps.position(id).takeProfit, 900_000 * P);
        perps.setTriggers(id, 0, 0);
        assertEq(perps.position(id).stopLoss, 0);
        vm.stopPrank();
    }

    function test_TriggersRespectHoldTime() public {
        vm.prank(owner);
        perps.setLimits(10 * U, 60);
        vm.prank(alice);
        uint256 id = perps.openWithTriggers(NYC, true, 1_000 * U, 10, type(uint256).max, 851_000 * P, 0);
        setPrice(NYC, 852_000 * P);
        vm.expectRevert(StoxhomesPerps.HoldTimeNotMet.selector);
        perps.executeTriggers(id);
        vm.warp(block.timestamp + 61);
        setPrice(NYC, 852_000 * P);
        perps.executeTriggers(id);
    }

    // ---------------------------------------------------------------- partial close

    function test_PartialCloseIsProportional() public {
        uint256 start = totalUsdg();
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max);
        setPrice(NYC, 858_500 * P); // +1%: +100 on the whole

        vm.prank(alice);
        uint256 paid = perps.decrease(id, 2_500 * U, 0); // a quarter
        // quarter of collateral 250 + quarter of pnl 25 - close fee on 2,500 (1.5)
        assertApproxEqAbs(paid, 250 * U + 25 * U - 1_500_000, 1);
        assertLe(paid, 250 * U + 25 * U - 1_500_000);
        StoxhomesPerps.Position memory p = perps.position(id);
        assertEq(p.size, 7_500 * U);
        assertEq(p.collateral, 750 * U);
        assertEq(p.entryPrice, 850_000 * P, "the rest keeps its entry");

        vm.prank(alice);
        uint256 rest = perps.decrease(id, type(uint256).max, 0); // closes it all
        assertApproxEqAbs(rest, 750 * U + 75 * U - 4_500_000, 2);
        assertEq(perps.position(id).owner, address(0));
        assertEq(perps.openPositionCount(), 0);
        assertEq(totalUsdg(), start);
        assertEq(perps.netTraderPnl(), 0, "no open interest left anywhere");
    }

    function test_PartialCloseRefusesADustRemainder() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 20 * U, 10, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(StoxhomesPerps.CollateralTooSmall.selector);
        perps.decrease(id, 150 * U, 0); // leaves 5 USDG collateral, under the 10 minimum
    }

    // ---------------------------------------------------------------- margin

    function test_RemoveCollateralWithinLimits() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max); // size 10,000; 100x needs 100
        vm.startPrank(alice);
        uint256 before = usdg.balanceOf(alice);
        perps.removeCollateral(id, 800 * U); // now 20x
        assertEq(usdg.balanceOf(alice) - before, 800 * U);
        assertEq(perps.position(id).collateral, 200 * U);
        vm.expectRevert(StoxhomesPerps.WouldBreachMargin.selector);
        perps.removeCollateral(id, 101 * U); // would be over 100x
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(StoxhomesPerps.NotOwner.selector);
        perps.removeCollateral(id, 1 * U);
    }

    function test_RemoveCollateralCountsLosses() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max);
        walkPrice(NYC, 782_000 * P); // -8%: equity 200
        vm.prank(alice);
        vm.expectRevert(StoxhomesPerps.WouldBreachMargin.selector);
        perps.removeCollateral(id, 150 * U); // equity would fall to 50, under the 100 initial margin
        vm.prank(alice);
        perps.removeCollateral(id, 90 * U);
    }

    function test_AccountingOnlyWalksActiveMarkets() public {
        vm.prank(alice);
        uint256 a = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max);
        vm.prank(bob);
        perps.open(MIA, false, 1_000 * U, 10, 0);
        setPrice(NYC, 858_500 * P);
        int256 pnl = perps.netTraderPnl();
        assertApproxEqAbs(pnl, int256(100 * U), 2);
        vm.prank(alice);
        perps.close(a, 0);
        assertApproxEqAbs(perps.netTraderPnl(), 0, 2);
    }

    function test_BatchListing() public {
        bytes32[] memory ids = new bytes32[](3);
        ids[0] = "aaa";
        ids[1] = "bbb";
        ids[2] = "ccc";
        vm.startPrank(owner);
        oracle.configureFeeds(ids, 100, 2 days, true);
        perps.listMarkets(ids, defaultParams());
        vm.stopPrank();
        assertEq(perps.marketCount(), 5);
        assertTrue(perps.market("bbb").listed);
        vm.prank(alice);
        vm.expectRevert();
        perps.listMarkets(ids, defaultParams());
    }
}

contract SequenceTest is Base {
    /// The UI journey: 25x short with triggers, add margin, close half after the hold, then close the rest.
    function test_ShortAddHalfCloseThenClose() public {
        vm.prank(owner);
        perps.setLimits(10 * U, 60);
        vm.startPrank(alice);
        uint256 id = perps.openWithTriggers(NYC, false, 100 * U, 25, 0, 833_000 * P, 858_500 * P);
        perps.addCollateral(id, 50 * U);
        vm.warp(block.timestamp + 61);
        vm.stopPrank();
        setPrice(NYC, 850_000 * P);
        vm.startPrank(alice);
        perps.decrease(id, 1_250 * U, type(uint256).max);
        StoxhomesPerps.Position memory p = perps.position(id);
        assertEq(p.size, 1_250 * U);
        assertEq(p.collateral, 75 * U);
        perps.close(id, type(uint256).max);
        vm.stopPrank();
        assertEq(perps.openPositionCount(), 0);
    }
}
