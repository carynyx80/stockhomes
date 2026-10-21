// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesVault} from "../src/StoxhomesVault.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";

/// Test-only stand-in for USDG (6 decimals).
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract Base is Test {
    uint256 internal constant U = 1e6; // 1 USDG
    uint256 internal constant P = 1e8; // 1.0 in oracle units
    bytes32 internal constant NYC = "nyc";
    bytes32 internal constant MIA = "mia";

    MockUSDG internal usdg;
    PriceOracle internal oracle;
    StoxhomesVault internal vault;
    StoxhomesPerps internal perps;

    address internal owner = makeAddr("owner");
    address internal publisher = makeAddr("publisher");
    address internal treasury = makeAddr("treasury");
    address internal lp = makeAddr("lp");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    function defaultParams() internal pure returns (StoxhomesPerps.MarketParams memory) {
        return StoxhomesPerps.MarketParams({
            maxLeverage: 100,
            openFeeBps: 6,
            closeFeeBps: 6,
            maintenanceBps: 50,
            liquidationFeeBps: 10,
            borrowBpsPerDay: 1,
            maxOiBps: 2_000,
            reserveBps: 1_000
        });
    }

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdg = new MockUSDG();
        oracle = new PriceOracle(owner);
        vault = new StoxhomesVault(usdg, owner);
        perps = new StoxhomesPerps(usdg, vault, oracle, treasury, owner);

        vm.startPrank(owner);
        vault.setPerps(address(perps));
        oracle.setPublisher(publisher, true);
        oracle.configureFeed(NYC, 200, 1 days, true); // max 2% per post
        oracle.configureFeed(MIA, 200, 1 days, true);
        perps.listMarket(NYC, defaultParams());
        perps.listMarket(MIA, defaultParams());
        perps.setTreasury(treasury, 5_000); // half of trading fees to the $STOXH buyback treasury
        perps.setLimits(10 * U, 0);
        vm.stopPrank();

        setPrice(NYC, 850_000 * P);
        setPrice(MIA, 640_000 * P);

        // The House: 1,000,000 USDG.
        usdg.mint(lp, 1_000_000 * U);
        vm.startPrank(lp);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000 * U, lp);
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            address t = [alice, bob, keeper][i];
            usdg.mint(t, 100_000 * U);
            vm.prank(t);
            usdg.approve(address(perps), type(uint256).max);
        }
    }

    function setPrice(bytes32 m, uint256 price) internal {
        bytes32[] memory ms = new bytes32[](1);
        uint128[] memory ps = new uint128[](1);
        ms[0] = m;
        ps[0] = uint128(price);
        vm.prank(publisher);
        oracle.post(ms, ps);
    }

    /// Moves the price in steps the oracle accepts (≤ 2% per post).
    function walkPrice(bytes32 m, uint256 target) internal {
        (uint256 cur,) = oracle.lastPrice(m);
        while (cur != target) {
            uint256 step = cur / 60; // ~1.67%
            uint256 next = target > cur ? (target - cur > step ? cur + step : target) : (cur - target > step ? cur - step : target);
            setPrice(m, next);
            cur = next;
        }
    }

    function totalUsdg() internal view returns (uint256) {
        return usdg.balanceOf(address(vault)) + usdg.balanceOf(address(perps)) + usdg.balanceOf(treasury)
            + usdg.balanceOf(alice) + usdg.balanceOf(bob) + usdg.balanceOf(keeper) + usdg.balanceOf(lp);
    }
}
