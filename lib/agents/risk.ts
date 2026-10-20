import { RISK } from "@/config/openHouse";
import { DECIMALS } from "@/config/stoxhomes";
import type { Side } from "@/lib/perp/math";
import type { Decision } from "./decision";
import type { AgentRisk, AgentStatus, AgentTrade } from "./types";

/**
 * The risk engine decides; the model only suggests. Every number from the model is treated as untrusted:
 * clamped to the agent's limits (and the global ceilings) or rejected. Pure and integer-only.
 */

const USDG = 10n ** BigInt(DECIMALS.usdg);
const BPS = 10_000n;

export type OpenPlan = { marketId: string; side: Side; leverage: number; collateral: bigint };

export type RiskResult =
  | { kind: "hold"; notes: string[] }
  | { kind: "open"; open: OpenPlan; notes: string[] }
  | { kind: "close"; tradeIds: string[]; notes: string[] }
  | { kind: "adjust"; tradeIds: string[]; open: OpenPlan; notes: string[] }
  | { kind: "reject"; reasons: string[]; notes: string[] };

export type RiskInput = {
  status: AgentStatus;
  cities: string[];
  risk: AgentRisk;
  decision: Decision;
  cash: bigint;
  equity: bigint;
  dayStartEquity: bigint;
  openTrades: AgentTrade[];
  knownMarkets: readonly string[];
  minCollateral: bigint;
  openFeeBps: number;
};

/** The agent's limits, never looser than the global ceilings. */
export function effectiveLimits(r: AgentRisk): AgentRisk {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(v)));
  return {
    maxLeverage: clamp(r.maxLeverage, 1, RISK.leverageCeiling),
    maxPositionPct: clamp(r.maxPositionPct, 1, RISK.maxPositionPctCeiling),
    maxOpenPositions: clamp(r.maxOpenPositions, 1, RISK.maxOpenPositionsCeiling),
    dailyLossLimitPct: clamp(r.dailyLossLimitPct, 1, 100),
  };
}

export function dailyLossLimitHit(equity: bigint, dayStartEquity: bigint, limitPct: number): boolean {
  if (dayStartEquity <= 0n) return true;
  const loss = dayStartEquity - equity;
  return loss * 100n >= dayStartEquity * BigInt(limitPct);
}

/** USDG float from the model → fixed point, rounded down. Null for anything that isn't a positive finite number. */
export function usdgFromModel(n: number): bigint | null {
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  return BigInt(Math.floor(n * Number(USDG)));
}

function planOpen(input: RiskInput, cashAvailable: bigint, openCount: number, notes: string[]): OpenPlan | string[] {
  const { decision: d } = input;
  const lim = effectiveLimits(input.risk);
  const reasons: string[] = [];
  const market = d.market.trim().toLowerCase();

  if (!input.knownMarkets.includes(market)) reasons.push(`unknown market "${d.market}"`);
  else if (!input.cities.includes(market)) reasons.push(`market "${market}" is not one of this agent's cities`);
  if (openCount >= lim.maxOpenPositions) reasons.push(`already at the ${lim.maxOpenPositions}-position limit`);
  if (dailyLossLimitHit(input.equity, input.dayStartEquity, lim.dailyLossLimitPct)) {
    reasons.push(`daily loss limit (${lim.dailyLossLimitPct}%) reached; only closes allowed today`);
  }

  let leverage = Number.isFinite(d.leverage) ? Math.floor(d.leverage) : NaN;
  if (!Number.isFinite(leverage)) reasons.push("leverage is not a number");
  else if (leverage < 1) {
    notes.push(`leverage ${d.leverage} raised to 1x`);
    leverage = 1;
  } else if (leverage > lim.maxLeverage) {
    notes.push(`leverage ${d.leverage}x clamped to ${lim.maxLeverage}x`);
    leverage = lim.maxLeverage;
  }

  let collateral = usdgFromModel(d.sizeUsdg);
  if (collateral == null) reasons.push(`size ${d.sizeUsdg} is not a positive amount`);
  if (reasons.length) return reasons;

  const cap = (input.equity * BigInt(lim.maxPositionPct)) / 100n;
  if (cap <= 0n) return ["no equity to trade with"];
  if (collateral! > cap) {
    notes.push(`size clamped to ${lim.maxPositionPct}% of equity`);
    collateral = cap;
  }
  // Collateral plus the open fee (leverage × fee on collateral) must fit in free cash.
  const affordable = (cashAvailable * BPS) / (BPS + BigInt(leverage * input.openFeeBps));
  if (collateral! > affordable) {
    notes.push("size clamped to available margin");
    collateral = affordable;
  }
  if (collateral! < input.minCollateral) return [`size below the ${input.minCollateral / USDG} USDG minimum after limits`];

  return { marketId: market, side: d.side, leverage, collateral: collateral! };
}

export function evaluate(input: RiskInput): RiskResult {
  const notes: string[] = [];
  const d = input.decision;

  if (input.status !== "active") return { kind: "reject", reasons: [`agent is ${input.status}`], notes };
  if (d.action === "hold") return { kind: "hold", notes };

  const market = d.market.trim().toLowerCase();
  const inMarket = input.openTrades.filter((t) => t.status === "open" && t.marketId === market);

  if (d.action === "close") {
    if (inMarket.length === 0) return { kind: "reject", reasons: [`no open position in "${d.market}" to close`], notes };
    return { kind: "close", tradeIds: inMarket.map((t) => t.id), notes };
  }

  const openCount = input.openTrades.filter((t) => t.status === "open").length;
  if (d.action === "open") {
    const plan = planOpen(input, input.cash, openCount, notes);
    return Array.isArray(plan) ? { kind: "reject", reasons: plan, notes } : { kind: "open", open: plan, notes };
  }

  // adjust = close what's open in that market, then open the new size. Sized against current free cash only
  // (what the close returns isn't counted), so an adjust can never exceed what a fresh open could.
  const plan = planOpen(input, input.cash, openCount - inMarket.length, notes);
  if (Array.isArray(plan)) return { kind: "reject", reasons: plan, notes };
  return { kind: "adjust", tradeIds: inMarket.map((t) => t.id), open: plan, notes };
}
