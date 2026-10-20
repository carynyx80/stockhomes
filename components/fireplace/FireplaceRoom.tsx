"use client";

import { useEffect, useRef, useState } from "react";
import type { BurnsResponse } from "@/app/api/burns/route";
import { TOKEN } from "@/config/stoxhomes";
import { formatCountdown, formatFixed } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Hearth } from "./Hearth";

const POLL_MS = 30_000;
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const tokens = (base: string, dp = 0) => formatFixed(BigInt(base), TOKEN.decimals, dp);
const ethAmt = (wei: string) => formatFixed(BigInt(wei), 18, 4);
function pctOfSupply(base: string, supply: string) {
  const s = BigInt(supply);
  return s === 0n ? "0.0000" : formatFixed((BigInt(base) * 1_000_000n) / s, 4, 4); // 4dp percentage
}
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">{label}</p>
      <p className="numeric mt-2 text-xl text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-ink/55">{note}</p>}
    </div>
  );
}

export function FireplaceRoom() {
  const [data, setData] = useState<BurnsResponse | null>(null);
  const [error, setError] = useState(false);
  const [flare, setFlare] = useState(false);
  const lastBurnId = useRef<number | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/burns", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as BurnsResponse;
        if (!live) return;
        const newest = body.burns[0]?.id ?? null;
        // Flare only for a burn that arrives while the page is open, not on first load.
        if (lastBurnId.current != null && newest != null && newest !== lastBurnId.current) {
          setFlare(true);
          setTimeout(() => setFlare(false), 2_400);
        }
        lastBurnId.current = newest ?? lastBurnId.current ?? -1;
        setData(body);
        setError(false);
      } catch {
        if (live) setError(true);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const lit = data?.status === "live";
  const burned = data?.totalBurned ?? "0";

  return (
    <div className="pt-10">
      <section aria-labelledby="burned-heading" className="mx-auto max-w-2xl text-center">
        <p id="burned-heading" className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">
          {lit ? `${TOKEN.ticker} burned by the buyback` : "The fire isn’t lit yet"}
        </p>
        <p className="numeric mt-3 text-[clamp(2.4rem,8vw,4.5rem)] leading-none text-oxblood" aria-live="polite">
          {data ? tokens(burned) : "—"}
        </p>
        <p className="mt-2 text-sm text-ink/65">
          {lit ? (
            <>
              <span className="numeric">{pctOfSupply(burned, data!.totalSupply)}%</span> of the{" "}
              <span className="numeric">1,000,000,000</span> supply, sent to the dead address forever.
            </>
          ) : (
            <>Every buyback will burn here, live, once {TOKEN.ticker} launches.</>
          )}
        </p>

        <div className="mx-auto mt-6 max-w-xl">
          <Hearth lit={lit} flare={flare} />
        </div>
      </section>

      {error && <p className="mt-4 text-center text-sm text-short">Couldn’t reach the burn ledger. Retrying every 30 seconds.</p>}

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="At the dead address"
          value={data?.onChainDeadBalance != null ? tokens(data.onChainDeadBalance) : "—"}
          note="Read on-chain, includes any other burns"
        />
        <Tile label="Creator fees claimed" value={data ? `${ethAmt(data.totalClaimedWei)} ETH` : "—"} note="20% of each claim is burned" />
        <Tile label="Burns owed" value={data ? String(data.owedBurns) : "—"} note="Retried first on the next run" />
        <Tile
          label="Next check"
          value={data && now ? formatCountdown(new Date(data.nextCheckAt).getTime() - now) : "—"}
          note={data?.lastRun ? `Last run ${when.format(new Date(data.lastRun.at))}${data.lastRun.dryRun ? " (dry run)" : ""}` : "No runs yet"}
        />
      </div>

      <section aria-labelledby="latest-heading" className="panel mt-6 p-4 sm:p-5">
        <h2 id="latest-heading" className="editorial text-2xl text-oxblood">
          Latest burns
        </h2>
        {!data || data.burns.length === 0 ? (
          <p className="py-6 text-sm text-ink/60">{lit ? "No burns yet. The first lands when creator fees pass $100." : "Nothing has burned yet."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-sand/70">
            {data.burns.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <span className="numeric text-ink">
                  {tokens(b.amount)} <span className="text-ink/55">{TOKEN.ticker}</span>
                </span>
                <span className="text-xs text-ink/60">{when.format(new Date(b.at))}</span>
                <a
                  href={`${data.explorer}/tx/${b.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="numeric text-xs text-wine underline-offset-4 hover:underline"
                >
                  {short(b.txHash)} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 border-t border-sand pt-3 text-xs leading-relaxed text-ink/60">
          How it works: when the token’s claimable creator fees reach $100, the bot claims them, immediately spends 20% buying{" "}
          {TOKEN.ticker} on its Uniswap pool, and sends every token bought to{" "}
          <span className="numeric">0x…dEaD</span>. The other 80% stays with the creator.
        </p>
      </section>
    </div>
  );
}
