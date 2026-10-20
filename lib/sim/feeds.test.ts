import { describe, expect, it } from "vitest";
import { SIMULATED } from "@/config/stoxhomes";
import { DAY, priceAt } from "./feeds";
import { MARKETS } from "./markets";
import { pairings, roundBounds } from "./wars";

const T0 = SIMULATED.genesis + 400 * DAY + 13 * 3_600_000;

describe("simulated feeds", () => {
  it("is a pure function of time", () => {
    for (const m of MARKETS) expect(priceAt(m.id, T0)).toBe(priceAt(m.id, T0));
  });

  it("moves about ±0.1% a day", () => {
    for (const m of MARKETS) {
      const moves: number[] = [];
      for (let d = 1; d <= 365; d++) {
        const t = SIMULATED.genesis + d * DAY;
        moves.push(Math.log(priceAt(m.id, t) / priceAt(m.id, t - DAY)));
      }
      const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
      const sd = Math.sqrt(moves.reduce((a, b) => a + (b - mean) ** 2, 0) / moves.length);
      expect(sd).toBeGreaterThan(0.0007);
      expect(sd).toBeLessThan(0.0013);
      expect(Math.max(...moves.map(Math.abs))).toBeLessThan(0.006);
    }
  });

  it("has no jump at midnight", () => {
    const midnight = SIMULATED.genesis + 300 * DAY;
    for (const m of MARKETS) {
      const before = priceAt(m.id, midnight - 1);
      const after = priceAt(m.id, midnight);
      expect(Math.abs(after / before - 1)).toBeLessThan(1e-6);
    }
  });

  it("stays near each city's base over a year", () => {
    for (const m of MARKETS) {
      const p = priceAt(m.id, SIMULATED.genesis + 365 * DAY);
      expect(p / m.base).toBeGreaterThan(0.85);
      expect(p / m.base).toBeLessThan(1.2);
    }
  });
});

describe("city wars", () => {
  it("pairs all six cities into three matches, stable per round", () => {
    const p = pairings(42);
    expect(p).toHaveLength(3);
    expect(new Set(p.flatMap((x) => [x.a, x.b])).size).toBe(6);
    expect(pairings(42)).toEqual(p);
  });

  it("runs rounds Monday to Monday UTC", () => {
    const { startsAt, endsAt } = roundBounds(10);
    expect(new Date(startsAt).getUTCDay()).toBe(1);
    expect(new Date(startsAt).getUTCHours()).toBe(0);
    expect(endsAt - startsAt).toBe(7 * DAY);
  });
});
