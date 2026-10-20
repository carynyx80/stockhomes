import { describe, expect, it } from "vitest";
import { formatBps, formatFixed, parseUsdg } from "./format";

describe("format", () => {
  it("formats fixed-point bigints exactly", () => {
    expect(formatFixed(1_234_567_890n, 6, 2)).toBe("1,234.57");
    expect(formatFixed(-5_000n, 6, 2)).toBe("−0.01");
    expect(formatFixed(4_000n, 6, 2)).toBe("0.00");
    expect(formatFixed(10n * 10n ** 8n, 8, 2, { sign: true })).toBe("+10.00");
  });

  it("parses USDG input without floating point", () => {
    expect(parseUsdg("1,250.5")).toBe(1_250_500_000n);
    expect(parseUsdg("0.000001")).toBe(1n);
    expect(parseUsdg(".5")).toBe(500_000n);
    expect(parseUsdg("0.0000001")).toBeNull();
    expect(parseUsdg("1e3")).toBeNull();
    expect(parseUsdg("-4")).toBeNull();
    expect(parseUsdg("")).toBeNull();
  });

  it("formats basis points with a true minus sign", () => {
    expect(formatBps(12)).toBe("+0.12%");
    expect(formatBps(-250)).toBe("−2.50%");
    expect(formatBps(0)).toBe("0.00%");
  });
});
