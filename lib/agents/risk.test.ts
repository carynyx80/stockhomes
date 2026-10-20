import { describe, expect, it } from "vitest";
import type { Decision } from "./decision";
import { parseDecision } from "./decision";
import { dailyLossLimitHit, effectiveLimits, evaluate, usdgFromModel, type RiskInput } from "./risk";
import type { AgentTrade } from "./types";

const U = 1_000_000n; // 1 USDG
const MARKETS = ["nyc", "mia", "lax", "lon", "dxb", "los"];

const decision = (over: Partial<Decision> = {}): Decision => ({
  action: "open",
  market: "mia",
  side: "long",
  sizeUsdg: 500,
  leverage: 5,
  reason: "test",
  commentary: "test",
  ...over,
});

const trade = (over: Partial<AgentTrade> = {}): AgentTrade => ({
  id: `t${Math.random()}`,
  agentId: 1,
  marketId: "mia",
  side: "long",
  leverage: 5,
  collateral: 100n * U,
  notional: 500n * U,
  entryPrice: 100n,
  liquidationPrice: 90n,
  openFee: 1n,
  openedAt: 0,
  status: "open",
  equityAtOpen: 10_000n * U,
  reason: "",
  ...over,
});

const input = (over: Partial<RiskInput> = {}): RiskInput => ({
  status: "active",
  cities: ["mia", "nyc"],
  risk: { maxLeverage: 10, maxPositionPct: 20, maxOpenPositions: 3, dailyLossLimitPct: 15 },
  decision: decision(),
  cash: 10_000n * U,
  equity: 10_000n * U,
  dayStartEquity: 10_000n * U,
  openTrades: [],
  knownMarkets: MARKETS,
  minCollateral: 10n * U,
  openFeeBps: 6,
  ...over,
});

