// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

contract TestUSDGTest is Test {
    function test_FaucetOncePerDay() public {
        vm.warp(1_800_000_000);
        TestUSDG t = new TestUSDG(address(this));
        address u = makeAddr("u");
        vm.prank(u);
        t.faucet();
        assertEq(t.balanceOf(u), 10_000e6);
        vm.prank(u);
        vm.expectRevert();
        t.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(u);
        t.faucet();
        assertEq(t.balanceOf(u), 20_000e6);
    }

    function test_RefusesMainnet() public {
        vm.chainId(4663);
        vm.expectRevert(TestUSDG.MainnetNotAllowed.selector);
        new TestUSDG(address(this));
    }
}
