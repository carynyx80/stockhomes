// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {MockUSDG} from "./Base.t.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {StoxhomesPerps} from "../src/StoxhomesPerps.sol";

/// Random traders opening, closing, adding margin and getting liquidated while prices wander.
contract Handler is Test {
    StoxhomesPerps internal perps;
    PriceOracle internal oracle;
    MockUSDG internal usdg;
    address internal publisher;
    address[3] internal traders;
    bytes32[2] internal mkts = [bytes32("nyc"), bytes32("mia")];

    uint256[] public openIds;
    uint256 public sumCollateral;
    uint256[] public orderIds;
    /// Collateral plus fee held for resting orders.
    uint256 public sumEscrow;

    constructor(StoxhomesPerps perps_, PriceOracle oracle_, MockUSDG usdg_, address publisher_, address[3] memory traders_) {
        perps = perps_;
        oracle = oracle_;
        usdg = usdg_;
        publisher = publisher_;
        traders = traders_;
    }

    function openPosition(uint256 who, uint256 mkt, bool isLong, uint256 collateral, uint256 lev) external {
        address t = traders[who % 3];
        collateral = bound(collateral, 10e6, 5_000e6);
        lev = bound(lev, 1, 100);
        vm.prank(t);
        try perps.open(mkts[mkt % 2], isLong, collateral, lev, isLong ? type(uint256).max : 0) returns (uint256 id) {
            openIds.push(id);
            sumCollateral += collateral;
        } catch {}
    }

    function closePosition(uint256 idx) external {
        if (openIds.length == 0) return;
        idx %= openIds.length;
        uint256 id = openIds[idx];
        StoxhomesPerps.Position memory p = perps.position(id);
        vm.prank(p.owner);
        try perps.close(id, p.isLong ? 0 : type(uint256).max) {
            _forget(idx, p.collateral);
        } catch {}
    }

    function liquidate(uint256 idx) external {
        if (openIds.length == 0) return;
        idx %= openIds.length;
        uint256 id = openIds[idx];
        StoxhomesPerps.Position memory p = perps.position(id);
        vm.prank(traders[2]); // the keeper, so rewards stay in the tracked set
        try perps.liquidate(id) {
            _forget(idx, p.collateral);
        } catch {}
    }

    function addMargin(uint256 idx, uint256 amount) external {
        if (openIds.length == 0) return;
        uint256 id = openIds[idx % openIds.length];
        StoxhomesPerps.Position memory p = perps.position(id);
        amount = bound(amount, 1, 1_000e6);
        vm.prank(p.owner);
        try perps.addCollateral(id, amount) {
            sumCollateral += amount;
        } catch {}
    }

    function decrease(uint256 idx, uint256 bps) external {
        if (openIds.length == 0) return;
        idx %= openIds.length;
        uint256 id = openIds[idx];
        StoxhomesPerps.Position memory p = perps.position(id);
        uint256 delta = (uint256(p.size) * bound(bps, 1, 10_000)) / 10_000;
        if (delta == 0) return;
        vm.prank(p.owner);
        try perps.decrease(id, delta, p.isLong ? 0 : type(uint256).max) {
            StoxhomesPerps.Position memory q = perps.position(id);
            if (q.owner == address(0)) _forget(idx, p.collateral);
            else sumCollateral -= p.collateral - q.collateral;
        } catch {}
    }

    function removeMargin(uint256 idx, uint256 amount) external {
        if (openIds.length == 0) return;
        uint256 id = openIds[idx % openIds.length];
        StoxhomesPerps.Position memory p = perps.position(id);
        amount = bound(amount, 1, p.collateral);
        vm.prank(p.owner);
        try perps.removeCollateral(id, amount) {
            sumCollateral -= amount;
        } catch {}
    }

    function placeOrder(uint256 who, uint256 mkt, bool isLong, bool above, uint256 collateral, uint256 lev, int256 offsetBps) external {
        address t = traders[who % 3];
        bytes32 m = mkts[mkt % 2];
        collateral = bound(collateral, 10e6, 5_000e6);
        lev = bound(lev, 1, 100);
        (uint256 cur,) = oracle.lastPrice(m);
        uint256 trigger = uint256(int256(cur) + (int256(cur) * bound(offsetBps, -200, 200)) / 10_000);
        uint256 before = usdg.balanceOf(address(perps));
        vm.prank(t);
        try perps.placeOrder(m, isLong, collateral, lev, trigger, above, 0, 0) returns (uint256 id) {
            orderIds.push(id);
            sumEscrow += usdg.balanceOf(address(perps)) - before;
        } catch {}
    }

    function cancelOrder(uint256 idx) external {
        if (orderIds.length == 0) return;
        idx %= orderIds.length;
        StoxhomesPerps.Order memory o = perps.order(orderIds[idx]);
        vm.prank(o.owner);
        try perps.cancelOrder(orderIds[idx]) {
            sumEscrow -= uint256(o.collateral) + o.fee;
            _forgetOrder(idx);
        } catch {}
    }

    function executeOrder(uint256 idx) external {
        if (orderIds.length == 0) return;
        idx %= orderIds.length;
        StoxhomesPerps.Order memory o = perps.order(orderIds[idx]);
        vm.prank(traders[2]);
        try perps.executeOrder(orderIds[idx]) returns (uint256 positionId) {
            sumEscrow -= uint256(o.collateral) + o.fee;
            sumCollateral += o.collateral;
            openIds.push(positionId);
            _forgetOrder(idx);
        } catch {}
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function _forgetOrder(uint256 idx) private {
        orderIds[idx] = orderIds[orderIds.length - 1];
        orderIds.pop();
    }

    function movePrice(uint256 mkt, int256 bps) external {
        bytes32 m = mkts[mkt % 2];
        (uint256 cur,) = oracle.lastPrice(m);
        bps = bound(bps, -150, 150);
        bytes32[] memory ms = new bytes32[](1);
        uint128[] memory ps = new uint128[](1);
        ms[0] = m;
        ps[0] = uint128(uint256(int256(cur) + (int256(cur) * bps) / 10_000));
        vm.prank(publisher);
        oracle.post(ms, ps);
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        // keep prices fresh
        for (uint256 i; i < 2; ++i) {
            (uint256 cur,) = oracle.lastPrice(mkts[i]);
            bytes32[] memory ms = new bytes32[](1);
            uint128[] memory ps = new uint128[](1);
            ms[0] = mkts[i];
            ps[0] = uint128(cur);
            vm.prank(publisher);
            oracle.post(ms, ps);
        }
    }

    function openCount() external view returns (uint256) {
        return openIds.length;
    }

    function _forget(uint256 idx, uint256 collateral) private {
        sumCollateral -= collateral;
        openIds[idx] = openIds[openIds.length - 1];
        openIds.pop();
    }
}

contract InvariantTest is Base {
    Handler internal handler;
    uint256 internal minted;

    function setUp() public override {
        super.setUp();
        handler = new Handler(perps, oracle, usdg, publisher, [alice, bob, keeper]);
        minted = totalUsdg();
        targetContract(address(handler));
    }

    /// The exchange holds exactly the collateral of open positions plus resting-order escrow: never more, never less.
    function invariant_PerpsHoldsExactlyOpenCollateral() public view {
        assertEq(usdg.balanceOf(address(perps)), handler.sumCollateral() + handler.sumEscrow());
    }

    /// USDG is only ever moved, never created or lost.
    function invariant_Conservation() public view {
        assertEq(totalUsdg(), minted);
    }

    /// Aggregate open interest equals the sum of open positions' sizes.
    function invariant_OpenInterestMatchesPositions() public view {
        uint256 long;
        uint256 short;
        uint256 longUnits;
        uint256 shortUnits;
        for (uint256 i; i < handler.openCount(); ++i) {
            StoxhomesPerps.Position memory p = perps.position(handler.openIds(i));
            if (p.isLong) {
                long += p.size;
                longUnits += p.units;
            } else {
                short += p.size;
                shortUnits += p.units;
            }
        }
        StoxhomesPerps.Market memory a = perps.market(NYC);
        StoxhomesPerps.Market memory b = perps.market(MIA);
        assertEq(a.longSize + b.longSize, long);
        assertEq(a.shortSize + b.shortSize, short);
        assertEq(a.longUnits + b.longUnits, longUnits);
        assertEq(a.shortUnits + b.shortUnits, shortUnits);
        assertEq(perps.openPositionCount(), handler.openCount());
        assertEq(perps.openOrderCount(), handler.orderCount());
    }
}
