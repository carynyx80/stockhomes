import { describe, expect, it } from "vitest";
import { marketPriceAt, nextPost, toOracleUnits, type Observation } from "./price";
import { parseZillowCsv } from "./sources";

const m = { scale: 1, lagMonths: 3 };
const obs: Observation[] = [
  { month: "2025-01", value: 800_000 },
  { month: "2025-02", value: 808_000 },
  { month: "2025-03", value: 800_000 },
];
const at = (y: number, mo: number, d = 1) => Date.UTC(y, mo - 1, d);

describe("oracle price model", () => {
  it("reflects each reading `lag` months later", () => {
    expect(marketPriceAt(m, obs, at(2025, 4))).toBe(800_000);
    expect(marketPriceAt(m, obs, at(2025, 5))).toBe(808_000);
    expect(marketPriceAt(m, obs, at(2025, 6))).toBe(800_000);
  });

  it("scales readings to USD", () => {
    expect(marketPriceAt({ scale: 1.33, lagMonths: 4 }, obs, at(2025, 6))).toBeCloseTo(808_000 * 1.33, 6);
  });

  it("glides linearly between readings, so prices never jump", () => {
    const mid = (at(2025, 4) + at(2025, 5)) / 2;
    expect(marketPriceAt(m, obs, mid)).toBeCloseTo(804_000, 3);
    let prev = marketPriceAt(m, obs, at(2025, 4));
    for (let t = at(2025, 4); t <= at(2025, 6); t += 3_600_000) {
      const p = marketPriceAt(m, obs, t);
      expect(Math.abs(p / prev - 1)).toBeLessThan(0.0005); // < 0.05% per hour
      prev = p;
    }
  });

  it("holds flat before the first and after the last point", () => {
    expect(marketPriceAt(m, obs, at(2020, 1))).toBe(800_000);
    expect(marketPriceAt(m, obs, at(2030, 1))).toBe(800_000);
  });

  it("refuses to price without readings", () => {
    expect(() => marketPriceAt(m, [], at(2025, 6))).toThrow(/no readings/);
  });

  it("walks big gaps in steps the oracle accepts", () => {
    const cur = toOracleUnits(800_000);
    expect(nextPost(cur, toOracleUnits(900_000), 90)).toBe(cur + (cur * 90n) / 10_000n);
    expect(nextPost(cur, toOracleUnits(700_000), 90)).toBe(cur - (cur * 90n) / 10_000n);
    expect(nextPost(cur, toOracleUnits(801_000), 90)).toBe(toOracleUnits(801_000));
    expect(nextPost(0n, toOracleUnits(5), 90)).toBe(toOracleUnits(5));
  });

  it("parses Zillow's metro CSV for the wanted regions, from 2024 on, skipping blanks", () => {
    const csv = [
      "RegionID,SizeRank,RegionName,RegionType,StateName,2023-12-31,2024-01-31,2024-02-29,2024-03-31",
      '102001,0,United States,country,,1,2,3,4',
      '394913,1,"New York, NY",msa,NY,700000,710000.5,,720000',
      '394463,3,"Chicago, IL",msa,IL,300000,301000,302000,303000',
    ].join("\n");
    expect(parseZillowCsv(csv, new Set([394913]))).toEqual({
      394913: [
        { month: "2024-01", value: 710000.5 },
        { month: "2024-03", value: 720000 },
      ],
    });
  });
});
