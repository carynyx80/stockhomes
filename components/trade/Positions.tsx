"use client";

import { Fragment, useState } from "react";
import { SETTLEMENT } from "@/config/stoxhomes";
import { data, type Account, type Position, type Quote, type RestingOrder } from "@/lib/data";
import { formatBps, formatPrice, formatUsdg, parsePrice, parseUsdg, priceInput } from "@/lib/format";
import { feeOf, liquidationPrice, pnlOf } from "@/lib/perp/math";
import { marketById } from "@/lib/sim/markets";
import { feesFor } from "@/lib/trade/preview";

const FEES = feesFor(data.mode);
const SYMBOL = data.settlementSymbol ?? SETTLEMENT.symbol;
const CAN_MANAGE = typeof data.decreasePosition === "function";

function livePnl(pos: Position, mark: bigint) {
  const pnl = pnlOf(pos.side, pos.notional, pos.entryPrice, mark);
  const net = pnl - feeOf(pos.notional, FEES.closeFeeBps);
  const bps = Number((net * 10_000n) / pos.collateral);
  return { net, bps };
}

const SideTag = ({ side, leverage }: { side: Position["side"]; leverage: number }) => (
  <span className={`numeric inline-block rounded-sm px-1.5 py-0.5 text-[11px] text-beige ${side === "long" ? "bg-long" : "bg-short"}`}>
    {side === "long" ? "LONG" : "SHORT"} {leverage}x
  </span>
);

const signed = (v: bigint) => (v > 0n ? "text-long" : v < 0n ? "text-short" : "text-ink");

const REASON: Record<string, string> = {
  closed: "Closed",
  partial: "Partly closed",
  "take-profit": "Take-profit",
  "stop-loss": "Stop-loss",
  liquidated: "Liquidated",
};

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;

