"use client";

import { useState } from "react";
import { SIMULATED } from "@/config/stoxhomes";
import { data, type Account, type Position, type Quote } from "@/lib/data";
import { formatBps, formatPrice, formatUsdg } from "@/lib/format";
import { feeOf, pnlOf } from "@/lib/perp/math";
import { marketById } from "@/lib/sim/markets";

function livePnl(pos: Position, mark: bigint) {
  const pnl = pnlOf(pos.side, pos.notional, pos.entryPrice, mark);
  const net = pnl - feeOf(pos.notional, SIMULATED.closeFeeBps);
  const bps = Number((net * 10_000n) / pos.collateral);
  return { net, bps };
}

const SideTag = ({ side, leverage }: { side: Position["side"]; leverage: number }) => (
  <span
    className={`numeric inline-block rounded-sm px-1.5 py-0.5 text-[11px] text-beige ${side === "long" ? "bg-long" : "bg-short"}`}
  >
    {side === "long" ? "LONG" : "SHORT"} {leverage}x
  </span>
);

const signed = (v: bigint) => (v > 0n ? "text-long" : v < 0n ? "text-short" : "text-ink");

export function Positions({ account, quotes }: { account: Account | null; quotes: Record<string, Quote> | null }) {
  const [tab, setTab] = useState<"open" | "history">("open");
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = async (id: string) => {
    setClosing(id);
    setError(null);
    try {
      await data.closePosition(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close the position.");
    } finally {
      setClosing(null);
    }
  };

  const positions = account?.positions ?? [];
  const history = account?.history ?? [];

  return (
    <section aria-label="Your positions" className="panel mt-6 p-4 sm:p-5">
      <div role="tablist" className="flex gap-6 border-b border-sand">
        {(
          [
            ["open", `Open positions (${positions.length})`],
            ["history", "History"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`editorial -mb-px border-b-2 pb-2 text-lg ${
              tab === key ? "border-oxblood text-oxblood" : "border-transparent text-ink/60 hover:text-oxblood"
            }`}
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
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-ink/60">
                <tr>
                  <th className="py-2 pr-3 font-medium">Market</th>
                  <th className="py-2 pr-3 text-right font-medium">Size</th>
                  <th className="py-2 pr-3 text-right font-medium">Collateral</th>
                  <th className="py-2 pr-3 text-right font-medium">Entry</th>
                  <th className="py-2 pr-3 text-right font-medium">Mark</th>
                  <th className="py-2 pr-3 text-right font-medium">Liq. price</th>
                  <th className="py-2 pr-3 text-right font-medium">PnL (after close fee)</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const mark = quotes?.[p.marketId]?.price ?? p.entryPrice;
                  const { net, bps } = livePnl(p, mark);
                  return (
                    <tr key={p.id} className="border-t border-sand/60">
                      <td className="py-2.5 pr-3">
                        <span className="editorial mr-2 text-base">{marketById(p.marketId).city}</span>
                        <SideTag side={p.side} leverage={p.leverage} />
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(p.notional)}</td>
                      <td className="numeric py-2.5 pr-3 text-right">{formatUsdg(p.collateral)}</td>
                      <td className="numeric py-2.5 pr-3 text-right">{formatPrice(p.entryPrice)}</td>
                      <td className="numeric py-2.5 pr-3 text-right">{formatPrice(mark)}</td>
                      <td className="numeric py-2.5 pr-3 text-right text-short">{formatPrice(p.liquidationPrice)}</td>
                      <td className={`numeric py-2.5 pr-3 text-right ${signed(net)}`}>
                        {formatUsdg(net, 2, { sign: true })}{" "}
                        <span className="text-xs">({formatBps(bps)})</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => close(p.id)}
                          disabled={closing === p.id}
                          className="rounded-sm border border-oxblood px-2.5 py-1 text-xs font-semibold text-oxblood hover:bg-oxblood hover:text-beige disabled:opacity-50"
                        >
                          {closing === p.id ? "Closing…" : "Close"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                    <td className={`numeric py-2.5 pr-3 text-right ${signed(h.realisedPnl)}`}>
                      {formatUsdg(h.realisedPnl, 2, { sign: true })}
                    </td>
                    <td className="py-2.5 text-right text-xs">
                      {h.reason === "liquidated" ? (
                        <span className="font-semibold text-short">Liquidated</span>
                      ) : (
                        <span className="text-ink/70">Closed</span>
                      )}
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
