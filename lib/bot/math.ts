/** Integer-only money rules for the fee bot. No floating point ever touches a token or wei amount. */

export const BPS = 10_000n;
/** Chainlink ETH/USD has 8 decimals. USD values in the bot use the same fixed point. */
export const USD_DECIMALS = 8;
export const USD_ONE = 10n ** BigInt(USD_DECIMALS);

/** The buyback-and-burn share of a claim, rounded down (never takes more than the share). */
export function burnShare(amount: bigint, shareBps: number): bigint {
  if (amount < 0n) throw new Error("amount must be non-negative");
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) throw new Error("shareBps out of range");
  return (amount * BigInt(shareBps)) / BPS;
}

/** wei × (USD per ETH, 8dp) → USD, 8dp. */
export function weiToUsd(wei: bigint, ethUsd: bigint): bigint {
  return (wei * ethUsd) / 10n ** 18n;
}

export function usdFromWhole(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100)) * (USD_ONE / 100n);
}

export function meetsThreshold(valueUsd: bigint, thresholdUsd: number): boolean {
  return valueUsd >= usdFromWhole(thresholdUsd);
}

/** True when the gas for a claim would cost more than `maxShareBps` of what it claims. */
export function gasTooExpensive(gasCostWei: bigint, claimValueWei: bigint, maxShareBps: number): boolean {
  if (claimValueWei === 0n) return true;
  return gasCostWei * BPS > claimValueWei * BigInt(maxShareBps);
}

/** Minimum acceptable output for a quote, after slippage, rounded down. */
export function minOutAfterSlippage(quoted: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) throw new Error("slippage out of range");
  return (quoted * (BPS - BigInt(slippageBps))) / BPS;
}

/** Whether spending `spend` plus `gas` leaves at least the protected gas reserve. */
export function keepsGasReserve(balance: bigint, spend: bigint, gas: bigint, reserve: bigint): boolean {
  return balance - spend - gas >= reserve;
}
