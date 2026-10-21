import { describe, expect, it } from "vitest";
import { maxNoise, noiseAt } from "./noise";

const SEED = "test-seed";
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21);

describe("testnet live movement", () => {
  it("is deterministic for a seed, and different per market and per seed", () => {
    expect(noiseAt(SEED, "new-york-ny", T0)).toBe(noiseAt(SEED, "new-york-ny", T0));
    expect(noiseAt(SEED, "new-york-ny", T0)).not.toBe(noiseAt(SEED, "london-uk", T0));
    expect(noiseAt(SEED, "new-york-ny", T0)).not.toBe(noiseAt("other", "new-york-ny", T0));
  });

  it("stays bounded around the index and averages out", () => {
    let sum = 0;
    let n = 0;
    for (let t = T0; t < T0 + 60 * 86_400_000; t += 37 * MIN) {
      const x = noiseAt(SEED, "chicago-il", t);
      expect(Math.abs(x)).toBeLessThanOrEqual(maxNoise());
      sum += x;
      n++;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
  });

  it("moves every minute, smoothly, well inside the oracle's 1% per-post limit", () => {
    let moved = 0;
    for (let t = T0; t < T0 + 86_400_000; t += 20_000) {
      const step = Math.abs(noiseAt(SEED, "miami-fl", t + 20_000) - noiseAt(SEED, "miami-fl", t));
      expect(step).toBeLessThan(0.002); // < 0.2% between 20-second ticks
      if (step > 1e-6) moved++;
    }
    expect(moved).toBeGreaterThan(4_000); // nearly every tick of the day
  });

  it("gives real daily ranges: some days up, some down", () => {
    const days = Array.from({ length: 60 }, (_, d) => noiseAt(SEED, "austin-tx", T0 + (d + 1) * 86_400_000) - noiseAt(SEED, "austin-tx", T0 + d * 86_400_000));
    expect(days.filter((x) => x > 0.0005).length).toBeGreaterThan(10);
    expect(days.filter((x) => x < -0.0005).length).toBeGreaterThan(10);
  });
});
