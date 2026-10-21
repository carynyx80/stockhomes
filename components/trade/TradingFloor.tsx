"use client";

import { useCallback, useEffect, useState } from "react";
import { LineChart, type ChartGuide } from "@/components/charts/LineChart";
import { data, type HistoryRange } from "@/lib/data";
import { useHistory, useSnapshot } from "@/lib/data/hooks";
import { formatBps, formatPrice, toNumber } from "@/lib/format";
import { DECIMALS } from "@/config/stoxhomes";
import { marketById } from "@/lib/sim/markets";
import { ORACLE_MARKETS, SOURCE_LABEL } from "@/config/oracle";
import { feesFor, preview } from "@/lib/trade/preview";
import { MarketList } from "./MarketList";
import { OrderPanel, type TicketDraft } from "./OrderPanel";
import { Positions } from "./Positions";
import { RangeTabs } from "./RangeTabs";
import { TradeSimulator } from "./TradeSimulator";
import { RANGES, timeFormatter } from "./time";

const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const FEES = feesFor(data.mode);
const px = (v: bigint) => toNumber(v, DECIMALS.price);

export function TradingFloor() {
  const snap = useSnapshot();
  const [marketId, setMarketId] = useState(data.markets[0]?.id ?? "nyc");
  const [range, setRange] = useState<HistoryRange>("1M");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const onDraft = useCallback((d: TicketDraft | null) => setDraft(d), []);
  const market = marketById(marketId);
  useEffect(() => data.focusMarket?.(marketId), [marketId]);
  const quote = snap?.quotes[marketId] ?? null;

  const history = useHistory(`price:${marketId}`, (r) => data.getHistory(marketId, r), range);
  // Pin the chart's last point to the live quote so the line moves with the tape.
  const points = history
    ? [
        ...history.map((p) => ({ t: p.t, v: px(p.price) })),
        ...(quote && history.length && quote.at > history[history.length - 1].t ? [{ t: quote.at, v: px(quote.price) }] : []),
      ]
    : null;

  // Levels on the chart: your positions and orders in this city, and the order being drafted.
  const guides: ChartGuide[] = [];
  for (const p of snap?.account.positions.filter((x) => x.marketId === marketId) ?? []) {
    guides.push({ v: px(p.entryPrice), label: `Your ${p.side} entry`, color: "var(--ink)" });
    guides.push({ v: px(p.liquidationPrice), label: "Liq.", color: "var(--short)" });
    if (p.takeProfit) guides.push({ v: px(p.takeProfit), label: "TP", color: "var(--long)" });
    if (p.stopLoss) guides.push({ v: px(p.stopLoss), label: "SL", color: "var(--brass)" });
  }
  for (const o of snap?.account.orders?.filter((x) => x.marketId === marketId) ?? []) {
    guides.push({ v: px(o.triggerPrice), label: `${o.type} ${o.side}`, color: "var(--wine)" });
  }
  if (draft && draft.marketId === marketId) {
    const pv = preview(draft, FEES);
    if (draft.type !== "market") guides.push({ v: px(draft.entry), label: `New ${draft.type}`, color: "var(--oxblood)" });
    guides.push({ v: px(pv.liquidation), label: "New liq.", color: "var(--short)" });
    if (draft.takeProfit) guides.push({ v: px(draft.takeProfit), label: "New TP", color: "var(--long)" });
    if (draft.stopLoss) guides.push({ v: px(draft.stopLoss), label: "New SL", color: "var(--brass)" });
  }

  const source = ORACLE_MARKETS.find((m) => m.id === marketId)?.source;

  return (
    <>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <MarketList quotes={snap?.quotes ?? null} selected={marketId} onSelect={setMarketId} />

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="market-heading" className="panel min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-ink/55">
                  {market.region ? `${market.region} · ` : ""}
                  {market.country}
                </p>
                <h2 id="market-heading" className="editorial text-4xl leading-none text-oxblood">
                  {market.city}
                </h2>
                <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
                  <span className="numeric text-3xl text-ink">{quote ? formatPrice(quote.price) : "—"}</span>
                  {quote && (
                    <span className={`numeric text-sm ${quote.change24hBps >= 0 ? "text-long" : "text-short"}`}>
                      {formatBps(quote.change24hBps)} <span className="text-ink/50">24h</span>
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-ink/55">
                  {data.mode === "live"
                    ? `On-chain oracle price · ${source ? SOURCE_LABEL[source.kind] : "index"}${data.network === "testnet" ? " + simulated live volatility" : ""}`
                    : "Simulated home-price index, USD"}
                </p>
              </div>
              <RangeTabs ranges={RANGES} value={range} onChange={setRange} label="Chart range" />
            </div>
            <div className="mt-5">
              <LineChart
                points={points}
                label={`${market.city} index, ${range}`}
                formatValue={(v) => usd2.format(v)}
                formatTick={(v) => usd0.format(v)}
                formatTime={timeFormatter(range, true)}
                height={320}
                guides={guides}
              />
            </div>
          </section>

          <TradeSimulator draft={draft && draft.marketId === marketId ? draft : null} market={market} />
        </div>

        <div className="lg:col-span-2 xl:col-span-1">
          <div className="xl:sticky xl:top-4">
            <OrderPanel market={market} quote={quote} balance={snap?.account.balance ?? null} walletAddress={snap?.wallet?.address} onDraft={onDraft} />
          </div>
        </div>
      </div>

      <Positions account={snap?.account ?? null} quotes={snap?.quotes ?? null} />
    </>
  );
}
