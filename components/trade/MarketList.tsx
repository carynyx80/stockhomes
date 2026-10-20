"use client";

import { data, type Quote } from "@/lib/data";
import { formatBps, formatPrice } from "@/lib/format";

export function MarketList({
  quotes,
  selected,
  onSelect,
}: {
  quotes: Record<string, Quote> | null;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-labelledby="markets-heading" className="panel p-2">
      <h2 id="markets-heading" className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
        City markets
      </h2>
      <ul className="grid grid-cols-2 gap-1 lg:grid-cols-1">
        {data.markets.map((m) => {
          const q = quotes?.[m.id];
          const active = m.id === selected;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(m.id)}
                className={`flex w-full flex-col rounded px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-beige ring-1 ring-brass" : "hover:bg-beige/60"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`editorial text-lg leading-tight ${active ? "text-oxblood" : "text-ink"}`}>{m.city}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink/45">{m.id}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="numeric text-sm text-ink">{q ? formatPrice(q.price, 0) : "—"}</span>
                  {q && (
                    <span className={`numeric text-xs ${q.change24hBps >= 0 ? "text-long" : "text-short"}`}>
                      {formatBps(q.change24hBps)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
