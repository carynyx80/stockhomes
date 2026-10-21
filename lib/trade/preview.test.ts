import { describe, expect, it } from "vitest";
import { outcomeAt, preview, priceForRoe, replay, type FeeSchedule } from "./preview";

const U = 1_000_000n; // 1 USDG
const P = 100_000_000n; // 1.00 in price units
const f: FeeSchedule = { openFeeBps: 6, closeFeeBps: 6, maintenanceBps: 50, borrowBpsPerDay: 1 };
const long = { side: "long" as const, entry: 800_000n * P, collateral: 1_000n * U, leverage: 10 };

describe("trade preview", () => {
  it("prices fees, liquidation and TP/SL like the contracts", () => {
    const p = preview({ ...long, takeProfit: 808_000n * P, stopLoss: 796_000n * P }, f);
    expect(p.notional).toBe(10_000n * U);
    expect(p.openFee).toBe(6n * U);
    expect(p.closeFee).toBe(6n * U);
    // (collateral − maintenance) / size = (1000 − 50) / 10000 = 9.5%
    expect(p.liquidation).toBe(724_000n * P);
    expect(p.liqDistanceBps).toBe(950);
    expect(p.borrowPerDay).toBe(1n * U);
    expect(p.tpPnl).toBe(100n * U - 12n * U); // +1% on 10,000, minus both fees
    expect(p.slPnl).toBe(-50n * U - 12n * U);
  });

  it("models a move, borrow fees and liquidation", () => {
    const up = outcomeAt(long, f, 100, 10); // +1%, held 10 days
    expect(up.pnl).toBe(100n * U - 10n * U - 12n * U);
    expect(up.roeBps).toBe(780);
    expect(up.liquidated).toBe(false);
    const wipe = outcomeAt(long, f, -960);
    expect(wipe.liquidated).toBe(true);
    expect(wipe.pnl).toBe(-(1_000n * U + 6n * U)); // margin and the open fee, no more
    expect(wipe.equity).toBe(0n);
  });

  it("converts a return on collateral to a price for each side", () => {
    expect(priceForRoe("long", 800_000n * P, 10, 5_000)).toBe(840_000n * P); // +50% ROE at 10x = +5%
    expect(priceForRoe("short", 800_000n * P, 100, 5_000)).toBe(796_000n * P); // +50% at 100x = −0.5%
  });

  it("replays history and stops at the first trigger or liquidation", () => {
    const day = 86_400_000;
    const path = [800_000n, 804_000n, 790_000n, 812_000n, 830_000n].map((v, i) => ({ t: i * day, price: v * P }));
    const held = replay(long, f, path, 0);
    expect(held?.ending).toBe("open");
    expect(held?.exit).toBe(830_000n * P);
    expect(held?.worstPnl).toBeLessThan(0n);

    const tp = replay(long, f, path, 0, { tpMoveBps: 100 }); // +1% = 808,000: first reached on day 3
    expect(tp?.ending).toBe("take-profit");
    expect(tp?.exitAt).toBe(3 * day);

    const hundredX = replay({ ...long, leverage: 100 }, f, path, 0); // liquidation 0.5% down: day 2 at −1.25%
    expect(hundredX?.ending).toBe("liquidated");
    expect(hundredX?.exitAt).toBe(2 * day);

    expect(replay(long, f, path, 4)).toBeNull();
  });
});
