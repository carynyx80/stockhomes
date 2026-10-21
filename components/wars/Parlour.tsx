"use client";

import { useState } from "react";
import { SETTLEMENT, SIMULATED } from "@/config/stoxhomes";
import { data, type WarEntry, type WarMatch, type WarSide } from "@/lib/data";
import { useSnapshot } from "@/lib/data/hooks";
import { formatBps, formatCountdown, formatUsdg, parseUsdg } from "@/lib/format";
import { marketById } from "@/lib/sim/markets";
import { useNow } from "@/lib/useNow";

const city = (id: string) => marketById(id).city;

function Change({ bps }: { bps: number }) {
  return <span className={`numeric ${bps > 0 ? "text-long" : bps < 0 ? "text-short" : "text-ink"}`}>{formatBps(bps)}</span>;
}

/** Tug of war: the leader pulls the knot toward their side. Scale: ±0.5% lead fills the bar. */
function Rope({ match }: { match: WarMatch }) {
  const lead = match.changeABps - match.changeBBps;
  const pos = 50 - Math.max(-50, Math.min(50, (lead / 50) * 50));
  return (
    <div className="relative mt-4 h-2 rounded-full bg-sand/60" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
      <div
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-beige bg-oxblood transition-[left] duration-700"
        style={{ left: `${pos}%` }}
      />
    </div>
  );
}

