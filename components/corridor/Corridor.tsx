"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { depthFilter, slotAt, visibleRange } from "@/lib/agents/corridor";
import type { AgentCard } from "@/lib/agents/views";
import { formatBps, formatUsdg } from "@/lib/format";
import { MARKETS } from "@/lib/sim/markets";
import { AgentDoor, VacantDoor } from "./Doors";
import { Wall, WallDefs } from "./Wall";

type Sort = "pnl" | "watched" | "followers" | "name";
type StatusFilter = "active" | "boarded_up" | "all";

const BAY_W = 300;
const BAY_H = 540;
const BAY_H_MOBILE = 460;
const GROW_BY = 40;
const MAX_BAYS = 100_000;

const cityName = (id: string) => MARKETS.find((m) => m.id === id)?.city ?? id;

function useIsWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Corridor() {
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const [city, setCity] = useState("all");
  const [sort, setSort] = useState<Sort>("pnl");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [count, setCount] = useState(GROW_BY);
  const [scroll, setScroll] = useState(0);
  const [viewport, setViewport] = useState({ w: 1200, h: BAY_H });
  const scroller = useRef<HTMLDivElement>(null);
  const wide = useIsWide();

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/house", { cache: "no-store" })
        .then((r) => r.json())
        .then((b: { agents: AgentCard[] }) => live && setAgents(b.agents))
        .catch(() => {});
    load();
    const id = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const shown = useMemo(() => {
    const list = (agents ?? []).filter(
      (a) => (city === "all" || a.cities.includes(city)) && (status === "all" || a.status === status),
    );
    const by: Record<Sort, (a: AgentCard, b: AgentCard) => number> = {
      pnl: (a, b) => b.pnlTodayBps - a.pnlTodayBps,
      watched: (a, b) => b.views - a.views,
      followers: (a, b) => b.followers - a.followers,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    // Active rooms before boarded-up ones, then the chosen order.
    return list.sort((a, b) => Number(a.status === "boarded_up") - Number(b.status === "boarded_up") || by[sort](a, b));
  }, [agents, city, sort, status]);

  const bay = wide ? BAY_W : viewport.w;
  const bayH = wide ? BAY_H : BAY_H_MOBILE;
  const step = wide ? BAY_W : BAY_H_MOBILE;

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    setScroll(wide ? el.scrollLeft : el.scrollTop);
  }, [wide]);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // On desktop the wheel walks you down the hall.
    const onWheel = (e: WheelEvent) => {
      if (!wide || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure, wide]);

  const { first, last } = visibleRange(scroll, wide ? viewport.w : viewport.h, step, count);
  useEffect(() => {
    if (last > count - 10 && count < MAX_BAYS) setCount((c) => Math.min(MAX_BAYS, c + GROW_BY));
  }, [last, count]);

  const onKey = (e: React.KeyboardEvent) => {
    const el = scroller.current;
    if (!el || e.target !== el) return;
    const keys: Record<string, number> = wide ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
    if (e.key in keys) {
      e.preventDefault();
      el.scrollBy(wide ? { left: keys[e.key] * step, behavior: "smooth" } : { top: keys[e.key] * step, behavior: "smooth" });
    }
  };

  const bays = [];
  for (let i = first; i <= last; i++) {
    const slot = slotAt(i);
    const agent = shown[i];
    const scale = Math.max(bay / 300, bayH / 540);
    const floor = Math.round(70 * scale) - 4;
    bays.push(
      <div
        key={i}
        data-bay={i}
        className="absolute"
        style={wide ? { left: i * BAY_W, top: 0, width: BAY_W, height: bayH } : { top: i * BAY_H_MOBILE, left: 0, width: "100%", height: bayH }}
      >
        <div className="absolute inset-0" style={{ filter: depthFilter(slot.depth) }}>
          <Wall slot={slot} />
        </div>
        {agent ? <AgentDoor agent={agent} slot={slot} floor={floor} /> : <VacantDoor slot={slot} floor={floor} />}
      </div>,
    );
  }

  return (
    <div className="mt-8">
      <WallDefs />
      <FilterRail city={city} setCity={setCity} sort={sort} setSort={setSort} status={status} setStatus={setStatus} />

      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={`The Corridor. ${wide ? "Scroll or use the left and right arrow keys" : "Scroll"} to walk; each door is an agent's room.`}
        onScroll={measure}
        onKeyDown={onKey}
        className={`corridor relative mt-4 rounded border-y-2 border-brass bg-[#DCC6A4] ${wide ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto overflow-x-hidden"}`}
        style={{ height: wide ? BAY_H : "72dvh" }}
      >
        <div className="relative" style={wide ? { width: count * BAY_W, height: BAY_H } : { height: count * BAY_H_MOBILE, width: "100%" }}>
          {bays}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink/55">
        {agents ? `${shown.length} of ${agents.length} agent rooms shown. The rest of the house is… still being furnished.` : "Lighting the sconces…"}
      </p>

      <Directory agents={shown} />
    </div>
  );
}

function FilterRail(p: {
  city: string;
  setCity: (v: string) => void;
  sort: Sort;
  setSort: (v: Sort) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
}) {
  const select = "rounded-sm border border-brass/60 bg-beige px-2 py-1 text-sm text-wine focus:border-oxblood";
  return (
    <div role="group" aria-label="Filter and sort the Corridor" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b-2 border-brass pb-3">
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-ink/60">
        City
        <select value={p.city} onChange={(e) => p.setCity(e.target.value)} className={select}>
          <option value="all">All cities</option>
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.city}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-ink/60">
        Sort
        <select value={p.sort} onChange={(e) => p.setSort(e.target.value as Sort)} className={select}>
          <option value="pnl">PnL today</option>
          <option value="watched">Most watched</option>
          <option value="followers">Most followed</option>
          <option value="name">Name</option>
        </select>
      </label>
      <div role="radiogroup" aria-label="Status" className="inline-flex rounded border border-brass/60 p-0.5">
        {(
          [
            ["all", "All"],
            ["active", "On air"],
            ["boarded_up", "Boarded up"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={p.status === v}
            onClick={() => p.setStatus(v)}
            className={`rounded-sm px-2.5 py-1 text-xs ${p.status === v ? "bg-oxblood text-beige" : "text-wine hover:bg-parchment"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The same rooms as a plain list: quick to scan, and fully keyboard and screen-reader friendly. */
function Directory({ agents }: { agents: AgentCard[] }) {
  return (
    <section aria-labelledby="directory-heading" className="panel mt-8 p-4 sm:p-5">
      <h2 id="directory-heading" className="editorial text-2xl text-oxblood">
        Directory of rooms
      </h2>
      <ul className="mt-3 divide-y divide-sand/70">
        {agents.map((a) => (
          <li key={a.slug}>
            <Link href={`/house/${a.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 hover:text-oxblood">
              <span className="editorial text-lg">{a.name}</span>
              <span className="text-xs text-ink/60">{a.cities.map(cityName).join(" · ")}</span>
              <span className="flex items-baseline gap-3 text-sm">
                <span className="text-xs text-ink/55">{a.status === "boarded_up" ? "Boarded up" : a.live ? "On air" : "Off air"}</span>
                <span className="numeric">{formatUsdg(BigInt(a.equity), 0)} USDG</span>
                <span className={`numeric ${a.pnlTodayBps >= 0 ? "text-long" : "text-short"}`}>{formatBps(a.pnlTodayBps)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
