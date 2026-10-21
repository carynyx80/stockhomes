"use client";

import { useState } from "react";
import { SETTLEMENT, SIMULATED, TRADING } from "@/config/stoxhomes";
import { data, type Market, type Quote, type Side } from "@/lib/data";
import { formatBps, formatPrice, formatUsdg, parseUsdg } from "@/lib/format";
import { distanceToLiquidationBps, feeOf, liquidationPrice, notionalOf } from "@/lib/perp/math";

const PRESETS = [2, 5, 10, 25, 50, 100];

const SYMBOL = data.settlementSymbol ?? SETTLEMENT.symbol;

export function OrderPanel({ market, quote, balance, walletAddress }: { market: Market; quote: Quote | null; balance: bigint | null; walletAddress?: string | null }) {
  const snapWallet = walletAddress ?? null;
  const [side, setSide] = useState<Side>("long");
  const [amount, setAmount] = useState("100");
  const [leverage, setLeverage] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const collateral = parseUsdg(amount);
  const notional = collateral ? notionalOf(collateral, leverage) : null;
  const fee = notional ? feeOf(notional, SIMULATED.openFeeBps) : null;
  const liq =
    collateral && notional && quote
      ? liquidationPrice(side, quote.price, collateral, notional, SIMULATED.maintenanceMarginBps)
      : null;
  const distance = liq && quote ? distanceToLiquidationBps(quote.price, liq) : null;

  const total = collateral != null && fee != null ? collateral + fee : null;
  const insufficient = total != null && balance != null && total > balance;
  const invalid = amount.trim() !== "" && collateral == null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collateral) return;
    setBusy(true);
    setMessage(null);
    try {
      const pos = await data.openPosition({ marketId: market.id, side, collateral, leverage });
      setMessage({
        kind: "ok",
        text: `Opened ${side} ${market.city} ${leverage}x at ${formatPrice(pos.entryPrice)}.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't open the position." });
    } finally {
      setBusy(false);
    }
  };

  const setMax = () => {
    if (balance == null) return;
    // collateral × (1 + leverage × fee) ≤ balance
    const denom = 10_000n + BigInt(leverage * SIMULATED.openFeeBps);
    const max = (balance * 10_000n) / denom;
    setAmount(formatUsdg(max > 0n ? max - 1n : 0n, 2).replace(/,/g, ""));
  };

  const sideColor = side === "long" ? "bg-long" : "bg-short";

  return (
    <section aria-labelledby="order-heading" className="panel p-4 sm:p-5">
      <h2 id="order-heading" className="editorial text-2xl text-oxblood">
        Place an order
      </h2>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-5">
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded border border-sand p-1">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={`rounded-sm py-2 text-sm font-semibold capitalize transition-colors ${
                side === s ? `${s === "long" ? "bg-long" : "bg-short"} text-beige` : "text-ink/70 hover:bg-beige"
              }`}
            >
              {s === "long" ? "Long ↑" : "Short ↓"}
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="collateral" className="text-sm font-medium">
              Collateral
            </label>
            <span className="text-xs text-ink/60">
              Balance <span className="numeric">{balance != null ? formatUsdg(balance) : "—"}</span>
            </span>
          </div>
          <div className="mt-1.5 flex items-center rounded border border-sand bg-beige focus-within:border-brass">
            <input
              id="collateral"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={invalid || insufficient}
              aria-describedby="collateral-help"
              className="numeric w-full min-w-0 bg-transparent px-3 py-2.5 text-base outline-none"
            />
            <span className="numeric px-2 text-xs text-ink/60">{SYMBOL}</span>
            <button type="button" onClick={setMax} className="mr-1.5 rounded-sm px-2 py-1 text-xs text-wine hover:bg-parchment">
              Max
            </button>
          </div>
          <p id="collateral-help" className="mt-1 text-xs text-short" aria-live="polite">
            {invalid ? "Enter a plain amount, like 250 or 250.50." : insufficient
                ? data.mode === "live" && !snapWallet
                  ? "Connect your wallet to trade."
                  : `Not enough ${data.mode === "live" ? SYMBOL : "paper USDG"} for collateral plus fee.`
                : ""}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="leverage" className="text-sm font-medium">
              Leverage
            </label>
            <span className="numeric text-lg text-oxblood">{leverage}x</span>
          </div>
          <input
            id="leverage"
            type="range"
            min={1}
            max={TRADING.maxLeverage}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--oxblood)]"
            aria-valuetext={`${leverage} times`}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setLeverage(p)}
                aria-pressed={leverage === p}
                className={`numeric rounded-sm border px-2 py-0.5 text-xs ${
                  leverage === p ? "border-oxblood bg-oxblood text-beige" : "border-sand text-ink/70 hover:border-brass"
                }`}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-sand pt-4 text-sm">
          <dt className="text-ink/65">Position size</dt>
          <dd className="numeric text-right">{notional ? formatUsdg(notional) : "—"}</dd>
          <dt className="text-ink/65">Entry (mark)</dt>
          <dd className="numeric text-right">{quote ? formatPrice(quote.price) : "—"}</dd>
          <dt className="text-ink/65">Liquidation price</dt>
          <dd className="numeric text-right text-short">{liq ? formatPrice(liq) : "—"}</dd>
          <dt className="text-ink/65">Distance to liquidation</dt>
          <dd className="numeric text-right">{distance != null ? formatBps(distance, 2, false) : "—"}</dd>
          <dt className="text-ink/65">
            Open fee <span className="numeric text-xs">({formatBps(SIMULATED.openFeeBps, 2, false)})</span>
          </dt>
          <dd className="numeric text-right">{fee ? formatUsdg(fee) : "—"}</dd>
        </dl>

        {leverage >= 50 && distance != null && (
          <p className="rounded border border-short/40 bg-short/10 px-3 py-2 text-xs text-short">
            At {leverage}x a {formatBps(distance, 2, false)} move against you liquidates this position.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !collateral || insufficient || !quote}
          className={`${sideColor} rounded py-3 text-sm font-semibold text-beige transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {busy ? "Opening…" : `Open ${side} · ${market.city} · ${leverage}x`}
        </button>

        <p
          aria-live="polite"
          className={`min-h-[1.25rem] text-xs ${message?.kind === "error" ? "text-short" : "text-long"}`}
        >
          {message?.text}
        </p>
      </form>
    </section>
  );
}