function MatchCard({ match, entry, balance }: { match: WarMatch; entry?: WarEntry; balance: bigint | null }) {
  const [stake, setStake] = useState("25");
  const [busy, setBusy] = useState<WarSide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseUsdg(stake);
  const leader = match.changeABps === match.changeBBps ? null : match.changeABps > match.changeBBps ? "a" : "b";

  const back = async (pick: WarSide) => {
    if (!parsed) return;
    setBusy(pick);
    setError(null);
    try {
      await data.enterWar(match.id, pick, parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place that pick.");
    } finally {
      setBusy(null);
    }
  };

  const side = (s: WarSide) => {
    const id = s === "a" ? match.a : match.b;
    const bps = s === "a" ? match.changeABps : match.changeBBps;
    return (
      <div className={s === "b" ? "text-right" : ""}>
        <p className="editorial text-2xl leading-tight text-oxblood sm:text-3xl">{city(id)}</p>
        <p className="mt-1 text-sm">
          <Change bps={bps} /> <span className="text-xs text-ink/50">this week</span>
        </p>
        {leader === s && <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-brass">Leading</p>}
      </div>
    );
  };

  return (
    <li className="panel p-4 sm:p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        {side("a")}
        <span className="editorial pt-2 text-lg text-ink/50">vs</span>
        {side("b")}
      </div>
      <Rope match={match} />

      {entry ? (
        <p className="mt-5 rounded border border-brass/60 bg-brass/10 px-3 py-2 text-sm text-wine">
          You backed <strong>{city(entry.pick === "a" ? match.a : match.b)}</strong> with{" "}
          <span className="numeric">{formatUsdg(entry.stake)}</span> {SETTLEMENT.symbol}. Pays{" "}
          <span className="numeric">{SIMULATED.wars.payoutMultiplier}×</span> if they win.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor={`stake-${match.id}`} className="text-xs text-ink/65">
              Stake
            </label>
            <div className="flex flex-1 items-center rounded border border-sand bg-beige focus-within:border-brass">
              <input
                id={`stake-${match.id}`}
                inputMode="decimal"
                autoComplete="off"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                className="numeric w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm outline-none"
              />
              <span className="numeric px-2 text-[11px] text-ink/55">{SETTLEMENT.symbol}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["a", "b"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={!parsed || busy != null || (balance != null && parsed != null && parsed > balance)}
                onClick={() => back(s)}
                className="rounded border border-oxblood py-2 text-sm font-semibold text-oxblood transition-colors hover:bg-oxblood hover:text-beige disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === s ? "Placing…" : `Back ${city(s === "a" ? match.a : match.b)}`}
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-short">{error}</p>}
        </div>
      )}
    </li>
  );
}

export function Parlour() {
  const snap = useSnapshot();
  const now = useNow(1000);
  const wars = snap?.wars;

  if (!wars) return <p className="mt-10 text-ink/60">Setting the table…</p>;

  const entryFor = (matchId: string) => wars.entries.find((e) => e.matchId === matchId);
  const yourRank = wars.leaderboard.findIndex((r) => r.isYou) + 1;
  const top = wars.leaderboard.slice(0, 10);
  const youOutsideTop = yourRank > 10 ? wars.leaderboard[yourRank - 1] : null;

  return (
    <>
      <section aria-labelledby="round-heading" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass">
              Season <span className="numeric">{wars.season + 1}</span> · Round{" "}
              <span className="numeric">{(wars.round % 13) + 1}</span> of <span className="numeric">13</span>
            </p>
            <h2 id="round-heading" className="editorial mt-1 text-3xl text-oxblood">
              This week&rsquo;s City Wars
            </h2>
            {data.mode === "live" && (
              <p className="mt-1 max-w-xl text-xs text-brass">City Wars remain a paper game: stakes use your paper balance, not tokens.</p>
            )}
            <p className="mt-1 max-w-xl text-sm text-ink/70">
              Back the city whose home-price index rises more by Monday 00:00 UTC. Winners are paid{" "}
              <span className="numeric">{SIMULATED.wars.payoutMultiplier}×</span> their stake.
            </p>
          </div>
          <div className="panel px-4 py-2.5 text-right">
            <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Round closes in</p>
            <p className="numeric text-xl text-ink">{now ? formatCountdown(wars.roundEndsAt - now) : "—"}</p>
          </div>
        </div>
        <ul className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {wars.current.map((m) => (
            <MatchCard key={m.id} match={m} entry={entryFor(m.id)} balance={snap.account.balance} />
          ))}
        </ul>
      </section>

      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-labelledby="last-heading" className="panel p-4 sm:p-5">
          <h2 id="last-heading" className="editorial text-2xl text-oxblood">
            Last week
          </h2>
          <ul className="mt-3 divide-y divide-sand/70">
            {wars.previous.map((m) => {
              const e = wars.entries.find((x) => x.matchId === m.id);
              const winner = m.result === "push" ? null : m.result === "a" ? m.a : m.b;
              return (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="editorial text-lg">
                      {city(m.a)} <span className="text-ink/45">vs</span> {city(m.b)}
                    </span>
                    <span className="text-sm">
                      {winner ? (
                        <>
                          <span className="font-semibold text-oxblood">{city(winner)}</span> won
                        </>
                      ) : (
                        "Tied"
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink/60">
                    <Change bps={m.changeABps} /> vs <Change bps={m.changeBBps} />
                    {e?.settlement && (
                      <>
                        {" · "}You {e.settlement.result === "push" ? "were refunded" : e.settlement.result === e.pick ? "won" : "lost"}{" "}
                        <span className="numeric">{formatUsdg(e.settlement.payout - e.stake, 2, { sign: true })}</span>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="board-heading" className="panel p-4 sm:p-5">
          <h2 id="board-heading" className="editorial text-2xl text-oxblood">
            The leaderboard
          </h2>
          <p className="mt-1 text-xs text-ink/60">Season net winnings. Rival players are simulated.</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-ink/60">
              <tr>
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-2 font-medium">Player</th>
                <th className="py-1.5 pr-2 text-right font-medium">Won / played</th>
                <th className="py-1.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...top, ...(youOutsideTop ? [youOutsideTop] : [])].map((r) => {
                const rank = wars.leaderboard.indexOf(r) + 1;
                return (
                  <tr key={r.handle} className={`border-t border-sand/60 ${r.isYou ? "bg-brass/15" : ""}`}>
                    <td className="numeric py-2 pr-2 text-ink/60">{rank}</td>
                    <td className={`py-2 pr-2 ${r.isYou ? "font-semibold text-oxblood" : ""}`}>
                      {r.isYou ? "You" : `@${r.handle}`}
                    </td>
                    <td className="numeric py-2 pr-2 text-right text-ink/70">
                      {r.wins}/{r.played}
                    </td>
                    <td className={`numeric py-2 text-right ${r.pnl > 0n ? "text-long" : r.pnl < 0n ? "text-short" : ""}`}>
                      {formatUsdg(r.pnl, 0, { sign: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
