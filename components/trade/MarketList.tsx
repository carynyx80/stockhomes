"use client";

import { useEffect, useMemo, useState } from "react";
import { data, type Quote } from "@/lib/data";
import { formatBps, formatPrice } from "@/lib/format";

type Sort = "size" | "name" | "change" | "year";
type Region = "all" | "us" | "uk" | "fav";

const FAV_KEY = "stoxhomes:favourite-markets";
const readFavs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/**
 * The market browser: search by city or state, filter by country or favourites, sort by size, name or move.
 * Scrolls inside its panel so 100 markets never push the chart down.
 */
export function MarketList({
  quotes,
  selected,
  onSelect,
}: {
  quotes: Record<string, Quote> | null;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("all");
  const [sort, setSort] = useState<Sort>("size");
  const [favs, setFavs] = useState<string[]>([]);
  const [yearly, setYearly] = useState<Record<string, { d30Bps: number; y1Bps: number }>>({});
  const many = data.markets.length > 8;

  useEffect(() => setFavs(readFavs()), []);
  useEffect(() => {
    if (!many || !data.getChanges) return;
    let live = true;
    void data.getChanges().then((c) => live && setYearly(c));
    return () => {
      live = false;
    };
  }, [many]);

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      // favourites just won't persist
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data.markets.filter((m) => {
      if (region === "us" && m.country !== "United States") return false;
      if (region === "uk" && m.country !== "United Kingdom") return false;
      if (region === "fav" && !favs.includes(m.id)) return false;
      return !q || m.city.toLowerCase().includes(q) || (m.region ?? "").toLowerCase() === q || m.country.toLowerCase().includes(q);
    });
    const change = (id: string) => quotes?.[id]?.change24hBps ?? 0;
    if (sort === "name") rows.sort((a, b) => a.city.localeCompare(b.city));
    if (sort === "change") rows.sort((a, b) => change(b.id) - change(a.id));
    if (sort === "year") rows.sort((a, b) => (yearly[b.id]?.y1Bps ?? -1e9) - (yearly[a.id]?.y1Bps ?? -1e9));
    return rows;
  }, [query, region, sort, favs, quotes, yearly]);

  return (
    <section aria-labelledby="markets-heading" className="panel flex min-w-0 flex-col p-2">
      <div className="flex items-baseline justify-between px-2 pb-1 pt-1.5">
        <h2 id="markets-heading" className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
          City markets
        </h2>
        <span className="numeric text-[11px] text-ink/45">{data.markets.length}</span>
      </div>

      {many && (
        <div className="flex flex-col gap-1.5 px-1 pb-2">
          <label className="sr-only" htmlFor="market-search">
            Search markets
          </label>
          <input
            id="market-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or state…"
            autoComplete="off"
            className="w-full rounded border border-sand bg-beige px-2.5 py-1.5 text-sm outline-none placeholder:text-ink/40 focus:border-brass"
          />
          <div className="flex items-center justify-between gap-1">
            <div role="group" aria-label="Filter markets" className="flex gap-0.5">
              {(
                [
                  ["all", "All"],
                  ["us", "US"],
                  ["uk", "UK"],
                  ["fav", "★"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={region === k}
                  aria-label={k === "fav" ? "Favourites" : undefined}
                  onClick={() => setRegion(k)}
                  className={`rounded-sm px-2 py-0.5 text-[11px] font-semibold ${region === k ? "bg-oxblood text-beige" : "text-ink/65 hover:bg-beige"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="market-sort">
              Sort markets
            </label>
            <select
              id="market-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-sm border border-sand bg-beige px-1 py-0.5 text-[11px] text-ink/75 outline-none focus:border-brass"
            >
              <option value="size">Largest</option>
              <option value="name">A–Z</option>
              <option value="change">24h move</option>
              <option value="year">1-year move</option>
            </select>
          </div>
        </div>
      )}

      <ul className={`grid grid-cols-2 gap-1 lg:grid-cols-1 ${many ? "max-h-72 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[34rem]" : ""}`}>
        {list.map((m) => {
          const q = quotes?.[m.id];
          const active = m.id === selected;
          const y1 = yearly[m.id]?.y1Bps;
          return (
            <li key={m.id} className="relative">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(m.id)}
                className={`flex w-full flex-col rounded px-2.5 py-2 text-left transition-colors ${active ? "bg-beige ring-1 ring-brass" : "hover:bg-beige/60"}`}
              >
                <span className="flex items-baseline justify-between gap-2 pr-5">
                  <span className={`editorial truncate text-lg leading-tight ${active ? "text-oxblood" : "text-ink"}`}>{m.city}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink/45">{m.region ?? m.id}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="numeric text-sm text-ink">{q ? formatPrice(q.price, 0) : "—"}</span>
                  <span className="flex items-baseline gap-1.5">
                    {sort === "year" && y1 != null ? (
                      <span className={`numeric text-xs ${y1 >= 0 ? "text-long" : "text-short"}`}>{formatBps(y1, 1)} 1y</span>
                    ) : (
                      q && <span className={`numeric text-xs ${q.change24hBps >= 0 ? "text-long" : "text-short"}`}>{formatBps(q.change24hBps)}</span>
                    )}
                  </span>
                </span>
              </button>
              {many && (
                <button
                  type="button"
                  onClick={() => toggleFav(m.id)}
                  aria-label={favs.includes(m.id) ? `Remove ${m.city} from favourites` : `Add ${m.city} to favourites`}
                  aria-pressed={favs.includes(m.id)}
                  className={`absolute right-1.5 top-1.5 px-1 text-sm leading-none ${favs.includes(m.id) ? "text-brass" : "text-ink/20 hover:text-brass"}`}
                >
                  ★
                </button>
              )}
            </li>
          );
        })}
        {list.length === 0 && <li className="col-span-2 px-2 py-6 text-center text-sm text-ink/55">No market matches “{query}”.</li>}
      </ul>
    </section>
  );
}
