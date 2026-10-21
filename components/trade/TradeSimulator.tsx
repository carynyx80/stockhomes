"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { DECIMALS, SETTLEMENT } from "@/config/stoxhomes";
import { data, type Market } from "@/lib/data";
import { useHistory } from "@/lib/data/hooks";
import { formatBps, formatPrice, formatUsdg, toNumber } from "@/lib/format";
import { feesFor, moveBpsOf, outcomeAt, preview, replay } from "@/lib/trade/preview";
import type { TicketDraft } from "./OrderPanel";

const FEES = feesFor(data.mode);
const SYMBOL = data.settlementSymbol ?? SETTLEMENT.symbol;
const HOLD_DAYS = [0, 7, 30, 90];
const REPLAY = [
  ["1M", 30],
  ["3M", 91],
  ["6M", 182],
  ["1Y", 365],
] as const;
const PAD = { top: 14, right: 12, bottom: 30, left: 12 };
const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type Ending = "open" | "take-profit" | "stop-loss" | "liquidated";
const ENDING: Record<Ending, { label: string; tone: string }> = {
  open: { label: "Still open", tone: "border-sand text-ink/70" },
  "take-profit": { label: "Take-profit hit", tone: "border-long/50 bg-long/10 text-long" },
  "stop-loss": { label: "Stopped out", tone: "border-brass/60 bg-brass/10 text-wine" },
  liquidated: { label: "Liquidated", tone: "border-short/50 bg-short/10 text-short" },
};

/**
 * Try a trade before placing it: drag the price to see PnL, return on margin and when it liquidates, with
 * borrow fees for the holding time; or replay it against the city's actual price path over the last year.
 */
