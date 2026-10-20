"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = { t: number; v: number };

type Props = {
  points: ChartPoint[] | null;
  label: string;
  formatValue: (v: number) => string;
  /** Axis ticks and end label; defaults to formatValue. */
  formatTick?: (v: number) => string;
  formatTime: (t: number) => string;
  height?: number;
};

const PAD = { top: 16, right: 76, bottom: 28, left: 4 };

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/**
 * Single-series line chart: 2px oxblood line, 10% wash, hairline grid, crosshair and tooltip on
 * hover/focus (arrow keys move it), end label, and a table view.
 */
export function LineChart({ points, label, formatValue, formatTick = formatValue, formatTime, height = 300 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vs = points.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const padY = (hi - lo || hi * 0.001) * 0.12;
    lo -= padY;
    hi += padY;
    const step = niceStep(hi - lo, 4);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const iw = width - PAD.left - PAD.right;
    const ih = height - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * iw;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = `${line}L${x(t1).toFixed(1)},${PAD.top + ih}L${x(t0).toFixed(1)},${PAD.top + ih}Z`;
    const xTickCount = width < 480 ? 3 : 5;
    const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + ((t1 - t0) * (i + 0.5)) / xTickCount);
    return { x, y, line, area, ticks, xTicks, iw, ih, t0, t1 };
  }, [points, width, height]);

  const last = points?.[points.length - 1];
  const active = hover != null && points ? points[hover] : null;

  const indexAt = (clientX: number) => {
    if (!geo || !points) return null;
    const rect = wrapRef.current!.getBoundingClientRect();
    const frac = (clientX - rect.left - PAD.left) / geo.iw;
    const t = geo.t0 + Math.min(1, Math.max(0, frac)) * (geo.t1 - geo.t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    }
    return best;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!points) return;
    const n = points.length - 1;
    const cur = hover ?? n;
    const map: Record<string, number> = {
      ArrowLeft: Math.max(0, cur - 1),
      ArrowRight: Math.min(n, cur + 1),
      Home: 0,
      End: n,
    };
    if (e.key in map) {
      e.preventDefault();
      setHover(map[e.key]);
    } else if (e.key === "Escape") setHover(null);
  };

  const tableRows = useMemo(() => {
    if (!points) return [];
    const every = Math.max(1, Math.ceil(points.length / 24));
    return points.filter((_, i) => i % every === 0 || i === points.length - 1).reverse();
  }, [points]);

  return (
    <div>
      <div
        ref={wrapRef}
        className={`relative w-full min-w-0 overflow-hidden select-none outline-none transition-opacity ${points ? "" : "opacity-50"}`}
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${label}. Use left and right arrow keys to read values.`}
        onPointerMove={(e) => setHover(indexAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? (points ? points.length - 1 : null))}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {geo && (
          <svg width={width} height={height} className="block" aria-hidden>
            {geo.ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + geo.iw} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--sand)" strokeOpacity=".7" />
                {/* Skip a tick label the end label would sit on. */}
                {(active || !last || Math.abs(geo.y(v) - geo.y(last.v)) > 14) && (
                  <text x={PAD.left + geo.iw + 8} y={geo.y(v) + 4} className="numeric fill-ink/55 text-[10px]">
                    {formatTick(v)}
                  </text>
                )}
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} x={geo.x(t)} y={height - 8} textAnchor="middle" className="fill-ink/55 text-[10px]">
                {formatTime(t)}
              </text>
            ))}
            <path d={geo.area} fill="var(--oxblood)" fillOpacity=".08" />
            <path d={geo.line} fill="none" stroke="var(--oxblood)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {last && !active && (
              <circle cx={geo.x(last.t)} cy={geo.y(last.v)} r="4" fill="var(--oxblood)" stroke="var(--beige)" strokeWidth="2" />
            )}
            {active && (
              <>
                <line
                  x1={geo.x(active.t)}
                  x2={geo.x(active.t)}
                  y1={PAD.top}
                  y2={PAD.top + geo.ih}
                  stroke="var(--ink)"
                  strokeOpacity=".35"
                />
                <circle cx={geo.x(active.t)} cy={geo.y(active.v)} r="4.5" fill="var(--oxblood)" stroke="var(--beige)" strokeWidth="2" />
              </>
            )}
          </svg>
        )}

        {geo && last && !active && (
          <div
            className="numeric pointer-events-none absolute rounded-sm bg-oxblood px-1.5 py-0.5 text-[10px] text-beige"
            style={{ left: PAD.left + geo.iw + 4, top: geo.y(last.v) - 9 }}
          >
            {formatTick(last.v)}
          </div>
        )}

        {geo && active && (
          <div
            className="pointer-events-none absolute top-1 rounded border border-sand bg-beige px-2.5 py-1.5 shadow-[0_2px_6px_rgba(78,10,15,.12)]"
            style={{
              left: Math.min(Math.max(0, geo.x(active.t) - 70), width - PAD.right - 140),
            }}
          >
            <p className="numeric text-sm font-medium text-ink">{formatValue(active.v)}</p>
            <p className="text-[11px] text-ink/60">{formatTime(active.t)}</p>
          </div>
        )}

        {!points && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink/50">Loading…</p>}
      </div>

      <button
        type="button"
        className="mt-2 text-xs text-wine underline-offset-4 hover:underline"
        aria-expanded={table}
        onClick={() => setTable((v) => !v)}
      >
        {table ? "Hide table" : "View as table"}
      </button>
      {table && (
        <div className="mt-2 max-h-64 overflow-auto rounded border border-sand">
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-parchment text-left text-xs text-ink/60">
              <tr>
                <th className="px-3 py-1.5 font-medium">Time</th>
                <th className="px-3 py-1.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => (
                <tr key={p.t} className="border-t border-sand/60">
                  <td className="px-3 py-1">{formatTime(p.t)}</td>
                  <td className="numeric px-3 py-1 text-right">{formatValue(p.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
