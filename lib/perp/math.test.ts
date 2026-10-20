import { describe, expect, it } from "vitest";
import {
  distanceToLiquidationBps,
  feeOf,
  isLiquidatable,
  liquidationPrice,
  notionalOf,
  pnlOf,
} from "./math";

const USDG = 1_000_000n; // 6 decimals
const PX = 100_000_000n; // 8 decimals
const MM = 50; // 0.5% maintenance

describe("perp math", () => {
  it("computes notional and rounds fees up", () => {
    expect(notionalOf(100n * USDG, 10)).toBe(1_000n * USDG);
    expect(feeOf(1_000n * USDG, 6)).toBe(600_000n); // 0.6 USDG
    expect(feeOf(1n, 6)).toBe(1n); // never zero on a non-zero notional
    expect(() => notionalOf(USDG, 0)).toThrow();
    expect(() => notionalOf(USDG, 2.5)).toThrow();
  });

  it("computes PnL for long and short", () => {
    const n = 1_000n * USDG;
    expect(pnlOf("long", n, 100n * PX, 101n * PX)).toBe(10n * USDG);
    expect(pnlOf("short", n, 100n * PX, 101n * PX)).toBe(-10n * USDG);
    expect(pnlOf("short", n, 100n * PX, 99n * PX)).toBe(10n * USDG);
  });

  it("puts the 10x liquidation price where equity meets maintenance", () => {
    const collateral = 100n * USDG;
    const notional = notionalOf(collateral, 10);
    const entry = 100n * PX;
    // cushion = 100 − 5 = 95 USDG → 9.5% of notional
    expect(liquidationPrice("long", entry, collateral, notional, MM)).toBe(9_050_000_000n);
    expect(liquidationPrice("short", entry, collateral, notional, MM)).toBe(10_950_000_000n);
  });

  it("liquidates exactly at the liquidation price and not a tick before", () => {
    const collateral = 250n * USDG;
    const notional = notionalOf(collateral, 25);
    const entry = 78_200_000n * PX / 100n;
    for (const side of ["long", "short"] as const) {
      const liq = liquidationPrice(side, entry, collateral, notional, MM);
      const safer = side === "long" ? liq + 1_000n : liq - 1_000n;
      const worse = side === "long" ? liq - 1_000n : liq + 1_000n;
      expect(isLiquidatable(side, entry, collateral, notional, safer, MM)).toBe(false);
      expect(isLiquidatable(side, entry, collateral, notional, worse, MM)).toBe(true);
    }
  });

  it("leaves about half a percent of room at 100x", () => {
    const collateral = 50n * USDG;
    const notional = notionalOf(collateral, 100);
    const entry = 500_000n * PX;
    const liq = liquidationPrice("long", entry, collateral, notional, MM);
    expect(distanceToLiquidationBps(entry, liq)).toBe(50);
  });
});
