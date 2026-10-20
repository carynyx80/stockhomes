import { SIMULATED } from "@/config/stoxhomes";
import { marketById, type Market } from "./markets";
import { gaussian, hashString } from "./prng";

/**
 * Mock city price feeds: a seeded random walk that is a pure function of time, so every visitor
 * (and every reload) sees the same prices.
 *
 * Daily closes: log-returns of drift + dailyVol × N(0,1).
 * Inside a day: a Brownian bridge pinned to that day's open and close, sampled per minute and
 * interpolated per second, so the tape moves without breaking the daily statistics.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const MINUTES_PER_DAY = 1440;

const logCloses = new Map<string, number[]>(); // per market: cumulative log price at each day's close
const bridges = new Map<string, Float64Array>(); // per market+day: bridge offsets per minute

function seedFor(m: Market, tag: string) {
  return hashString(`stoxhomes:${m.id}:${tag}`);
}

/** Log price at the close of day `d` (d = -1 is the genesis level). */
function logCloseAt(m: Market, d: number): number {
  if (d < 0) return Math.log(m.base);
  let arr = logCloses.get(m.id);
  if (!arr) logCloses.set(m.id, (arr = []));
  const seed = seedFor(m, "daily");
  for (let i = arr.length; i <= d; i++) {
    const prev = i === 0 ? Math.log(m.base) : arr[i - 1];
    arr.push(prev + m.drift + SIMULATED.dailyVol * gaussian(seed, i));
  }
  return arr[d];
}

function bridgeFor(m: Market, d: number): Float64Array {
  const key = `${m.id}:${d}`;
  const hit = bridges.get(key);
  if (hit) return hit;
  const seed = seedFor(m, `intraday:${d}`);
  const step = SIMULATED.dailyVol / Math.sqrt(MINUTES_PER_DAY);
  const w = new Float64Array(MINUTES_PER_DAY + 1);
  for (let i = 1; i <= MINUTES_PER_DAY; i++) w[i] = w[i - 1] + step * gaussian(seed, i);
  const end = w[MINUTES_PER_DAY];
  for (let i = 0; i <= MINUTES_PER_DAY; i++) w[i] -= (i / MINUTES_PER_DAY) * end;
  if (bridges.size > 64) bridges.delete(bridges.keys().next().value!);
  bridges.set(key, w);
  return w;
}

/** Simulated index level (USD) for a market at time `t` (ms since epoch). */
export function priceAt(marketId: string, t: number): number {
  const m = marketById(marketId);
  const since = Math.max(0, t - SIMULATED.genesis);
  const d = Math.floor(since / DAY);
  const minutes = (since - d * DAY) / MINUTE;
  const open = logCloseAt(m, d - 1);
  const close = logCloseAt(m, d);
  const w = bridgeFor(m, d);
  const i = Math.min(MINUTES_PER_DAY - 1, Math.floor(minutes));
  const frac = minutes - i;
  const b = w[i] + (w[i + 1] - w[i]) * frac;
  return Math.exp(open + (close - open) * (minutes / MINUTES_PER_DAY) + b);
}

export type PricePoint = { t: number; price: number };

export function series(marketId: string, from: number, to: number, stepMs: number): PricePoint[] {
  const out: PricePoint[] = [];
  const start = Math.max(SIMULATED.genesis, Math.ceil(from / stepMs) * stepMs);
  for (let t = start; t <= to; t += stepMs) out.push({ t, price: priceAt(marketId, t) });
  if (out.length === 0 || out[out.length - 1].t !== to) out.push({ t: to, price: priceAt(marketId, to) });
  return out;
}
