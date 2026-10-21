import { EXCHANGE_PARAMS } from "@/config/exchange";
import { SIMULATED } from "@/config/stoxhomes";
import { feeOf, liquidationPrice, notionalOf, pnlOf, type Side } from "@/lib/perp/math";

/**
 * Trade previews for the order panel and the simulator. Pure bigint maths on the same formulas as the
 * contracts (lib/perp/math.ts), so a preview matches what the exchange will do, before borrow-fee drift.
 */

export type FeeSchedule = { openFeeBps: number; closeFeeBps: number; maintenanceBps: number; borrowBpsPerDay: number };

export const feesFor = (mode: "live" | "simulated"): FeeSchedule =>
  mode === "live"
    ? { openFeeBps: EXCHANGE_PARAMS.openFeeBps, closeFeeBps: EXCHANGE_PARAMS.closeFeeBps, maintenanceBps: EXCHANGE_PARAMS.maintenanceBps, borrowBpsPerDay: EXCHANGE_PARAMS.borrowBpsPerDay }
    : { openFeeBps: SIMULATED.openFeeBps, closeFeeBps: SIMULATED.closeFeeBps, maintenanceBps: SIMULATED.maintenanceMarginBps, borrowBpsPerDay: 0 };

export type Draft = {
  side: Side;
  /** Expected fill price (mark for market orders, trigger for limit/stop). */
  entry: bigint;
  collateral: bigint;
  leverage: number;
  takeProfit?: bigint | null;
  stopLoss?: bigint | null;
};

export type Preview = {
  notional: bigint;
  openFee: bigint;
  closeFee: bigint;
  liquidation: bigint;
  /** How far the price can move against the position before liquidation, bps. */
  liqDistanceBps: number;
  borrowPerDay: bigint;
  /** Net PnL (after open and close fees) if the take-profit / stop-loss fills exactly at its price. */
  tpPnl: bigint | null;
  slPnl: bigint | null;
};

const BPS = 10_000n;

export function preview(d: Draft, f: FeeSchedule): Preview {
  const notional = notionalOf(d.collateral, d.leverage);
  const openFee = feeOf(notional, f.openFeeBps);
  const closeFee = feeOf(notional, f.closeFeeBps);
  const liquidation = liquidationPrice(d.side, d.entry, d.collateral, notional, f.maintenanceBps);
  const distance = d.entry > liquidation ? d.entry - liquidation : liquidation - d.entry;
  const at = (p: bigint) => pnlOf(d.side, notional, d.entry, p) - openFee - closeFee;
  return {
    notional,
    openFee,
    closeFee,
    liquidation,
    liqDistanceBps: d.entry > 0n ? Number((distance * BPS) / d.entry) : 0,
    borrowPerDay: (notional * BigInt(f.borrowBpsPerDay)) / BPS,
    tpPnl: d.takeProfit ? at(d.takeProfit) : null,
    slPnl: d.stopLoss ? at(d.stopLoss) : null,
  };
}

export type Outcome = {
  price: bigint;
  /** Net of open fee, close fee and borrow fees. Never below −(collateral + open fee): margin is all you can lose. */
  pnl: bigint;
  /** PnL over collateral, bps. */
  roeBps: number;
  equity: bigint;
  liquidated: boolean;
};

/** The position after the price moves `moveBps` from entry and it's held `days`. */
export function outcomeAt(d: Draft, f: FeeSchedule, moveBps: number, days = 0): Outcome {
  const price = (d.entry * BigInt(10_000 + Math.round(moveBps))) / BPS;
  return outcomeAtPrice(d, f, price, days);
}

export function outcomeAtPrice(d: Draft, f: FeeSchedule, price: bigint, days = 0): Outcome {
  const p = preview(d, f);
  const borrow = (p.notional * BigInt(Math.round(f.borrowBpsPerDay * days * 100))) / (BPS * 100n);
  const raw = pnlOf(d.side, p.notional, d.entry, price);
  const equityBeforeClose = d.collateral + raw - borrow;
  const liquidated = equityBeforeClose <= (p.notional * BigInt(f.maintenanceBps)) / BPS;
  const pnl = liquidated ? -(d.collateral + p.openFee) : raw - borrow - p.openFee - p.closeFee;
  const equity = liquidated ? 0n : d.collateral + raw - borrow - p.closeFee;
  return { price, pnl, roeBps: d.collateral > 0n ? Number((pnl * BPS) / d.collateral) : 0, equity: equity < 0n ? 0n : equity, liquidated };
}

/** The price at which the position shows `roeBps` return on collateral (before fees). */
export function priceForRoe(side: Side, entry: bigint, leverage: number, roeBps: number): bigint {
  const moveBps = BigInt(Math.round(roeBps / leverage));
  return side === "long" ? (entry * (BPS + moveBps)) / BPS : (entry * (BPS - moveBps)) / BPS;
}

/** Signed move from entry to price, bps. */
export const moveBpsOf = (entry: bigint, price: bigint): number => (entry > 0n ? Number(((price - entry) * BPS) / entry) : 0);

export type ReplayPoint = { t: number; price: bigint };
export type Replay = {
  entryAt: number;
  entry: bigint;
  exitAt: number;
  exit: bigint;
  /** Why the replay ended: still open today, or a trigger / liquidation along the way. */
  ending: "open" | "take-profit" | "stop-loss" | "liquidated";
  pnl: bigint;
  roeBps: number;
  /** Worst net PnL seen along the way. */
  worstPnl: bigint;
  /** Equity path for a chart. */
  path: { t: number; equity: bigint }[];
};

/**
 * "What if I'd opened this trade at path[start]?" Walks the recorded prices, stopping at the first take-profit,
 * stop-loss or liquidation, with borrow fees accruing by elapsed time. TP/SL are given as moves from entry (bps),
 * so they translate to the historical entry the way they would today.
 */
export function replay(
  d: Pick<Draft, "side" | "collateral" | "leverage">,
  f: FeeSchedule,
  path: ReplayPoint[],
  start: number,
  triggers: { tpMoveBps?: number | null; slMoveBps?: number | null } = {},
): Replay | null {
  if (start < 0 || start >= path.length - 1) return null;
  const entry = path[start].price;
  const entryAt = path[start].t;
  const draft: Draft = { ...d, entry };
  const tp = triggers.tpMoveBps != null ? (entry * BigInt(10_000 + Math.round(triggers.tpMoveBps))) / BPS : null;
  const sl = triggers.slMoveBps != null ? (entry * BigInt(10_000 + Math.round(triggers.slMoveBps))) / BPS : null;
  const out: { t: number; equity: bigint }[] = [{ t: entryAt, equity: d.collateral }];
  let worst = 0n;
  for (let i = start + 1; i < path.length; i++) {
    const { t, price } = path[i];
    const days = (t - entryAt) / 86_400_000;
    const o = outcomeAtPrice(draft, f, price, days);
    out.push({ t, equity: o.equity });
    if (o.pnl < worst) worst = o.pnl;
    const long = d.side === "long";
    const hitTp = tp != null && (long ? price >= tp : price <= tp);
    const hitSl = sl != null && (long ? price <= sl : price >= sl);
    const ending = o.liquidated ? "liquidated" : hitSl ? "stop-loss" : hitTp ? "take-profit" : null;
    if (ending || i === path.length - 1) {
      return { entryAt, entry, exitAt: t, exit: price, ending: ending ?? "open", pnl: o.pnl, roeBps: o.roeBps, worstPnl: worst, path: out };
    }
  }
  return null;
}
