import { SIMULATED } from "@/config/stoxhomes";
import { DAY } from "./feeds";
import { gaussian, hashString } from "./prng";

/**
 * The House pool, simulated. Share price compounds a noisy daily yield (the House usually wins
 * against traders, but not every day); TVL drifts with deposits and withdrawals.
 */

const yieldSeed = hashString("stoxhomes:vault:yield");
const flowSeed = hashString("stoxhomes:vault:flow");
const utilSeed = hashString("stoxhomes:vault:util");

const logShare: number[] = [];
const logFlow: number[] = [];

function cumulative(arr: number[], d: number, step: (i: number) => number): number {
  if (d < 0) return 0;
  for (let i = arr.length; i <= d; i++) arr.push((i === 0 ? 0 : arr[i - 1]) + step(i));
  return arr[d];
}

const dailyYield = (i: number) => SIMULATED.vault.meanApr / 365 + 0.0004 * gaussian(yieldSeed, i);
const dailyFlow = (i: number) => 0.0004 + 0.008 * gaussian(flowSeed, i);

function interpolate(arr: number[], step: (i: number) => number, t: number): number {
  const since = Math.max(0, t - SIMULATED.genesis);
  const d = Math.floor(since / DAY);
  const frac = (since - d * DAY) / DAY;
  const a = cumulative(arr, d - 1, step);
  const b = cumulative(arr, d, step);
  return a + (b - a) * frac;
}

/** USDG per share. Starts at 1.00. */
export function sharePriceAt(t: number): number {
  return Math.exp(interpolate(logShare, dailyYield, t));
}

export function tvlAt(t: number): number {
  return SIMULATED.vault.baseTvlUsdg * Math.exp(interpolate(logFlow, dailyFlow, t)) * sharePriceAt(t);
}

export function apr7dAt(t: number): number {
  return (sharePriceAt(t) / sharePriceAt(t - 7 * DAY) - 1) * (365 / 7);
}

/** Share of the pool backing open positions, 0–1. */
export function utilizationAt(t: number): number {
  const day = Math.floor((t - SIMULATED.genesis) / DAY);
  const wave = Math.sin((t - SIMULATED.genesis) / (3.3 * DAY));
  return Math.min(0.85, Math.max(0.15, 0.42 + 0.14 * wave + 0.05 * gaussian(utilSeed, day)));
}

/** Long share of open interest, 0–1. */
export function longSkewAt(t: number): number {
  return 0.5 + 0.12 * Math.sin((t - SIMULATED.genesis) / (5.1 * DAY));
}
