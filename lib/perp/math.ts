/**
 * Perpetual position maths, all in integer bigints.
 * Amounts are USDG in DECIMALS.usdg fixed point; prices are in DECIMALS.price fixed point.
 * Division rounds toward zero; where rounding matters it is chosen to favour the House (conservative).
 */

export const BPS = 10_000n;

export type Side = "long" | "short";

const dir = (side: Side) => (side === "long" ? 1n : -1n);

export function notionalOf(collateral: bigint, leverage: number): bigint {
  if (!Number.isInteger(leverage) || leverage < 1) throw new Error("leverage must be a positive integer");
  return collateral * BigInt(leverage);
}

export function feeOf(notional: bigint, bps: number): bigint {
  // Round up: a fee is never undercharged.
  const n = notional * BigInt(bps);
  return (n + BPS - 1n) / BPS;
}

/** Unrealised PnL in USDG. */
export function pnlOf(side: Side, notional: bigint, entry: bigint, mark: bigint): bigint {
  if (entry <= 0n) throw new Error("entry price must be positive");
  return (dir(side) * notional * (mark - entry)) / entry;
}

export function maintenanceMargin(notional: bigint, mmBps: number): bigint {
  return (notional * BigInt(mmBps)) / BPS;
}

/**
 * The mark price at which equity (collateral + PnL) falls to the maintenance margin.
 *   long:  entry × (1 − (collateral − mm) / notional)
 *   short: entry × (1 + (collateral − mm) / notional)
 */
export function liquidationPrice(
  side: Side,
  entry: bigint,
  collateral: bigint,
  notional: bigint,
  mmBps: number,
): bigint {
  const mm = maintenanceMargin(notional, mmBps);
  const cushion = collateral - mm;
  if (cushion <= 0n) return entry; // already at or under maintenance
  // Round the distance down, so the liquidation price sits slightly closer to entry (conservative).
  const distance = (entry * cushion) / notional;
  return side === "long" ? (entry > distance ? entry - distance : 0n) : entry + distance;
}

export function isLiquidatable(
  side: Side,
  entry: bigint,
  collateral: bigint,
  notional: bigint,
  mark: bigint,
  mmBps: number,
): boolean {
  const equity = collateral + pnlOf(side, notional, entry, mark);
  return equity <= maintenanceMargin(notional, mmBps);
}

/** Percentage (in bps) the price can move against the position before liquidation. */
export function distanceToLiquidationBps(entry: bigint, liq: bigint): number {
  if (entry === 0n) return 0;
  const d = entry > liq ? entry - liq : liq - entry;
  return Number((d * BPS) / entry);
}
