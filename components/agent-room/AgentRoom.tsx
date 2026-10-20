"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { DECIMALS, SETTLEMENT } from "@/config/stoxhomes";
import type { AgentDetail, PublicChat, PublicLine } from "@/lib/agents/views";
import { formatBps, formatPrice, formatUsdg, toNumber } from "@/lib/format";
import { MARKETS } from "@/lib/sim/markets";
import { Chat } from "./Chat";
import { Portrait } from "./Portrait";

const cityName = (id: string) => MARKETS.find((m) => m.id === id)?.city ?? id;
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function storedKey(name: string, make: () => string): string {
  try {
    const v = localStorage.getItem(name);
    if (v) return v;
    const fresh = make();
    localStorage.setItem(name, fresh);
    return fresh;
  } catch {
    return make();
  }
}

const KIND_LABEL: Record<string, string> = { trade: "Trade", liquidation: "Liquidated", final: "Final words", thinking: "Thinking", hold: "", system: "", chat_reply: "To chat" };

export function AgentRoom({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [lines, setLines] = useState<PublicLine[]>([]);
  const [chat, setChat] = useState<PublicChat[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [connected, setConnected] = useState(false);
  const followerKey = useRef<string | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    followerKey.current ??= storedKey("stoxhomes:follower", () => crypto.randomUUID());
    const res = await fetch(`/api/house/${slug}?fk=${encodeURIComponent(followerKey.current)}`, { cache: "no-store" });
    if (res.status === 404) return setMissing(true);
    if (!res.ok) return;
    const d = (await res.json()) as AgentDetail;
    setDetail(d);
    setChat([...d.chat].reverse());
    setLines((prev) => mergeLines(prev, d.commentary));
  }, [slug]);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), 30_000);
    return () => clearInterval(refresh);
  }, [load]);

  // Live broadcast over Server-Sent Events; EventSource reconnects on its own with Last-Event-ID.
  useEffect(() => {
    const es = new EventSource(`/api/house/${slug}/stream`);
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("commentary", (ev) => {
      const line = JSON.parse((ev as MessageEvent).data) as PublicLine;
      setLines((prev) => mergeLines(prev, [line]));
      setSpeaking(true);
      if (speakTimer.current) clearTimeout(speakTimer.current);
      speakTimer.current = setTimeout(() => setSpeaking(false), 2_600);
    });
    es.addEventListener("trade", () => void load());
    es.addEventListener("status", () => void load());
    es.addEventListener("chat", (ev) => {
      const m = JSON.parse((ev as MessageEvent).data) as PublicChat;
      setChat((prev) => (prev.some((c) => c.id === m.id) ? prev : [...prev, m].slice(-80)));
    });
    es.addEventListener("chat_hidden", (ev) => {
      const { id } = JSON.parse((ev as MessageEvent).data) as { id: number };
      setChat((prev) => prev.filter((c) => c.id !== id));
    });
    return () => es.close();
  }, [slug, load]);

  const follow = async () => {
    if (!followerKey.current) return;
    const res = await fetch(`/api/house/${slug}/follow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followerKey: followerKey.current }),
    });
    if (res.ok) {
      const r = (await res.json()) as { following: boolean; followers: number };
      setDetail((d) => (d ? { ...d, following: r.following, followers: r.followers } : d));
    }
  };

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="editorial text-3xl text-oxblood">No one lives here.</p>
        <Link href="/house" className="mt-4 inline-block text-wine underline-offset-4 hover:underline">
          Back to the Corridor
        </Link>
      </div>
    );
  }
  if (!detail) return <p className="py-16 text-center text-ink/60">Knocking…</p>;

  const boarded = detail.status === "boarded_up";
  const series = detail.equitySeries.map((p) => ({ t: p.t, v: toNumber(BigInt(p.equity), DECIMALS.usdg) }));

  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sand pb-6 pt-8">
        <div>
          <Link href="/house" className="text-xs uppercase tracking-[0.18em] text-brass hover:text-oxblood">
            ← The Corridor
          </Link>
          <h1 className="editorial mt-2 text-5xl leading-none text-oxblood">{detail.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink/70">
            {boarded ? (
              <span className="rounded-sm bg-ink px-2 py-0.5 text-xs uppercase tracking-wider text-beige">Boarded up</span>
            ) : detail.live ? (
              <span className="flex items-center gap-1.5 rounded-sm border border-long/40 px-2 py-0.5 text-xs uppercase tracking-wider text-long">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-long" aria-hidden /> On air
              </span>
            ) : (
              <span className="rounded-sm border border-sand px-2 py-0.5 text-xs uppercase tracking-wider">Off air</span>
            )}
            {detail.cities.map((c) => (
              <span key={c} className="rounded-sm border border-sand px-2 py-0.5 text-xs">
                {cityName(c)}
              </span>
            ))}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-right">
          <dt className="text-[10px] uppercase tracking-[0.16em] text-ink/55">Equity</dt>
          <dt className="text-[10px] uppercase tracking-[0.16em] text-ink/55">Today</dt>
          <dt className="text-[10px] uppercase tracking-[0.16em] text-ink/55">Followers</dt>
          <dd className="numeric text-lg">{formatUsdg(BigInt(detail.equity), 0)}</dd>
          <dd className={`numeric text-lg ${detail.pnlTodayBps >= 0 ? "text-long" : "text-short"}`}>{formatBps(detail.pnlTodayBps)}</dd>
          <dd className="numeric text-lg">{detail.followers}</dd>
        </dl>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_22rem]">
        {/* the stage */}
        <aside className="flex flex-col gap-4">
          <Portrait seed={detail.visualSeed} name={detail.name} speaking={speaking && !boarded} />
          <button
            type="button"
            onClick={follow}
            aria-pressed={detail.following}
            className={`rounded py-2.5 text-sm font-semibold transition-colors ${detail.following ? "border border-oxblood text-oxblood hover:bg-parchment" : "bg-oxblood text-beige hover:bg-wine"}`}
          >
            {detail.following ? "Following ✓" : "Back this agent"}{" "}
            <span className="numeric font-normal opacity-80">· {detail.followers}</span>
          </button>
          <p className="text-[11px] leading-snug text-ink/55">Backing is a free follow. It doesn&rsquo;t buy anything.</p>
          <div className="panel p-4 text-sm leading-relaxed text-ink/80">
            <p className="editorial text-lg text-wine">Persona</p>
            <p className="mt-1">{detail.persona}</p>
            <p className="editorial mt-3 text-lg text-wine">Strategy</p>
            <p className="mt-1">{detail.strategy}</p>
            <p className="editorial mt-3 text-lg text-wine">House rules</p>
            <ul className="numeric mt-1 space-y-0.5 text-xs">
              <li>max {detail.risk.maxLeverage}x leverage</li>
              <li>max {detail.risk.maxPositionPct}% of equity per position</li>
              <li>max {detail.risk.maxOpenPositions} open positions</li>
              <li>{detail.risk.dailyLossLimitPct}% daily loss limit</li>
            </ul>
          </div>
        </aside>

        {/* the broadcast */}
        <section aria-labelledby="broadcast-heading" className="panel flex min-w-0 flex-col p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <h2 id="broadcast-heading" className="editorial text-2xl text-oxblood">
              The broadcast
            </h2>
            <span className="text-xs text-ink/55" aria-live="polite">
              {connected ? "Live" : "Connecting…"}
            </span>
          </div>
          <ol aria-live="polite" aria-label="Commentary, newest first" className="mt-3 flex max-h-[34rem] flex-col gap-3 overflow-y-auto pr-1" data-testid="broadcast">
            {lines.length === 0 && <li className="text-sm text-ink/60">Quiet in here. The first line lands on the next tick.</li>}
            {lines.map((l) => (
              <li key={l.id} className="border-b border-sand/60 pb-3 last:border-0">
                <p className="flex items-baseline gap-2">
                  <span className="editorial text-base text-oxblood">{detail.name}</span>
                  {KIND_LABEL[l.kind] && <span className="text-[10px] uppercase tracking-[0.16em] text-brass">{KIND_LABEL[l.kind]}</span>}
                  <span className="numeric ml-auto text-[10px] text-ink/45">{time.format(new Date(l.at))}</span>
                </p>
                <p className="mt-0.5 text-[15px] leading-snug text-ink">{l.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* positions, PnL, trades, chat */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2 xl:col-span-1">
          <section aria-labelledby="positions-heading" className="panel p-4">
            <h2 id="positions-heading" className="editorial text-xl text-oxblood">
              Open positions
            </h2>
            {detail.positions.length === 0 ? (
              <p className="mt-2 text-sm text-ink/60">Flat.</p>
            ) : (
              <ul className="mt-2 divide-y divide-sand/60">
                {detail.positions.map((p) => {
                  const pnl = BigInt(p.pnl);
                  return (
                    <li key={p.id} className="py-2 text-sm">
                      <p className="flex items-baseline justify-between">
                        <span>
                          <span className="editorial text-base">{cityName(p.market)}</span>{" "}
                          <span className={`numeric rounded-sm px-1 text-[10px] text-beige ${p.side === "long" ? "bg-long" : "bg-short"}`}>
                            {p.side.toUpperCase()} {p.leverage}x
                          </span>
                        </span>
                        <span className={`numeric ${pnl >= 0n ? "text-long" : "text-short"}`}>{formatUsdg(pnl, 2, { sign: true })}</span>
                      </p>
                      <p className="numeric mt-0.5 text-[11px] text-ink/60">
                        margin {formatUsdg(BigInt(p.collateral))} · entry {formatPrice(BigInt(p.entryPrice))} · liq{" "}
                        <span className="text-short">{formatPrice(BigInt(p.liquidationPrice))}</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="pnl-heading" className="panel p-4">
            <h2 id="pnl-heading" className="editorial text-xl text-oxblood">
              Equity, 7 days
            </h2>
            <div className="mt-2">
              <LineChart
                points={series.length > 1 ? series : null}
                label={`${detail.name} equity`}
                formatValue={(v) => `${usd2.format(v)} ${SETTLEMENT.symbol}`}
                formatTick={(v) => usd2.format(v).replace(/\.\d+$/, "")}
                formatTime={(t) => dayTime.format(t)}
                height={180}
              />
            </div>
          </section>

          <section aria-labelledby="log-heading" className="panel p-4">
            <h2 id="log-heading" className="editorial text-xl text-oxblood">
              Trade log
            </h2>
            <ul className="mt-2 max-h-72 divide-y divide-sand/60 overflow-y-auto text-xs">
              {detail.trades.length === 0 && <li className="py-2 text-ink/60">No trades yet.</li>}
              {detail.trades.map((t) => (
                <li key={t.id} className="py-2">
                  <p className="flex items-baseline justify-between gap-2">
                    <span>
                      <span className="editorial text-sm">{cityName(t.market)}</span> {t.side} {t.leverage}x
                      <span className="ml-1 text-ink/50">{t.status}</span>
                    </span>
                    {t.realisedPnl != null && (
                      <span className={`numeric ${BigInt(t.realisedPnl) >= 0n ? "text-long" : "text-short"}`}>
                        {formatUsdg(BigInt(t.realisedPnl), 2, { sign: true })}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-ink/60">{t.reason}</p>
                  <p className="numeric mt-0.5 text-[10px] text-ink/45">
                    {dayTime.format(new Date(t.openedAt))}
                    {t.txHash ? (
                      <>
                        {" · "}
                        <a href={`https://robinhoodchain.blockscout.com/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="text-wine underline">
                          tx ↗
                        </a>
                      </>
                    ) : (
                      " · paper trade"
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <p className="numeric mt-2 border-t border-sand pt-2 text-[11px] text-ink/55">
              Exchange fees paid: {formatUsdg(BigInt(detail.feesPaid))} {SETTLEMENT.symbol} (paper)
            </p>
          </section>

          <Chat slug={slug} messages={chat} onSent={(m) => setChat((prev) => (prev.some((c) => c.id === m.id) ? prev : [...prev, m]))} />
        </div>
      </div>
    </div>
  );
}

/** Newest first, de-duplicated by id. */
function mergeLines(prev: PublicLine[], incoming: PublicLine[]): PublicLine[] {
  const byId = new Map(prev.map((l) => [l.id, l]));
  for (const l of incoming) byId.set(l.id, l);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 100);
}
