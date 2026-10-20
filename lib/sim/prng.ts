/** Deterministic, stateless randomness: the same (seed, index) always gives the same number. */

/** 32-bit string hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer mixer (lowbias32). */
function mix(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Uniform in (0, 1). */
export function uniform(seed: number, index: number, lane = 0): number {
  const h = mix(seed ^ mix(index + 0x9e3779b9) ^ mix(lane * 0x85ebca6b + 1));
  return (h + 0.5) / 4294967296;
}

/** Standard normal via Box–Muller. */
export function gaussian(seed: number, index: number): number {
  const u1 = uniform(seed, index, 1);
  const u2 = uniform(seed, index, 2);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Fisher–Yates shuffle with a fixed seed. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(uniform(seed, i, 7) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
