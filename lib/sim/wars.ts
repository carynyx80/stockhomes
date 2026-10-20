import { SIMULATED } from "@/config/stoxhomes";
import { DAY, priceAt } from "./feeds";
import { MARKETS } from "./markets";
import { gaussian, hashString, seededShuffle } from "./prng";

/**
 * City Wars: each week (Monday 00:00 UTC to Monday) the six cities are drawn into three
 * head-to-heads. The city whose index rises more over the week wins.
 */

export const WEEK = 7 * DAY;
export const ROUNDS_PER_SEASON = 13;

export function roundAt(t: number): number {
  return Math.floor((t - SIMULATED.genesis) / WEEK);
}

export function roundBounds(round: number) {
  const startsAt = SIMULATED.genesis + round * WEEK;
  return { startsAt, endsAt: startsAt + WEEK };
}

export function seasonOf(round: number): number {
  return Math.floor(round / ROUNDS_PER_SEASON);
}

export type Pairing = { id: string; a: string; b: string };

export function pairings(round: number): Pairing[] {
  const ids = seededShuffle(
    MARKETS.map((m) => m.id),
    hashString(`stoxhomes:wars:${round}`),
  );
  const out: Pairing[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    out.push({ id: `r${round}-${ids[i]}-${ids[i + 1]}`, a: ids[i], b: ids[i + 1] });
  }
  return out;
}

/** Change of a city's index from round start to `t` (capped at round end), in bps. */
export function changeBps(marketId: string, round: number, t: number): number {
  const { startsAt, endsAt } = roundBounds(round);
  const p0 = priceAt(marketId, startsAt);
  const p1 = priceAt(marketId, Math.min(t, endsAt));
  return Math.round((p1 / p0 - 1) * 10_000);
}

const HANDLES = [
  "brownstone_bull",
  "condo_contrarian",
  "mortgage_monk",
  "lagos_landlord",
  "dune_developer",
  "escrow_eddie",
  "cap_rate_carla",
  "zoning_zoe",
  "attic_alpha",
  "the_surveyor",
  "freehold_fran",
  "bay_window_ben",
];

/** Simulated rival players: season PnL (USDG) built from per-round results. */
export function rivalStandings(round: number, now: number) {
  const season = seasonOf(round);
  const first = season * ROUNDS_PER_SEASON;
  const { startsAt } = roundBounds(round);
  const partial = Math.min(1, Math.max(0, (now - startsAt) / WEEK));
  return HANDLES.map((handle, k) => {
    const seed = hashString(`stoxhomes:rival:${handle}`);
    const skill = 18 - k * 3;
    let pnl = 0;
    let wins = 0;
    let played = 0;
    for (let r = first; r <= round; r++) {
      const weight = r === round ? partial : 1;
      if (weight === 0) continue;
      const result = (skill + 140 * gaussian(seed, r)) * weight;
      pnl += result;
      if (r < round) {
        played += 3;
        wins += result > 0 ? 2 : 1;
      }
    }
    return { handle, pnl, wins, played };
  });
}
