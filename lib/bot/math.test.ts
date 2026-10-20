import { describe, expect, it } from "vitest";
import {
  burnShare,
  gasTooExpensive,
  keepsGasReserve,
  meetsThreshold,
  minOutAfterSlippage,
  usdFromWhole,
  weiToUsd,
} from "./math";

const ETH = 10n ** 18n;
const usd = (n: number) => usdFromWhole(n);

describe("threshold", () => {
  const price = 2_400n * 10n ** 8n; // $2,400.00000000

  it("is inclusive at exactly $100", () => {
    const wei = (100n * ETH) / 2_400n + 1n; // a hair over $100 after integer division
    expect(meetsThreshold(weiToUsd(wei, price), 100)).toBe(true);
    expect(meetsThreshold(usd(100), 100)).toBe(true);
  });

  it("rejects anything under $100", () => {
    expect(meetsThreshold(usd(99.99), 100)).toBe(false);
    expect(meetsThreshold(weiToUsd(ETH / 25n, price), 100)).toBe(false); // 0.04 ETH = $96
  });

  it("converts wei to USD without floating point", () => {
    expect(weiToUsd(ETH, price)).toBe(price);
    expect(weiToUsd(1n, price)).toBe(0n);
    expect(weiToUsd(ETH / 2n, 2_401_23456789n)).toBe(1_200_61728394n);
  });
});

describe("20% burn share", () => {
  it("is exactly 20%, rounded down, and the remainder stays", () => {
    expect(burnShare(10n * ETH, 2000)).toBe(2n * ETH);
    const odd = 123_456_789_012_345_679n;
    const share = burnShare(odd, 2000);
    expect(share).toBe(24_691_357_802_469_135n);
    expect(odd - share).toBe(98_765_431_209_876_544n); // the 80% the bot never touches
    expect(share * 5n <= odd).toBe(true);
  });

  it("handles dust and bounds", () => {
    expect(burnShare(4n, 2000)).toBe(0n);
    expect(burnShare(5n, 2000)).toBe(1n);
    expect(() => burnShare(1n, 10_001)).toThrow();
    expect(() => burnShare(-1n, 2000)).toThrow();
  });

  it("applies slippage as a floor", () => {
    expect(minOutAfterSlippage(1_000_000n, 200)).toBe(980_000n);
    expect(minOutAfterSlippage(999n, 200)).toBe(979n);
  });
});

describe("gas guard", () => {
  it("skips when gas exceeds 5% of the claim", () => {
    expect(gasTooExpensive(5n, 100n, 500)).toBe(false); // exactly 5%
    expect(gasTooExpensive(6n, 100n, 500)).toBe(true);
    expect(gasTooExpensive(1n, 0n, 500)).toBe(true);
  });

  it("never spends into the gas reserve", () => {
    const reserve = ETH / 500n; // 0.002
    expect(keepsGasReserve(ETH, ETH / 5n, ETH / 1000n, reserve)).toBe(true);
    expect(keepsGasReserve(ETH / 100n, ETH / 125n, ETH / 1000n, reserve)).toBe(false);
  });
});
