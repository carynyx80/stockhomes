// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesVault} from "../src/StoxhomesVault.sol";

contract VaultTest is Base {
    function test_SharePriceSubtractsTraderProfitsButIgnoresTheirLosses() public {
        uint256 assets0 = vault.totalAssets();
        vm.prank(alice);
        perps.open(NYC, true, 1_000 * U, 10, type(uint256).max); // fee 6 → vault +3
        assertEq(vault.totalAssets(), assets0 + 3 * U);

        setPrice(NYC, 858_500 * P); // trader +100
        assertApproxEqAbs(vault.totalAssets(), assets0 + 3 * U - 100 * U, 1, "unrealised profit is a liability now");

        setPrice(NYC, 841_500 * P); // trader −100
        assertEq(vault.totalAssets(), assets0 + 3 * U, "unrealised losses aren't counted until realised");
    }

    function test_WithdrawalsCantTouchReservedLiquidity() public {
        vm.prank(alice);
        perps.open(NYC, true, 2_000 * U, 100, type(uint256).max); // 200,000 OI → 10% reserve = 20,000
        setPrice(NYC, 858_500 * P); // trader +2,000
        uint256 free = vault.freeLiquidity();
        uint256 bal = usdg.balanceOf(address(vault));
        assertApproxEqAbs(free, bal - 20_000 * U - 2_000 * U, 1);
        uint256 max = vault.maxWithdraw(lp);
        assertLe(max, free);
        assertApproxEqAbs(max, free, 1);
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(free + 1, lp, lp);
        vm.prank(lp);
        vault.withdraw(max, lp, lp);
    }

    function test_DepositsCanBePaused() public {
        vm.prank(owner);
        vault.setDepositsPaused(true);
        usdg.mint(bob, 10 * U);
        vm.startPrank(bob);
        usdg.approve(address(vault), 10 * U);
        vm.expectRevert();
        vault.deposit(10 * U, bob);
        vm.stopPrank();
    }

    function test_PerpsLinkIsOneTime() public {
        vm.prank(owner);
        vm.expectRevert(StoxhomesVault.PerpsAlreadySet.selector);
        vault.setPerps(alice);
    }

    function test_FirstDepositorInflationIsNeutralised() public {
        StoxhomesVault fresh = new StoxhomesVault(usdg, owner);
        usdg.mint(alice, 1 * U + 1_000_000 * U);
        vm.startPrank(alice);
        usdg.approve(address(fresh), type(uint256).max);
        fresh.deposit(1, alice); // 1 base unit
        usdg.transfer(address(fresh), 1_000_000 * U); // donation attack
        vm.stopPrank();
        usdg.mint(bob, 10_000 * U);
        vm.startPrank(bob);
        usdg.approve(address(fresh), type(uint256).max);
        uint256 shares = fresh.deposit(10_000 * U, bob);
        vm.stopPrank();
        assertGt(shares, 0, "the victim still gets shares");
        assertGt(fresh.previewRedeem(shares), 9_900 * U, "and keeps almost all of their deposit");
    }
}

contract OracleTest is Base {
    function test_OnlyPublishersPost() public {
        bytes32[] memory ms = new bytes32[](1);
        uint128[] memory ps = new uint128[](1);
        ms[0] = NYC;
        ps[0] = uint128(851_000 * P);
        vm.prank(alice);
        vm.expectRevert(PriceOracle.NotPublisher.selector);
        oracle.post(ms, ps);
    }

    function test_DeviationLimit() public {
        setPrice(NYC, 867_000 * P); // +2.0%: allowed
        bytes32[] memory ms = new bytes32[](1);
        uint128[] memory ps = new uint128[](1);
        ms[0] = NYC;
        ps[0] = uint128(885_000 * P); // +2.08%
        vm.prank(publisher);
        vm.expectRevert();
        oracle.post(ms, ps);
        // Index revisions go through the owner, visibly.
        vm.prank(owner);
        oracle.forcePost(NYC, uint128(885_000 * P));
        assertEq(oracle.priceOf(NYC), 885_000 * P);
    }

    function test_DisabledAndStaleFeeds() public {
        vm.prank(owner);
        oracle.configureFeed(NYC, 200, 1 days, false);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.FeedDisabled.selector, NYC));
        oracle.priceOf(NYC);
        vm.prank(owner);
        oracle.configureFeed(NYC, 200, 1 days, true);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert();
        oracle.priceOf(NYC);
    }
}