export function TradeSimulator({ draft, market }: { draft: TicketDraft | null; market: Market }) {
  const [tab, setTab] = useState<"whatif" | "replay">("whatif");
  return (
    <section aria-labelledby="sim-heading" className="panel @container min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sim-heading" className="editorial text-2xl text-oxblood">
            Trade simulator
          </h2>
          <p className="text-xs text-ink/60">Your order ticket, played out before you place it. Nothing here is sent.</p>
        </div>
        <div role="tablist" aria-label="Simulation" className="flex gap-1 rounded border border-sand p-0.5">
          {(
            [
              ["whatif", "What if the price moves"],
              ["replay", "Replay the past year"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-sm px-2.5 py-1 text-xs font-semibold ${tab === k ? "bg-oxblood text-beige" : "text-ink/65 hover:bg-beige"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!draft ? (
        <p className="py-10 text-center text-sm text-ink/55">Enter a collateral amount (and a trigger price for limit and stop orders) in the order ticket to simulate it.</p>
      ) : tab === "whatif" ? (
        <WhatIf draft={draft} market={market} />
      ) : (
        <ReplayPanel draft={draft} market={market} />
      )}
    </section>
  );
}

function WhatIf({ draft, market }: { draft: TicketDraft; market: Market }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [move, setMove] = useState(0);
  const [days, setDays] = useState(0);
  const height = 220;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = preview(draft, FEES);
  const liqMove = moveBpsOf(draft.entry, p.liquidation);
  const tpMove = draft.takeProfit ? moveBpsOf(draft.entry, draft.takeProfit) : null;
  const slMove = draft.stopLoss ? moveBpsOf(draft.entry, draft.stopLoss) : null;
  // Wide enough to show liquidation and both triggers, never narrower than ±0.5%.
  const range = Math.round(Math.min(5_000, Math.max(50, Math.abs(liqMove) * 1.5, Math.abs(tpMove ?? 0) * 1.3, Math.abs(slMove ?? 0) * 1.3)));

  useEffect(() => setMove((m) => Math.max(-range, Math.min(range, m))), [range]);

  const curve = useMemo(() => {
    const n = 120;
    return Array.from({ length: n + 1 }, (_, i) => {
      const m = -range + (2 * range * i) / n;
      return { m, pnl: toNumber(outcomeAt(draft, FEES, m, days).pnl, DECIMALS.usdg) };
    });
  }, [draft, range, days]);

  const lo = Math.min(...curve.map((c) => c.pnl), 0);
  const hi = Math.max(...curve.map((c) => c.pnl), 0);
  const span = hi - lo || 1;
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + ((m + range) / (2 * range)) * iw;
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * ih;
  const line = curve.map((c, i) => `${i ? "L" : "M"}${x(c.m).toFixed(1)},${y(c.pnl).toFixed(1)}`).join("");
  const zero = y(0);

  const o = outcomeAt(draft, FEES, move, days);
  // Compared as moves from entry, so landing exactly on a trigger (the quick buttons) counts as reaching it.
  const tpHit = tpMove != null && (tpMove > 0 ? move >= tpMove : move <= tpMove);
  const slHit = slMove != null && (slMove < 0 ? move <= slMove : move >= slMove);
  // A trigger closes the position at its own price, before the move goes further.
  const settled = o.liquidated ? o : tpHit ? outcomeAt(draft, FEES, tpMove!, days) : slHit ? outcomeAt(draft, FEES, slMove!, days) : o;
  const ending: Ending = o.liquidated ? "liquidated" : slHit ? "stop-loss" : tpHit ? "take-profit" : "open";

  const setFromPointer = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left - PAD.left) / iw));
    setMove(Math.round(-range + frac * 2 * range));
  };

  const marker = (m: number | null, color: string, text: string, dashed = true) =>
    m != null && Math.abs(m) <= range ? (
      <g key={text}>
        <line x1={x(m)} x2={x(m)} y1={PAD.top} y2={PAD.top + ih} stroke={color} strokeWidth="1.5" strokeDasharray={dashed ? "4 3" : undefined} />
        <text x={x(m)} y={PAD.top + ih + 12} textAnchor={m < -range * 0.8 ? "start" : m > range * 0.8 ? "end" : "middle"} className="text-[10px] font-semibold" fill={color}>
          {text}
        </text>
      </g>
    ) : null;

  return (
    <div className="mt-4 grid gap-5 @xl:grid-cols-[minmax(0,1.6fr)_minmax(14rem,1fr)]">
      <div className="min-w-0">
        <div
          ref={wrap}
          className="relative cursor-ew-resize touch-none select-none"
          style={{ height }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setFromPointer(e.clientX);
          }}
          onPointerMove={(e) => e.buttons && setFromPointer(e.clientX)}
          role="img"
          aria-label={`Profit and loss across price moves of plus or minus ${(range / 100).toFixed(2)} percent`}
        >
          <svg width={width} height={height} className="block" aria-hidden>
            <defs>
              <clipPath id="sim-above">
                <rect x={0} y={0} width={width} height={Math.max(0, zero)} />
              </clipPath>
              <clipPath id="sim-below">
                <rect x={0} y={zero} width={width} height={Math.max(0, height - zero)} />
              </clipPath>
            </defs>
            <line x1={PAD.left} x2={PAD.left + iw} y1={zero} y2={zero} stroke="var(--ink)" strokeOpacity=".25" />
            <path d={`${line}L${x(range)},${zero}L${x(-range)},${zero}Z`} fill="var(--long)" fillOpacity=".12" clipPath="url(#sim-above)" />
            <path d={`${line}L${x(range)},${zero}L${x(-range)},${zero}Z`} fill="var(--short)" fillOpacity=".12" clipPath="url(#sim-below)" />
            <path d={line} fill="none" stroke="var(--long)" strokeWidth="2" clipPath="url(#sim-above)" />
            <path d={line} fill="none" stroke="var(--short)" strokeWidth="2" clipPath="url(#sim-below)" />
            {marker(0, "var(--ink)", "Entry", false)}
            {marker(liqMove, "var(--short)", "Liq.")}
            {marker(tpMove, "var(--long)", "TP")}
            {marker(slMove, "var(--brass)", "SL")}
            <line x1={x(move)} x2={x(move)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--oxblood)" strokeOpacity=".5" />
            <circle cx={x(move)} cy={y(toNumber(o.pnl, DECIMALS.usdg))} r="5" fill="var(--oxblood)" stroke="var(--beige)" strokeWidth="2" />
            <text x={PAD.left} y={height - 2} className="numeric fill-ink/50 text-[10px]">
              {formatBps(-range, 2)}
            </text>
            <text x={PAD.left + iw} y={height - 2} textAnchor="end" className="numeric fill-ink/50 text-[10px]">
              {formatBps(range, 2)}
            </text>
          </svg>
        </div>
        <label htmlFor="sim-move" className="sr-only">
          Price move
        </label>
        <input
          id="sim-move"
          type="range"
          min={-range}
          max={range}
          step={1}
          value={move}
          onChange={(e) => setMove(Number(e.target.value))}
          className="mt-1 w-full accent-[var(--oxblood)]"
          aria-valuetext={`${(move / 100).toFixed(2)} percent`}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap gap-1">
            {[
              ["Liquidation", liqMove],
              ["Take-profit", tpMove],
              ["Stop-loss", slMove],
              ["Reset", 0],
            ]
              .filter(([, m]) => m != null && Math.abs(m as number) <= range)
              .map(([name, m]) => (
                <button key={name as string} type="button" onClick={() => setMove(m as number)} className="rounded-sm border border-sand px-2 py-0.5 text-ink/70 hover:border-brass">
                  {name as string}
                </button>
              ))}
          </div>
          {FEES.borrowBpsPerDay > 0 && (
            <div role="group" aria-label="Holding time" className="flex items-center gap-1">
              <span className="text-ink/55">Held</span>
              {HOLD_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                  className={`numeric rounded-sm px-1.5 py-0.5 ${days === d ? "bg-oxblood text-beige" : "text-ink/65 hover:bg-beige"}`}
                >
                  {d === 0 ? "now" : `${d}d`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/75">
          If {market.city} moves <span className={`numeric font-semibold ${move >= 0 ? "text-long" : "text-short"}`}>{formatBps(move)}</span> to{" "}
          <span className="numeric font-semibold text-ink">{formatPrice(o.price, 0)}</span>
          {days > 0 && <> over {days} days</>}:
        </p>
        <div className="rounded border border-sand bg-beige/60 p-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Profit / loss</p>
          <p className={`numeric text-3xl leading-tight transition-colors ${settled.pnl > 0n ? "text-long" : settled.pnl < 0n ? "text-short" : "text-ink"}`}>
            {formatUsdg(settled.pnl, 2, { sign: true })} <span className="text-sm text-ink/55">{SYMBOL}</span>
          </p>
          <p className="numeric mt-0.5 text-sm text-ink/70">{formatBps(settled.roeBps, 1)} on margin</p>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink/60">Returned</dt>
          <dd className="numeric text-right">{formatUsdg(settled.equity)}</dd>
          <dt className="text-ink/60">Fees</dt>
          <dd className="numeric text-right">{formatUsdg(p.openFee + p.closeFee)}</dd>
          {FEES.borrowBpsPerDay > 0 && (
            <>
              <dt className="text-ink/60">Borrow, {days}d</dt>
              <dd className="numeric text-right">{formatUsdg((p.borrowPerDay * BigInt(days)))}</dd>
            </>
          )}
          <dt className="text-ink/60">Liquidation</dt>
          <dd className="numeric text-right text-short">
            {formatPrice(p.liquidation, 0)} <span className="text-xs">({formatBps(liqMove)})</span>
          </dd>
        </dl>
        <AnimatePresence mode="wait">
          <motion.p
            key={ending}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={`rounded border px-3 py-1.5 text-xs font-semibold ${ENDING[ending].tone}`}
          >
            {ending === "open"
              ? "Position still open at this price."
              : ending === "liquidated"
                ? `Liquidated: the ${formatUsdg(draft.collateral)} margin is lost. That's the most this trade can lose.`
                : ending === "take-profit"
                  ? `Take-profit closes it at ${formatPrice(draft.takeProfit!, 0)} first.`
                  : `Stop-loss closes it at ${formatPrice(draft.stopLoss!, 0)} first.`}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ReplayPanel({ draft, market }: { draft: TicketDraft; market: Market }) {
  const [period, setPeriod] = useState<(typeof REPLAY)[number][0]>("3M");
  const history = useHistory(`sim-replay:${market.id}`, (r) => data.getHistory(market.id, r), "1Y", 5 * 60_000);

  const result = useMemo(() => {
    if (!history || history.length < 3) return null;
    const days = REPLAY.find(([k]) => k === period)![1];
    const since = history[history.length - 1].t - days * 86_400_000;
    let start = history.findIndex((pt) => pt.t >= since);
    if (start < 0) start = 0;
    const tpMoveBps = draft.takeProfit ? moveBpsOf(draft.entry, draft.takeProfit) : null;
    const slMoveBps = draft.stopLoss ? moveBpsOf(draft.entry, draft.stopLoss) : null;
    return replay(draft, FEES, history, start, { tpMoveBps, slMoveBps });
  }, [history, period, draft]);

  const date = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink/70">
          {draft.side === "long" ? "Long" : "Short"} {market.city} {draft.leverage}x with {formatUsdg(draft.collateral)} {SYMBOL}, opened
        </span>
        <div role="group" aria-label="Opened" className="flex gap-1">
          {REPLAY.map(([k]) => (
            <button
              key={k}
              type="button"
              aria-pressed={period === k}
              onClick={() => setPeriod(k)}
              className={`numeric rounded-sm px-2 py-0.5 text-xs ${period === k ? "bg-oxblood text-beige" : "border border-sand text-ink/70 hover:border-brass"}`}
            >
              {k} ago
            </button>
          ))}
        </div>
      </div>

      {!result ? (
        <p className="py-10 text-center text-sm text-ink/55">{history ? "Not enough price history for this market yet." : "Loading price history…"}</p>
      ) : (
        <div className="mt-4 grid gap-5 @xl:grid-cols-[minmax(0,1.6fr)_minmax(14rem,1fr)]">
          <div className="min-w-0">
            <LineChart
              points={result.path.map((pt) => ({ t: pt.t, v: toNumber(pt.equity, DECIMALS.usdg) }))}
              label={`Margin balance of the replayed trade, ${period}`}
              formatValue={(v) => `${usd0.format(v)} ${SYMBOL}`}
              formatTick={(v) => usd0.format(v)}
              formatTime={(t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              height={200}
            />
          </div>
          <div className="flex flex-col gap-3">
            <p className={`self-start rounded border px-2.5 py-1 text-xs font-semibold ${ENDING[result.ending].tone}`}>
              {ENDING[result.ending].label}
              {result.ending !== "open" && ` on ${date(result.exitAt)}`}
            </p>
            <div className="rounded border border-sand bg-beige/60 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">{result.ending === "open" ? "Profit / loss today" : "Realised profit / loss"}</p>
              <p className={`numeric text-3xl leading-tight ${result.pnl > 0n ? "text-long" : result.pnl < 0n ? "text-short" : "text-ink"}`}>
                {formatUsdg(result.pnl, 2, { sign: true })} <span className="text-sm text-ink/55">{SYMBOL}</span>
              </p>
              <p className="numeric mt-0.5 text-sm text-ink/70">{formatBps(result.roeBps, 1)} on margin</p>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink/60">Entry {date(result.entryAt)}</dt>
              <dd className="numeric text-right">{formatPrice(result.entry, 0)}</dd>
              <dt className="text-ink/60">{result.ending === "open" ? "Price today" : "Exit"}</dt>
              <dd className="numeric text-right">{formatPrice(result.exit, 0)}</dd>
              <dt className="text-ink/60">City moved</dt>
              <dd className={`numeric text-right ${result.exit >= result.entry ? "text-long" : "text-short"}`}>{formatBps(moveBpsOf(result.entry, result.exit))}</dd>
              <dt className="text-ink/60">Worst point</dt>
              <dd className="numeric text-right text-short">{formatUsdg(result.worstPnl, 2, { sign: true })}</dd>
            </dl>
            <p className="text-[11px] leading-snug text-ink/50">
              Uses the same index path the oracle follows, with fees and {FEES.borrowBpsPerDay > 0 ? "borrow costs" : "no borrow costs"}. Take-profit and stop-loss keep the same distance from the
              historical entry. Past moves don&rsquo;t predict future ones.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
