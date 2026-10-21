import { createHash, createHmac } from "node:crypto";

/**
 * Testnet live movement: a multi-scale, mean-zero wiggle around the official index path, so prices move minute to
 * minute instead of gliding flat between monthly readings.
 *
 *   price(t) = indexPath(t) × exp(noise(t))
 *
 * noise(t) is a sum of "value noise" layers: random knots every `period` (HMAC of a server-side secret), joined by a
 * smooth curve. Short layers make the tape tick; long layers make multi-hour and multi-day swings. It never drifts
 * away from the index (each layer is bounded and averages zero) and can be evaluated at any past time, which is
 * how charts and 24h change are drawn. Without the secret it can't be predicted, so the House can't be gamed by
 * reading ahead; the API only ever serves points up to the last on-chain post.
 *
 * TESTNET ONLY: this is simulated volatility layered on real data, and the UI says so.
 */

type Layer = { periodMs: number; amp: number };

/** Amplitudes are the peak log-move of each layer (0.001 = 0.1%). */
const LAYERS: Layer[] = [
  { periodMs: 90_000, amp: 0.0004 }, // ticks: a few basis points a minute
  { periodMs: 12 * 60_000, amp: 0.0012 }, // ~0.1% within the quarter-hour
  { periodMs: 2 * 3_600_000, amp: 0.003 }, // ~0.3% over a couple of hours
  { periodMs: 14 * 3_600_000, amp: 0.006 }, // ~0.6% over the day
  { periodMs: 4 * 86_400_000, amp: 0.012 }, // ~1.2% swings over days
];

const MAX_NOISE = LAYERS.reduce((s, l) => s + l.amp, 0);

/** Uniform in [-1, 1] for a knot. */
function knot(seed: string, market: string, layer: number, i: number): number {
  const h = createHmac("sha256", seed).update(`${market}|${layer}|${i}`).digest();
  return (h.readUInt32BE(0) / 0xffffffff) * 2 - 1;
}

/** Per-market character: some cities are calmer, some wilder (0.6× to 1.5×). */
function volScale(seed: string, market: string): number {
  return 0.6 + 0.9 * ((knot(seed, market, 99, 0) + 1) / 2);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Log-offset from the index path at time t (ms). */
export function noiseAt(seed: string, market: string, t: number): number {
  let sum = 0;
  LAYERS.forEach((l, li) => {
    const x = t / l.periodMs;
    const i = Math.floor(x);
    const a = knot(seed, market, li, i);
    const b = knot(seed, market, li, i + 1);
    sum += l.amp * (a + (b - a) * smooth(x - i));
  });
  return sum * volScale(seed, market);
}

/** Largest possible offset, for tests and the docs. */
export const maxNoise = () => MAX_NOISE * 1.5;

/**
 * The secret behind the movement. ORACLE_NOISE_SEED if set; otherwise derived from the keeper key (so production
 * needs no new variable); otherwise a fixed development seed. Never sent to the browser.
 */
export function noiseSeed(): string {
  const explicit = process.env.ORACLE_NOISE_SEED?.trim();
  if (explicit) return explicit;
  const key = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (key) return createHash("sha256").update(`stoxhomes-oracle-noise|${key}`).digest("hex");
  return "stoxhomes-development-seed";
}