describe("risk engine: opens", () => {
  it("passes a decision inside every limit untouched", () => {
    const r = evaluate(input());
    expect(r).toEqual({ kind: "open", open: { marketId: "mia", side: "long", leverage: 5, collateral: 500n * U }, notes: [] });
  });

  it("clamps leverage to the agent's max, and never above the 25x ceiling", () => {
    const r = evaluate(input({ decision: decision({ leverage: 80 }) }));
    expect(r.kind === "open" && r.open.leverage).toBe(10);
    expect(r.notes[0]).toMatch(/clamped to 10x/);

    const wild = evaluate(input({ risk: { maxLeverage: 100, maxPositionPct: 20, maxOpenPositions: 3, dailyLossLimitPct: 15 }, decision: decision({ leverage: 100 }) }));
    expect(wild.kind === "open" && wild.open.leverage).toBe(25);
    expect(effectiveLimits({ maxLeverage: 100, maxPositionPct: 90, maxOpenPositions: 99, dailyLossLimitPct: 15 })).toEqual({
      maxLeverage: 25,
      maxPositionPct: 50,
      maxOpenPositions: 6,
      dailyLossLimitPct: 15,
    });
  });

  it("raises leverage below 1 and floors fractions", () => {
    expect(evaluate(input({ decision: decision({ leverage: 0 }) })).kind === "open").toBe(true);
    const r = evaluate(input({ decision: decision({ leverage: 7.9 }) }));
    expect(r.kind === "open" && r.open.leverage).toBe(7);
  });

  it("clamps size to maxPositionPct of equity", () => {
    const r = evaluate(input({ decision: decision({ sizeUsdg: 9_000 }) }));
    expect(r.kind === "open" && r.open.collateral).toBe(2_000n * U);
    expect(r.notes).toContain("size clamped to 20% of equity");
  });

  it("clamps size to free margin including the open fee", () => {
    const r = evaluate(input({ cash: 300n * U, decision: decision({ sizeUsdg: 1_000, leverage: 10 }) }));
    expect(r.kind).toBe("open");
    if (r.kind !== "open") return;
    const fee = (r.open.collateral * 10n * 6n + 9_999n) / 10_000n;
    expect(r.open.collateral + fee <= 300n * U).toBe(true);
    expect(r.notes).toContain("size clamped to available margin");
  });

  it("rejects other agents' cities and unknown markets", () => {
    expect(evaluate(input({ decision: decision({ market: "lon" }) }))).toMatchObject({ kind: "reject", reasons: [expect.stringMatching(/not one of this agent's cities/)] });
    expect(evaluate(input({ decision: decision({ market: "atlantis" }) }))).toMatchObject({ kind: "reject", reasons: [expect.stringMatching(/unknown market/)] });
    // Case and whitespace from the model are tolerated.
    expect(evaluate(input({ decision: decision({ market: " MIA " }) })).kind).toBe("open");
  });

  it("rejects non-numbers, negatives and dust", () => {
    for (const sizeUsdg of [Number.NaN, -5, 0, Infinity, 1e20]) {
      expect(evaluate(input({ decision: decision({ sizeUsdg }) })).kind).toBe("reject");
    }
    expect(evaluate(input({ decision: decision({ leverage: Number.NaN }) })).kind).toBe("reject");
    expect(evaluate(input({ decision: decision({ sizeUsdg: 5 }) }))).toMatchObject({ kind: "reject", reasons: [expect.stringMatching(/minimum/)] });
  });

  it("rejects a fourth position", () => {
    const r = evaluate(input({ openTrades: [trade(), trade({ marketId: "nyc" }), trade()] }));
    expect(r).toMatchObject({ kind: "reject", reasons: [expect.stringMatching(/3-position limit/)] });
  });

  it("allows only closes once the daily loss limit is hit", () => {
    const hit = { equity: 8_500n * U, dayStartEquity: 10_000n * U };
    expect(dailyLossLimitHit(hit.equity, hit.dayStartEquity, 15)).toBe(true);
    expect(dailyLossLimitHit(8_501n * U, 10_000n * U, 15)).toBe(false);
    expect(evaluate(input(hit))).toMatchObject({ kind: "reject", reasons: [expect.stringMatching(/daily loss limit/)] });
    expect(evaluate(input({ ...hit, openTrades: [trade()], decision: decision({ action: "close" }) })).kind).toBe("close");
  });

  it("rejects everything for a paused or boarded-up agent", () => {
    expect(evaluate(input({ status: "boarded_up", decision: decision({ action: "hold" }) })).kind).toBe("reject");
    expect(evaluate(input({ status: "paused" })).kind).toBe("reject");
  });
});

describe("risk engine: close, adjust, hold", () => {
  it("closes every open position in the market, and rejects closing nothing", () => {
    const a = trade({ id: "a" });
    const b = trade({ id: "b" });
    const r = evaluate(input({ openTrades: [a, b, trade({ id: "c", marketId: "nyc" })], decision: decision({ action: "close" }) }));
    expect(r).toEqual({ kind: "close", tradeIds: ["a", "b"], notes: [] });
    expect(evaluate(input({ decision: decision({ action: "close" }) })).kind).toBe("reject");
  });

  it("adjust closes then reopens within the same limits", () => {
    const r = evaluate(input({ openTrades: [trade({ id: "a" })], decision: decision({ action: "adjust", leverage: 50, sizeUsdg: 50_000 }) }));
    expect(r.kind).toBe("adjust");
    if (r.kind !== "adjust") return;
    expect(r.tradeIds).toEqual(["a"]);
    expect(r.open.leverage).toBe(10);
    expect(r.open.collateral).toBe(2_000n * U);
  });

  it("holds", () => {
    expect(evaluate(input({ decision: decision({ action: "hold" }) })).kind).toBe("hold");
  });
});

describe("model output validation", () => {
  it("accepts only the exact decision shape", () => {
    expect(parseDecision(JSON.stringify(decision()))).toEqual(decision());
    expect(parseDecision("not json")).toBeNull();
    expect(parseDecision('{"action":"yolo"}')).toBeNull();
    expect(parseDecision({ ...decision(), action: "buy" })).toBeNull();
    expect(parseDecision({ ...decision(), sizeUsdg: "lots" })).toBeNull();
    expect(parseDecision(null)).toBeNull();
  });

  it("converts model sizes to fixed point, rounding down", () => {
    expect(usdgFromModel(12.3456789)).toBe(12_345_678n);
    expect(usdgFromModel(-1)).toBeNull();
    expect(usdgFromModel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
