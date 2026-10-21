import { describe, expect, it } from "vitest";
import { marketPriceAt, nextPost, toOracleUnits, type Observation } from "./price";
import { parseFredCsv } from "./sources";

const m = { anchorMonth: "2025-01", anchorUsd: 800_000, lagMonths: 4 };
const obs: Observation[] = [
  { month: "2025-01", value: 300 },
  { month: "2025-02", value: 303 },
  { month: "2025-03", value: 300 },
];
const at = (y: number, mo: number, d = 1) => Date.UTC(y, mo - 1, d);

describe("oracle price model", () => {
  it("anchors the anchor month to the anchor value, reflected `lag` months later", () => {
    expect(marketPriceAt(m, obs, at(2025, 5))).toBe(800_000);
    expect(marketPriceAt(m, obs, at(2025, 6))).toBeCloseTo(808_000, 6); // +1%
    expect(marketPriceAt(m, obs, at(2025, 7))).toBeCloseTo(800_000, 6);
  });

  it("glides linearly between readings, so prices never jump", () => {
    const mid = (at(2025, 5) + at(2025, 6)) / 2;
    expect(marketPriceAt(m, obs, mid)).toBeCloseTo(804_000, 3);
    let prev = marketPriceAt(m, obs, at(2025, 5));
    for (let t = at(2025, 5); t <= at(2025, 7); t += 3_600_000) {
      const p = marketPriceAt(m, obs, t);
      expect(Math.abs(p / prev - 1)).toBeLessThan(0.0005); // < 0.05% per hour
      prev = p;
    }
  });

  it("holds flat before the first and after the last point", () => {
    expect(marketPriceAt(m, obs, at(2020, 1))).toBe(800_000);
    expect(marketPriceAt(m, obs, at(2030, 1))).toBeCloseTo(800_000, 6);
  });

  it("refuses to price without the anchor month", () => {
    expect(() => marketPriceAt(m, obs.slice(1), at(2025, 6))).toThrow(/anchor/);
  });

  it("walks big gaps in steps the oracle accepts", () => {
    const cur = toOracleUnits(800_000);
    expect(nextPost(cur, toOracleUnits(900_000), 90)).toBe(cur + (cur * 90n) / 10_000n);
    expect(nextPost(cur, toOracleUnits(700_000), 90)).toBe(cur - (cur * 90n) / 10_000n);
    expect(nextPost(cur, toOracleUnits(801_000), 90)).toBe(toOracleUnits(801_000));
    expect(nextPost(0n, toOracleUnits(5), 90)).toBe(toOracleUnits(5));
  });

  it("parses FRED's CSV, skipping missing values", () => {
    expect(parseFredCsv("observation_date,NYXRSA\n2026-06-01,348.57\n2026-07-01,.\n2026-08-01,350.8\n")).toEqual([
      { month: "2026-06", value: 348.57 },
      { month: "2026-08", value: 350.8 },
    ]);
  });
});