/** Partial close, margin and TP/SL for one position. */
function Manage({ pos, mark, run, busy }: { pos: Position; mark: bigint; run: Run; busy: string | null }) {
  const [margin, setMargin] = useState("");
  const [tp, setTp] = useState(pos.takeProfit ? priceInput(pos.takeProfit) : "");
  const [sl, setSl] = useState(pos.stopLoss ? priceInput(pos.stopLoss) : "");
  const amount = parseUsdg(margin);
  const lev = (collateral: bigint) => (collateral > 0n ? Number(pos.notional) / Number(collateral) : 0);
  const after = (delta: bigint) => {
    const c = pos.collateral + delta;
    return c > 0n ? { lev: lev(c), liq: liquidationPrice(pos.side, pos.entryPrice, c, pos.notional, FEES.maintenanceBps) } : null;
  };
  const addAfter = amount ? after(amount) : null;
  const removeAfter = amount && amount < pos.collateral ? after(-amount) : null;
  const tpP = tp.trim() ? parsePrice(tp) : null;
  const slP = sl.trim() ? parsePrice(sl) : null;
  const k = (s: string) => `${s}:${pos.id}`;

  return (
    <div className="grid gap-4 rounded border border-sand bg-beige/50 p-3 md:grid-cols-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Close part</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[2_500, 5_000, 7_500, 10_000].map((bps) => {
            const value = (pos.notional * BigInt(bps)) / 10_000n;
            return (
              <button
                key={bps}
                type="button"
                disabled={busy != null}
                onClick={() => run(k(`close${bps}`), () => data.decreasePosition!(pos.id, bps))}
                className="rounded-sm border border-oxblood px-2 py-1 text-xs font-semibold text-oxblood hover:bg-oxblood hover:text-beige disabled:opacity-40"
                title={`Close ${formatUsdg(value)} of ${formatUsdg(pos.notional)}`}
              >
                {busy === k(`close${bps}`) ? "…" : bps === 10_000 ? "All" : `${bps / 100}%`}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink/55">The rest keeps its entry price and leverage.</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Margin</p>
        <div className="mt-2 flex items-center rounded border border-sand bg-beige focus-within:border-brass">
          <input
            aria-label="Margin amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Amount"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className="numeric w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-ink/35"
          />
          <span className="px-2 text-[11px] text-ink/55">{SYMBOL}</span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            disabled={!amount || busy != null}
            onClick={() => run(k("add"), () => data.addMargin!(pos.id, amount!))}
            className="rounded-sm border border-long px-2 py-1 text-xs font-semibold text-long hover:bg-long hover:text-beige disabled:opacity-40"
          >
            {busy === k("add") ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            disabled={!amount || !removeAfter || busy != null}
            onClick={() => run(k("remove"), () => data.removeMargin!(pos.id, amount!))}
            className="rounded-sm border border-short px-2 py-1 text-xs font-semibold text-short hover:bg-short hover:text-beige disabled:opacity-40"
          >
            {busy === k("remove") ? "Removing…" : "Remove"}
          </button>
        </div>
        <p className="numeric mt-1.5 text-[11px] text-ink/55">
          {addAfter
            ? `Add → ${addAfter.lev.toFixed(1)}x, liq. ${formatPrice(addAfter.liq, 0)}${removeAfter ? ` · Remove → ${removeAfter.lev.toFixed(1)}x, liq. ${formatPrice(removeAfter.liq, 0)}` : ""}`
            : `Now ${lev(pos.collateral).toFixed(1)}x, liq. ${formatPrice(pos.liquidationPrice, 0)}. Removing is allowed down to 100x.`}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Take-profit / stop-loss</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(
            [
              ["TP", tp, setTp],
              ["SL", sl, setSl],
            ] as const
          ).map(([name, value, set]) => (
            <label key={name} className="flex items-center rounded border border-sand bg-beige focus-within:border-brass">
              <span className={`pl-2 text-[11px] font-semibold ${name === "TP" ? "text-long" : "text-short"}`}>{name}</span>
              <input
                aria-label={name === "TP" ? "Take-profit price" : "Stop-loss price"}
                inputMode="decimal"
                autoComplete="off"
                placeholder="none"
                value={value}
                onChange={(e) => set(e.target.value)}
                className="numeric w-full min-w-0 bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-ink/35"
              />
            </label>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            disabled={busy != null || (tp.trim() !== "" && !tpP) || (sl.trim() !== "" && !slP)}
            onClick={() => run(k("triggers"), () => data.setTriggers!(pos.id, tpP, slP))}
            className="rounded-sm border border-oxblood px-2 py-1 text-xs font-semibold text-oxblood hover:bg-oxblood hover:text-beige disabled:opacity-40"
          >
            {busy === k("triggers") ? "Saving…" : "Save"}
          </button>
          {(pos.takeProfit || pos.stopLoss) && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() => run(k("clear"), () => data.setTriggers!(pos.id, null, null))}
              className="rounded-sm px-2 py-1 text-xs text-ink/60 hover:text-short disabled:opacity-40"
            >
              Clear both
            </button>
          )}
        </div>
        <p className="numeric mt-1.5 text-[11px] text-ink/55">Mark {formatPrice(mark, 0)}. TP on the winning side, SL on the losing side.</p>
      </div>
    </div>
  );
}

export function Positions({ account, quotes }: { account: Account | null; quotes: Record<string, Quote> | null }) {
  const [tab, setTab] = useState<"open" | "orders" | "history">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run: Run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const positions = account?.positions ?? [];
  const orders: RestingOrder[] = account?.orders ?? [];
  const history = account?.history ?? [];
  const showOrders = typeof data.cancelOrder === "function";

  const tabs = [
    ["open", `Open positions (${positions.length})`],
    ...(showOrders ? [["orders", `Orders (${orders.length})`] as const] : []),
    ["history", "History"],
  ] as const;

  return (
    <section aria-label="Your positions" className="panel mt-6 p-4 sm:p-5">
      <div role="tablist" className="flex gap-6 overflow-x-auto border-b border-sand">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key as typeof tab)}
            className={`editorial -mb-px shrink-0 border-b-2 pb-2 text-lg ${tab === key ? "border-oxblood text-oxblood" : "border-transparent text-ink/60 hover:text-oxblood"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-short">{error}</p>}

      {tab === "open" &&
        (positions.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/60">No open positions. Pick a city and place an order.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-ink/60">
                <tr>
                  <th className="py-2 pr-3 font-medium">Market</th>
                  <th className="py-2 pr-3 text-right font-medium">Size</th>
                  <th className="py-2 pr-3 text-right font-medium">Collateral</th>
                  <th className="py-2 pr-3 text-right font-medium">Entry</th>
                  <th className="py-2 pr-3 text-right font-medium">Mark</th>
                  <th className="py-2 pr-3 text-right font-medium">Liq. price</th>
                  {CAN_MANAGE && <th className="py-2 pr-3 text-right font-medium">TP / SL</th>}
                  <th className="py-2 pr-3 text-right font-medium">PnL (after close fee)</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const mark = quotes?.[p.marketId]?.price ?? p.entryPrice;
                  const { net, bps } = livePnl(p, mark);
                  const expanded = open === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-t border-sand/60">
                        <td className="py-2.5 pr-3">
                          <span className="editorial mr-2 text-base">{marketById(p.marketId).city}</span>
                          <SideTag side={p.side} leverage={p.leverage} />
                        </td>
                        <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(p.notional)}</td>
                        <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(p.collateral)}</td>
                        <td className="numeric py-2.5 pr-3 text-right">{formatPrice(p.entryPrice)}</td>
                        <td className="numeric py-2.5 pr-3 text-right">{formatPrice(mark)}</td>
                        <td className="numeric py-2.5 pr-3 text-right text-short">{formatPrice(p.liquidationPrice)}</td>
                        {CAN_MANAGE && (
                          <td className="numeric py-2.5 pr-3 text-right text-xs">
                            <span className="text-long">{p.takeProfit ? formatPrice(p.takeProfit, 0) : "—"}</span>
                            <span className="text-ink/40"> / </span>
                            <span className="text-short">{p.stopLoss ? formatPrice(p.stopLoss, 0) : "—"}</span>
                          </td>
                        )}
                        <td className={`numeric py-2.5 pr-3 text-right ${signed(net)}`}>
                          {formatUsdg(net, 2, { sign: true })} <span className="text-xs">({formatBps(bps)})</span>
                        </td>
                        <td className="whitespace-nowrap py-2.5 text-right">
                          {CAN_MANAGE && (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setOpen(expanded ? null : p.id)}
                              className="mr-1.5 rounded-sm px-2 py-1 text-xs text-wine underline-offset-4 hover:underline"
                            >
                              {expanded ? "Done" : "Manage"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => run(`close:${p.id}`, () => data.closePosition(p.id))}
                            disabled={busy != null}
                            className="rounded-sm border border-oxblood px-2.5 py-1 text-xs font-semibold text-oxblood hover:bg-oxblood hover:text-beige disabled:opacity-50"
                          >
                            {busy === `close:${p.id}` ? "Closing…" : "Close"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={9} className="pb-3">
                            <Manage pos={p} mark={mark} run={run} busy={busy} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "orders" &&
        (orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/60">No resting orders. Choose Limit or Stop in the order ticket to place one.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-ink/60">
                <tr>
                  <th className="py-2 pr-3 font-medium">Market</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Trigger</th>
                  <th className="py-2 pr-3 text-right font-medium">Mark</th>
                  <th className="py-2 pr-3 text-right font-medium">Size</th>
                  <th className="py-2 pr-3 text-right font-medium">TP / SL</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const mark = quotes?.[o.marketId]?.price;
                  const away = mark ? Number(((o.triggerPrice - mark) * 10_000n) / mark) : null;
                  return (
                    <tr key={o.id} className="border-t border-sand/60">
                      <td className="py-2.5 pr-3">
                        <span className="editorial mr-2 text-base">{marketById(o.marketId).city}</span>
                        <SideTag side={o.side} leverage={o.leverage} />
                      </td>
                      <td className="py-2.5 pr-3 capitalize">{o.type}</td>
                      <td className="numeric py-2.5 pr-3 text-right">
                        {formatPrice(o.triggerPrice, 0)}
                        {away != null && <span className="ml-1 text-xs text-ink/55">({formatBps(away)})</span>}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right">{mark ? formatPrice(mark, 0) : "—"}</td>
                      <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(o.notional)}</td>
                      <td className="numeric py-2.5 pr-3 text-right text-xs">
                        <span className="text-long">{o.takeProfit ? formatPrice(o.takeProfit, 0) : "—"}</span>
                        <span className="text-ink/40"> / </span>
                        <span className="text-short">{o.stopLoss ? formatPrice(o.stopLoss, 0) : "—"}</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => run(`cancel:${o.id}`, () => data.cancelOrder!(o.id))}
                          className="rounded-sm border border-sand px-2.5 py-1 text-xs font-semibold text-ink/75 hover:border-short hover:text-short disabled:opacity-50"
                        >
                          {busy === `cancel:${o.id}` ? "Cancelling…" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-ink/55">Orders fill at the oracle price when the keeper posts a price that reaches the trigger. Margin and fee are held until then; cancelling returns both.</p>
          </div>
        ))}

      {tab === "history" &&
        (history.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/60">Closed and liquidated positions appear here.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-ink/60">
                <tr>
                  <th className="py-2 pr-3 font-medium">Market</th>
                  <th className="py-2 pr-3 text-right font-medium">Size</th>
                  <th className="py-2 pr-3 text-right font-medium">Entry</th>
                  <th className="py-2 pr-3 text-right font-medium">Exit</th>
                  <th className="py-2 pr-3 text-right font-medium">Realised PnL</th>
                  <th className="py-2 text-right font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-sand/60">
                    <td className="py-2.5 pr-3">
                      <span className="editorial mr-2 text-base">{marketById(h.marketId).city}</span>
                      <SideTag side={h.side} leverage={h.leverage} />
                    </td>
                    <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(h.notional)}</td>
                    <td className="numeric py-2.5 pr-3 text-right">{formatPrice(h.entryPrice)}</td>
                    <td className="numeric py-2.5 pr-3 text-right">{formatPrice(h.exitPrice)}</td>
                    <td className={`numeric py-2.5 pr-3 text-right ${signed(h.realisedPnl)}`}>{formatUsdg(h.realisedPnl, 2, { sign: true })}</td>
                    <td className="py-2.5 text-right text-xs">
                      <span className={h.reason === "liquidated" ? "font-semibold text-short" : h.reason === "take-profit" ? "font-semibold text-long" : "text-ink/70"}>
                        {REASON[h.reason] ?? "Closed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
