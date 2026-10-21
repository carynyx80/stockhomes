import type { OracleMarket } from "@/config/oracle";

/** One monthly reading: "YYYY-MM" and the value (USD for Zillow, GBP for UK HPI). */
export type Observation = { month: string; value: number };

const monthStart = (month: string, plusMonths = 0) => {
  const [y, m] = month.split("-").map(Number);
  return Date.UTC(y, m - 1 + plusMonths, 1);
};

export function sortObservations(obs: Observation[]): Observation[] {
  return [...obs].filter((o) => Number.isFinite(o.value) && o.value > 0).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * The USD price of a market at time t: reading × scale, glided linearly between readings.
 * Reading m is fully reflected at the start of month m + lag; before the first point the first price holds,
 * after the last point the last price holds.
 */
export function marketPriceAt(market: Pick<OracleMarket, "scale" | "lagMonths">, obs: Observation[], t: number): number {
  const sorted = sortObservations(obs);
  if (!sorted.length) throw new Error("no readings");
  const points = sorted.map((o) => ({ t: monthStart(o.month, market.lagMonths), price: o.value * market.scale }));
  if (t <= points[0].t) return points[0].price;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      return a.price + ((b.price - a.price) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].price;
}

/** To 8-decimal oracle units. */
export const toOracleUnits = (usd: number): bigint => BigInt(Math.round(usd * 1e8));

/**
 * The next price to post, given what's on-chain: the target, but never more than maxStepBps away
 * (the oracle rejects big jumps; large gaps are walked over several posts).
 */
export function nextPost(current: bigint, target: bigint, maxStepBps: number): bigint {
  if (current === 0n) return target;
  const maxStep = (current * BigInt(maxStepBps)) / 10_000n;
  if (target > current + maxStep) return current + maxStep;
  if (target < current - maxStep) return current - maxStep;
  return target;
}
