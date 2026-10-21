// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesVault} from "../src/StoxhomesVault.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";

contract PerpsTest is Base {
    function test_LongProfit_ExactSettlement() public {
        uint256 start = totalUsdg();
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max); // size 10,000
        // open fee 0.06% of 10,000 = 6 USDG, half to treasury
        assertEq(usdg.balanceOf(treasury), 3 * U);
        assertEq(usdg.balanceOf(address(perps)), 1_000 * U);

        setPrice(NYC, 858_500 * P); // +1%
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = perps.close(id, 0);
        // pnl +100, close fee 6, borrow 0 (same timestamp); long units round down, so up to 1 base unit less
        assertApproxEqAbs(paid, 1_000 * U + 100 * U - 6 * U, 1);
        assertLe(paid, 1_000 * U + 100 * U - 6 * U);
        assertEq(usdg.balanceOf(alice) - before, paid);
        assertEq(usdg.balanceOf(treasury), 6 * U);
        assertEq(usdg.balanceOf(address(perps)), 0);
        assertEq(totalUsdg(), start, "no USDG created or destroyed");
    }

    function test_ShortLoss_ExactSettlement() public {
        vm.prank(bob);
        uint256 id = perps.open(MIA, false, 500 * U, 20, 0); // size 10,000
        setPrice(MIA, 646_400 * P); // +1% against the short
        vm.prank(bob);
        uint256 paid = perps.close(id, type(uint256).max);
        assertApproxEqAbs(paid, 500 * U - 100 * U - 6 * U, 1);
        assertLe(paid, 500 * U - 100 * U - 6 * U);
    }

    function test_RoundTripAtSamePriceCostsExactlyFees() public {
        for (uint256 lev = 1; lev <= 100; lev += 33) {
            for (uint256 dir; dir < 2; ++dir) {
                bool isLong = dir == 0;
                vm.prank(alice);
                uint256 id = perps.open(NYC, isLong, 777 * U + 3, lev, isLong ? type(uint256).max : 0);
                uint256 size = (777 * U + 3) * lev;
                uint256 fee = (size * 6 + 9_999) / 10_000;
                vm.prank(alice);
                uint256 paid = perps.close(id, isLong ? 0 : type(uint256).max);
                assertLe(paid + fee, 777 * U + 3, "a flat round trip never pays the trader");
                assertGe(paid + fee + 2, 777 * U + 3, "and costs no more than fees plus rounding");
            }
        }
    }

    function test_SlippageProtection() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StoxhomesPerps.SlippageExceeded.selector, 850_000 * P, 849_999 * P));
        perps.open(NYC, true, 100 * U, 5, 849_999 * P);

        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 100 * U, 5, 850_000 * P);
        vm.prank(alice);
        vm.expectRevert();
        perps.close(id, 850_001 * P);
    }

    function test_LeverageAndSizeLimits() public {
        vm.startPrank(alice);
        vm.expectRevert(StoxhomesPerps.BadLeverage.selector);
        perps.open(NYC, true, 100 * U, 101, type(uint256).max);
        vm.expectRevert(StoxhomesPerps.BadLeverage.selector);
        perps.open(NYC, true, 100 * U, 0, type(uint256).max);
        vm.expectRevert(StoxhomesPerps.CollateralTooSmall.selector);
        perps.open(NYC, true, 9 * U, 2, type(uint256).max);
        vm.stopPrank();
    }

    function test_OpenInterestCapIsPerSideAndTiedToVault() public {
        // Cap is 20% of Vault assets (~1,000,000) = ~200,000 per side; the Vault's fee share nudges it up slightly.
        vm.prank(alice);
        perps.open(NYC, true, 2_000 * U, 100, type(uint256).max); // 200,000 long
        vm.prank(bob);
        vm.expectRevert(StoxhomesPerps.OpenInterestCap.selector);
        perps.open(NYC, true, 1_000 * U, 1, type(uint256).max);
        vm.prank(bob);
        perps.open(NYC, false, 2_000 * U, 100, 0); // the short side has its own cap
    }

    function test_Liquidation() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 100 * U, 100, type(uint256).max); // size 10,000; mm = 50
        uint256 liq = perps.liquidationPrice(id);
        assertEq(liq, 850_000 * P - (850_000 * P * 50) / 10_000); // 0.5% below entry

        setPrice(NYC, liq + 100 * P);
        vm.prank(keeper);
        vm.expectRevert(StoxhomesPerps.NotLiquidatable.selector);
        perps.liquidate(id);

        setPrice(NYC, liq);
        uint256 vaultBefore = usdg.balanceOf(address(vault));
        uint256 keeperBefore = usdg.balanceOf(keeper);
        vm.prank(keeper);
        uint256 reward = perps.liquidate(id);
        assertEq(reward, 10 * U); // 0.1% of size
        assertEq(usdg.balanceOf(keeper) - keeperBefore, 10 * U);
        assertEq(usdg.balanceOf(address(vault)) - vaultBefore, 90 * U);
        vm.prank(alice);
        vm.expectRevert(StoxhomesPerps.NoPosition.selector);
        perps.close(id, 0);
    }

    function test_BorrowFeeAccruesToTheVault() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 1_000 * U, 10, type(uint256).max);
        vm.warp(block.timestamp + 10 days);
        setPrice(NYC, 850_000 * P); // refresh
        (, uint256 borrow) = perps.positionPnl(id);
        assertEq(borrow, 10 * U); // 1 bp/day × 10 days × 10,000
        vm.prank(alice);
        uint256 paid = perps.close(id, 0);
        assertApproxEqAbs(paid, 1_000 * U - 10 * U - 6 * U, 1);
        assertLe(paid, 1_000 * U - 10 * U - 6 * U);
    }

    function test_StalePricesBlockExecution() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 100 * U, 5, type(uint256).max);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, NYC, 1_800_000_000));
        perps.close(id, 0);
        vm.prank(keeper);
        vm.expectRevert();
        perps.liquidate(id);
    }

    function test_PauseStopsOpensButNotExits() public {
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 100 * U, 5, type(uint256).max);
        vm.prank(owner);
        perps.pause();
        vm.prank(bob);
        vm.expectRevert();
        perps.open(NYC, true, 100 * U, 5, type(uint256).max);
        vm.prank(alice);
        perps.addCollateral(id, 10 * U);
        vm.prank(alice);
        perps.close(id, 0);
    }

    function test_OnlyOwnerCloses_AndHoldTime() public {
        vm.prank(owner);
        perps.setLimits(10 * U, 60);
        vm.prank(alice);
        uint256 id = perps.open(NYC, true, 100 * U, 5, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(StoxhomesPerps.NotOwner.selector);
        perps.close(id, 0);
        vm.prank(alice);
        vm.expectRevert(StoxhomesPerps.HoldTimeNotMet.selector);
        perps.close(id, 0);
        vm.warp(block.timestamp + 60);
        vm.prank(alice);
        perps.close(id, 0);
    }

    function test_AdminIsOwnerOnly() public {
        vm.startPrank(alice);
        vm.expectRevert();
        perps.listMarket("lon", defaultParams());
        vm.expectRevert();
        perps.setTreasury(alice, 10_000);
        vm.expectRevert();
        perps.pause();
        vm.expectRevert(StoxhomesVault.OnlyPerps.selector);
        vault.payout(alice, 1);
        vm.stopPrank();
    }

    function test_RejectsUnsafeMarketParams() public {
        StoxhomesPerps.MarketParams memory p = defaultParams();
        p.maintenanceBps = 100; // ≥ 1/maxLeverage would make positions liquidatable at open
        vm.prank(owner);
        vm.expectRevert(StoxhomesPerps.BadParams.selector);
        perps.listMarket("lon", p);
        p = defaultParams();
        p.maxLeverage = 101;
        vm.prank(owner);
        vm.expectRevert(StoxhomesPerps.BadParams.selector);
        perps.listMarket("lon", p);
    }

    /// Fuzz: settlement matches the exact PnL formula within rounding, always in the House's favour, and
    /// no USDG is ever created or destroyed.
    function testFuzz_Settlement(uint96 collateralRaw, uint8 levRaw, bool isLong, int16 moveBps) public {
        uint256 collateral = bound(uint256(collateralRaw), 10 * U, 1_500 * U);
        uint256 lev = bound(uint256(levRaw), 1, 100);
        int256 move = bound(int256(moveBps), -190, 190); // within one oracle step
        uint256 start = totalUsdg();

        vm.prank(alice);
        uint256 id = perps.open(NYC, isLong, collateral, lev, isLong ? type(uint256).max : 0);
        uint256 entry = 850_000 * P;
        uint256 exit = uint256(int256(entry) + (int256(entry) * move) / 10_000);
        setPrice(NYC, exit);

        uint256 size = collateral * lev;
        int256 exact = (int256(size) * (int256(exit) - int256(entry))) / int256(entry);
        if (!isLong) exact = -exact;
        int256 expected = int256(collateral) + exact - int256((size * 6 + 9_999) / 10_000);

        int256 eq = int256(collateral) + exact - int256((size * 50) / 10_000);
        if (eq <= 0) return; // would be liquidated first; covered elsewhere

        vm.prank(alice);
        uint256 paid = perps.close(id, isLong ? 0 : type(uint256).max);
        int256 want = expected > 0 ? expected : int256(0);
        assertLe(int256(paid), want + 1, "never pays more than the exact formula");
        assertGe(int256(paid) + 3, want, "and at most a few base units less");
        assertEq(totalUsdg(), start, "conservation");
    }
}
