import { hashString, uniform } from "@/lib/sim/prng";

/**
 * The Corridor never ends: slot i is generated from a fixed seed, so the same hallway appears for everyone and
 * on every visit. Agents take the first slots (in the visitor's chosen order); the rest are vacant rooms that get
 * warmer, dimmer and stranger the further you walk.
 */

export type VacantKind = "to-let" | "locked" | "ajar" | "painted-over" | "too-high";

export type Slot = {
  index: number;
  wallpaper: 0 | 1 | 2;
  sconceLit: boolean;
  /** 0 at the entrance, rising to 1 deep in the house. */
  depth: number;
  tiltDeg: number;
  /** Door number on the frame; deeper in, the numbers stop making sense. */
  number: string;
  vacant: VacantKind;
};

const SEED = hashString("stoxhomes:corridor");
const ODD_NUMBERS = ["∞", "0", "−3", "½", "404", "13b", "7", "7", "7", "XIV", "??", "1e3"];

export const depthOf = (i: number) => Math.min(1, i / 160);

export function slotAt(i: number): Slot {
  const r = (lane: number) => uniform(SEED, i, lane);
  const depth = depthOf(i);
  // Which vacant rooms are possible depends on how deep you are.
  const roll = r(1);
  let vacant: VacantKind = roll < 0.55 ? "to-let" : "locked";
  if (i > 20 && roll > 0.8) vacant = "ajar";
  if (i > 45 && roll > 0.9) vacant = "painted-over";
  if (i > 70 && roll > 0.96) vacant = "too-high";
  const strange = i > 50 && r(2) < depth * 0.6;
  return {
    index: i,
    wallpaper: (Math.floor(i / 12) % 3) as 0 | 1 | 2,
    sconceLit: r(3) > depth * 0.45,
    depth,
    tiltDeg: (r(4) - 0.5) * Math.min(4, i * 0.03),
    number: strange ? ODD_NUMBERS[Math.floor(r(5) * ODD_NUMBERS.length)] : String(i + 1),
    vacant,
  };
}

/** CSS filter for the wall art at a depth: warmer, dimmer, a touch uncanny. */
export function depthFilter(depth: number): string {
  return [
    `brightness(${(1 - depth * 0.38).toFixed(3)})`,
    `sepia(${(depth * 0.45).toFixed(3)})`,
    `saturate(${(1 + depth * 0.35).toFixed(3)})`,
    `hue-rotate(${(-depth * 14).toFixed(1)}deg)`,
  ].join(" ");
}

/** Which slots to render for a scroll position, with a margin either side. */
export function visibleRange(scroll: number, viewport: number, slotSize: number, count: number, overscan = 2) {
  const first = Math.max(0, Math.floor(scroll / slotSize) - overscan);
  const last = Math.min(count - 1, Math.ceil((scroll + viewport) / slotSize) + overscan);
  return { first, last };
}
