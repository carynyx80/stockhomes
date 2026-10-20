"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { data, type HistoryRange } from "@/lib/data";
import { useHistory, useSnapshot } from "@/lib/data/hooks";
import { formatBps, formatPrice, toNumber } from "@/lib/format";
import { DECIMALS } from "@/config/stoxhomes";
import { marketById } from "@/lib/sim/markets";
import { MarketList } from "./MarketList";
import { OrderPanel } from "./OrderPanel";
import { Positions } from "./Positions";
import { RangeTabs } from "./RangeTabs";
import { RANGES, timeFormatter } from "./time";

const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function TradingFloor() {
  const snap = useSnapshot();
  const [marketId, setMarketId] = useState("nyc");
  const [range, setRange] = useState<HistoryRange>("1W");
  const market = marketById(marketId);
  const quote = snap?.quotes[marketId] ?? null;

  const history = useHistory(`price:${marketId}`, (r) => data.getHistory(marketId, r), range);
  // Pin the chart's last point to the live quote so the line moves with the tape.
  const points = history
    ? [
        ...history.map((p) => ({ t: p.t, v: toNumber(p.price, DECIMALS.price) })),
        ...(quote && quote.at > history[history.length - 1].t
          ? [{ t: quote.at, v: toNumber(quote.price, DECIMALS.price) }]
          : []),
      ]
    : null;

  return (
    <>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <MarketList quotes={snap?.quotes ?? null} selected={marketId} onSelect={setMarketId} />

        <section aria-labelledby="market-heading" className="panel min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-ink/55">{market.country}</p>
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
              <p className="mt-1 text-xs text-ink/55">Simulated home-price index, USD</p>
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
            />
          </div>
        </section>

        <div className="lg:col-span-2 xl:col-span-1">
          <OrderPanel market={market} quote={quote} balance={snap?.account.balance ?? null} />
        </div>
      </div>

      <Positions account={snap?.account ?? null} quotes={snap?.quotes ?? null} />
    </>
  );
}
