"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { RangeTabs } from "@/components/trade/RangeTabs";
import { timeFormatter } from "@/components/trade/time";
import { DECIMALS, SETTLEMENT } from "@/config/stoxhomes";
import { data, type HistoryRange } from "@/lib/data";
import { useHistory, useSnapshot } from "@/lib/data/hooks";
import { formatBps, formatFixed, formatUsdg, formatUsdgCompact, parseUsdg, toNumber } from "@/lib/format";

const PRICE_ONE = 10n ** BigInt(DECIMALS.price);
const VAULT_RANGES: HistoryRange[] = ["1M", "6M", "1Y"];

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">{label}</p>
      <p className="numeric mt-2 text-2xl text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-ink/55">{note}</p>}
    </div>
  );
}

export function VaultRoom() {
  const snap = useSnapshot();
  const [range, setRange] = useState<HistoryRange>("6M");
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const history = useHistory("vault", (r) => data.getVaultHistory(r), range, 60_000);
  const points = history?.map((p) => ({ t: p.t, v: toNumber(p.price, DECIMALS.price) })) ?? null;

  const v = snap?.vault;
  const holding = snap?.vaultHolding;
  const holdingValue = v && holding ? (holding.shares * v.sharePrice) / PRICE_ONE : null;
  const earned = holdingValue != null && holding ? holdingValue - holding.costBasis : null;
  const oiTotal = v ? v.openInterestLong + v.openInterestShort : 0n;
  const longShare = v && oiTotal > 0n ? Number((v.openInterestLong * 10_000n) / oiTotal) / 100 : 50;

  const parsed = parseUsdg(amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed || !v || !holding) return;
    setBusy(true);
    setMessage(null);
    try {
      if (tab === "deposit") {
        await data.deposit(parsed);
        setMessage({ kind: "ok", text: `Deposited ${formatUsdg(parsed)} ${SETTLEMENT.symbol}.` });
      } else {
        // Withdraw by value: convert to shares, and take every share when asking for (about) the whole holding.
        let shares = (parsed * PRICE_ONE) / v.sharePrice;
        if (holdingValue != null && parsed >= holdingValue) shares = holding.shares;
        await data.withdraw(shares);
        setMessage({ kind: "ok", text: `Withdrew ${formatUsdg((shares * v.sharePrice) / PRICE_ONE)} ${SETTLEMENT.symbol}.` });
      }
      setAmount("");
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "That didn't go through." });
    } finally {
      setBusy(false);
    }
  };

  const max = tab === "deposit" ? snap?.account.balance : holdingValue;

  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Pool size" value={v ? `${formatUsdgCompact(v.tvl)}` : "—"} note={`${SETTLEMENT.symbol} in the House`} />
        <Stat label="Share price" value={v ? formatFixed(v.sharePrice, DECIMALS.price, 4) : "—"} note={`${SETTLEMENT.symbol} per share`} />
        <Stat label="7-day APR" value={v ? formatBps(v.apr7dBps, 1, false) : "—"} note="Annualised from the last 7 days" />
        <Stat label="Utilisation" value={v ? formatBps(v.utilizationBps, 1, false) : "—"} note="Pool backing open positions" />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="share-heading" className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="share-heading" className="editorial text-2xl text-oxblood">
                Share price
              </h2>
              <RangeTabs ranges={VAULT_RANGES} value={range} onChange={setRange} label="Share price range" />
            </div>
            <div className="mt-4">
              <LineChart
                points={points}
                label={`Vault share price, ${range}`}
                formatValue={(x) => x.toFixed(4)}
                formatTime={timeFormatter(range, true)}
                height={260}
              />
            </div>
          </section>

          <section aria-labelledby="oi-heading" className="panel p-4 sm:p-5">
            <h2 id="oi-heading" className="editorial text-2xl text-oxblood">
              Open interest
            </h2>
            <p className="mt-1 text-sm text-ink/65">What traders hold against the House right now.</p>
            <div className="mt-4 flex h-6 gap-0.5 overflow-hidden rounded" aria-hidden>
              <div className="bg-long" style={{ width: `${longShare}%` }} />
              <div className="bg-short" style={{ width: `${100 - longShare}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="flex items-center gap-2 text-ink/65">
                  <span className="h-2.5 w-2.5 rounded-sm bg-long" /> Long
                </dt>
                <dd className="numeric mt-0.5">
                  {v ? formatUsdgCompact(v.openInterestLong) : "—"} <span className="text-ink/55">({longShare.toFixed(1)}%)</span>
                </dd>
              </div>
              <div className="text-right">
                <dt className="flex items-center justify-end gap-2 text-ink/65">
                  <span className="h-2.5 w-2.5 rounded-sm bg-short" /> Short
                </dt>
                <dd className="numeric mt-0.5">
                  {v ? formatUsdgCompact(v.openInterestShort) : "—"}{" "}
                  <span className="text-ink/55">({(100 - longShare).toFixed(1)}%)</span>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="holding-heading" className="panel p-4 sm:p-5">
            <h2 id="holding-heading" className="editorial text-2xl text-oxblood">
              Your share of the House
            </h2>
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink/65">Shares</dt>
              <dd className="numeric text-right">{holding ? formatUsdg(holding.shares, 4) : "—"}</dd>
              <dt className="text-ink/65">Value</dt>
              <dd className="numeric text-right">{holdingValue != null ? formatUsdg(holdingValue) : "—"}</dd>
              <dt className="text-ink/65">Earned</dt>
              <dd
                className={`numeric text-right ${
                  earned == null || earned === 0n ? "" : earned > 0n ? "text-long" : "text-short"
                }`}
              >
                {earned != null ? formatUsdg(earned, 2, { sign: true }) : "—"}
              </dd>
            </dl>
          </section>

          <section aria-label="Deposit or withdraw" className="panel p-4 sm:p-5">
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded border border-sand p-1">
              {(["deposit", "withdraw"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setMessage(null);
                  }}
                  className={`rounded-sm py-2 text-sm font-semibold capitalize ${
                    tab === t ? "bg-oxblood text-beige" : "text-ink/70 hover:bg-beige"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <label htmlFor="vault-amount" className="text-sm font-medium">
                  Amount
                </label>
                <span className="text-xs text-ink/60">
                  {tab === "deposit" ? "Paper balance" : "Withdrawable"}{" "}
                  <span className="numeric">{max != null ? formatUsdg(max) : "—"}</span>
                </span>
              </div>
              <div className="flex items-center rounded border border-sand bg-beige focus-within:border-brass">
                <input
                  id="vault-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="numeric w-full min-w-0 bg-transparent px-3 py-2.5 text-base outline-none"
                />
                <span className="numeric px-2 text-xs text-ink/60">{SETTLEMENT.symbol}</span>
                <button
                  type="button"
                  onClick={() => max != null && setAmount(formatUsdg(max).replace(/,/g, ""))}
                  className="mr-1.5 rounded-sm px-2 py-1 text-xs text-wine hover:bg-parchment"
                >
                  Max
                </button>
              </div>
              <button type="submit" disabled={busy || !parsed} className="btn-oxblood disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? "Working…" : tab === "deposit" ? "Deposit into the Vault" : "Withdraw from the Vault"}
              </button>
              <p aria-live="polite" className={`min-h-[1.25rem] text-xs ${message?.kind === "error" ? "text-short" : "text-long"}`}>
                {message?.text}
              </p>
            </form>
            <p className="border-t border-sand pt-3 text-xs leading-relaxed text-ink/65">
              The Vault takes the other side of every trade. When traders win, the pool pays them, so depositors can
              lose money as well as earn it.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
