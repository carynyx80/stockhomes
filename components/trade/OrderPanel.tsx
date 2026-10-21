"use client";

import { useEffect, useMemo, useState } from "react";
import { SETTLEMENT, TRADING } from "@/config/stoxhomes";
import { data, type Market, type Quote, type Side } from "@/lib/data";
import { formatBps, formatPrice, formatUsdg, parsePrice, parseUsdg, priceInput } from "@/lib/format";
import { feesFor, preview, priceForRoe, type Draft } from "@/lib/trade/preview";

const PRESETS = [1, 2, 5, 10, 25, 50, 100];
const SIZE_SHARES = [10, 25, 50, 100];
const TP_ROE = [25, 50, 100, 200];
const SL_ROE = [10, 25, 50, 75];

const SYMBOL = data.settlementSymbol ?? SETTLEMENT.symbol;
const FEES = feesFor(data.mode);
const CAN_ORDER = typeof data.placeOrder === "function";
const CAN_TRIGGER = data.mode === "live";

export type OrderType = "market" | "limit" | "stop";
export type TicketDraft = Draft & { type: OrderType; marketId: string };

const pct = (v: bigint, bps: number) => (v * BigInt(10_000 + bps)) / 10_000n;

/**
 * The order ticket: market, limit and stop orders, long or short up to 100x, with optional take-profit and
 * stop-loss. Reports its draft upward so the chart and the simulator can show the trade before it's placed.
 */
export function OrderPanel({
  market,
  quote,
  balance,
  walletAddress,
  onDraft,
}: {
  market: Market;
  quote: Quote | null;
  balance: bigint | null;
  walletAddress?: string | null;
  onDraft?: (d: TicketDraft | null) => void;
}) {
  const [side, setSide] = useState<Side>("long");
  const [type, setType] = useState<OrderType>("market");
  const [amount, setAmount] = useState("100");
  const [leverage, setLeverage] = useState(10);
  const [trigger, setTrigger] = useState("");
  const [withTriggers, setWithTriggers] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const mark = quote?.price ?? null;
  // A new market starts clean: trigger prices from another city make no sense here.
  useEffect(() => {
    setTrigger("");
    setTp("");
    setSl("");
    setMessage(null);
  }, [market.id]);

  // Default the trigger 1% on the side the order type implies, once there's a price.
  const defaultTrigger = (t: OrderType, s: Side) => {
    if (!mark || t === "market") return "";
    const below = (s === "long") === (t === "limit");
    return priceInput(pct(mark, below ? -100 : 100));
  };
  const chooseType = (t: OrderType) => {
    setType(t);
    setTrigger(defaultTrigger(t, side));
  };
  const chooseSide = (s: Side) => {
    setSide(s);
    if (type !== "market") setTrigger(defaultTrigger(type, s));
    setTp("");
    setSl("");
  };

  const collateral = parseUsdg(amount);
  const triggerPrice = type === "market" ? null : parsePrice(trigger);
  const entry = type === "market" ? mark : triggerPrice;
  const tpPrice = withTriggers ? parsePrice(tp) : null;
  const slPrice = withTriggers ? parsePrice(sl) : null;

  const draft: Draft | null = collateral && entry ? { side, entry, collateral, leverage, takeProfit: tpPrice, stopLoss: slPrice } : null;
  const p = draft ? preview(draft, FEES) : null;

  useEffect(() => {
    onDraft?.(draft ? { ...draft, type, marketId: market.id } : null);
    // Report by value; `draft` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDraft, market.id, type, side, entry, collateral, leverage, tpPrice, slPrice]);

  const total = collateral != null && p ? collateral + p.openFee : null;
  const insufficient = total != null && balance != null && total > balance;
  const invalidAmount = amount.trim() !== "" && collateral == null;

  const problems = useMemo(() => {
    const out: string[] = [];
    if (type !== "market" && trigger.trim() && !triggerPrice) out.push("Enter the trigger as a plain price, like 725000.");
    if (type !== "market" && triggerPrice && mark) {
      const waitsBelow = (side === "long") === (type === "limit");
      if (waitsBelow ? triggerPrice >= mark : triggerPrice <= mark)
        out.push(`That price is already reached. A ${type} ${side} needs a trigger ${waitsBelow ? "below" : "above"} the current price; use a market order to fill now.`);
    }
    if (withTriggers && entry) {
      if (tp.trim() && !tpPrice) out.push("Enter the take-profit as a plain price.");
      if (sl.trim() && !slPrice) out.push("Enter the stop-loss as a plain price.");
      const long = side === "long";
      if (tpPrice && (long ? tpPrice <= entry : tpPrice >= entry)) out.push(`Take-profit must be ${long ? "above" : "below"} the entry price.`);
      if (slPrice && (long ? slPrice >= entry : slPrice <= entry)) out.push(`Stop-loss must be ${long ? "below" : "above"} the entry price.`);
      if (slPrice && p && (long ? slPrice <= p.liquidation : slPrice >= p.liquidation)) out.push("That stop-loss is past the liquidation price, so liquidation would come first.");
    }
    return out;
  }, [type, trigger, triggerPrice, mark, side, withTriggers, entry, tp, sl, tpPrice, slPrice, p]);

  const needsWallet = data.mode === "live" && !walletAddress;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collateral || !entry || problems.length) return;
    setBusy(true);
    setMessage(null);
    try {
      if (type === "market") {
        const pos = await data.openPosition({ marketId: market.id, side, collateral, leverage, takeProfit: tpPrice, stopLoss: slPrice });
        setMessage({ kind: "ok", text: `Opened ${side} ${market.city} ${leverage}x at ${formatPrice(pos.entryPrice)}.` });
      } else {
        await data.placeOrder!({ marketId: market.id, side, collateral, leverage, type, triggerPrice: triggerPrice!, takeProfit: tpPrice, stopLoss: slPrice });
        setMessage({
          kind: "ok",
          text: `${type === "limit" ? "Limit" : "Stop"} ${side} placed at ${formatPrice(triggerPrice!)}. It fills when the oracle price reaches it; your margin is held until then, and you can cancel any time.`,
        });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't place the order." });
    } finally {
      setBusy(false);
    }
  };

  const setShare = (share: number) => {
    if (balance == null) return;
    // collateral × (1 + leverage × fee) ≤ balance × share
    const budget = (balance * BigInt(share)) / 100n;
    const max = (budget * 10_000n) / (10_000n + BigInt(leverage * FEES.openFeeBps));
    setAmount(formatUsdg(max > 0n ? max - 1n : 0n, 2).replace(/,/g, ""));
  };

  const roeChip = (roe: number, kind: "tp" | "sl") => {
    if (!entry) return;
    const price = priceForRoe(side, entry, leverage, kind === "tp" ? roe * 100 : -roe * 100);
    (kind === "tp" ? setTp : setSl)(priceInput(price));
  };

  const sideColor = side === "long" ? "bg-long" : "bg-short";
  const label =
    type === "market"
      ? `${side === "long" ? "Long" : "Short"} ${market.city} · ${leverage}x`
      : `Place ${type} ${side} · ${triggerPrice ? formatPrice(triggerPrice, 0) : "—"}`;

  return (
    <section aria-labelledby="order-heading" className="panel p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="order-heading" className="editorial text-2xl text-oxblood">
          Place an order
        </h2>
        <span className="truncate text-xs text-ink/55">{market.city}</span>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-5">
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded border border-sand p-1">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => chooseSide(s)}
              className={`rounded-sm py-2 text-sm font-semibold capitalize transition-colors ${
                side === s ? `${s === "long" ? "bg-long" : "bg-short"} text-beige` : "text-ink/70 hover:bg-beige"
              }`}
            >
              {s === "long" ? "Long ↑" : "Short ↓"}
            </button>
          ))}
        </div>

        {CAN_ORDER && (
          <div>
            <div role="tablist" aria-label="Order type" className="flex gap-4 border-b border-sand">
              {(["market", "limit", "stop"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={type === t}
                  onClick={() => chooseType(t)}
                  className={`-mb-px border-b-2 pb-1.5 text-sm font-semibold capitalize ${type === t ? "border-oxblood text-oxblood" : "border-transparent text-ink/55 hover:text-oxblood"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink/60">
              {type === "market" && "Fills now at the oracle price."}
              {type === "limit" && (side === "long" ? "Buys only if the price falls to your trigger or lower." : "Sells only if the price rises to your trigger or higher.")}
              {type === "stop" && (side === "long" ? "Goes long once the price rises through your trigger (breakout)." : "Goes short once the price falls through your trigger (breakdown).")}
            </p>
          </div>
        )}

        {type !== "market" && (
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="trigger" className="text-sm font-medium">
                Trigger price
              </label>
              <span className="text-xs text-ink/60">
                Mark <span className="numeric">{mark ? formatPrice(mark, 0) : "—"}</span>
              </span>
            </div>
            <div className="mt-1.5 flex items-center rounded border border-sand bg-beige focus-within:border-brass">
              <span className="pl-3 text-sm text-ink/50">$</span>
              <input
                id="trigger"
                inputMode="decimal"
                autoComplete="off"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className="numeric w-full min-w-0 bg-transparent px-2 py-2.5 text-base outline-none"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[50, 100, 200, 500].map((bps) => {
                const below = (side === "long") === (type === "limit");
                const signed = below ? -bps : bps;
                return (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => mark && setTrigger(priceInput(pct(mark, signed)))}
                    className="numeric rounded-sm border border-sand px-2 py-0.5 text-xs text-ink/70 hover:border-brass"
                  >
                    {formatBps(signed, 1)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
              aria-invalid={invalidAmount || insufficient}
              aria-describedby="collateral-help"
              className="numeric w-full min-w-0 bg-transparent px-3 py-2.5 text-base outline-none"
            />
            <span className="numeric px-2 text-xs text-ink/60">{SYMBOL}</span>
            <button type="button" onClick={() => setShare(100)} className="mr-1.5 rounded-sm px-2 py-1 text-xs text-wine hover:bg-parchment">
              Max
            </button>
          </div>
          <div className="mt-2 flex gap-1.5">
            {SIZE_SHARES.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => setShare(s)} className="numeric rounded-sm border border-sand px-2 py-0.5 text-xs text-ink/70 hover:border-brass">
                {s}%
              </button>
            ))}
          </div>
          <p id="collateral-help" className="mt-1 text-xs text-short" aria-live="polite">
            {invalidAmount
              ? "Enter a plain amount, like 250 or 250.50."
              : insufficient
                ? needsWallet
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
            <span className={`numeric text-lg ${leverage >= 50 ? "text-short" : "text-oxblood"}`}>{leverage}x</span>
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
            {PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLeverage(v)}
                aria-pressed={leverage === v}
                className={`numeric rounded-sm border px-2 py-0.5 text-xs ${
                  leverage === v ? "border-oxblood bg-oxblood text-beige" : "border-sand text-ink/70 hover:border-brass"
                }`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>

        {CAN_TRIGGER && (
          <fieldset className="rounded border border-sand p-3">
            <legend className="px-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={withTriggers} onChange={(e) => setWithTriggers(e.target.checked)} className="accent-[var(--oxblood)]" />
                Take-profit / stop-loss
              </label>
            </legend>
            {withTriggers ? (
              <div className="flex flex-col gap-3">
                {(
                  [
                    ["tp", "Take-profit", tp, setTp, TP_ROE, p?.tpPnl ?? null],
                    ["sl", "Stop-loss", sl, setSl, SL_ROE, p?.slPnl ?? null],
                  ] as const
                ).map(([k, name, value, set, chips, pnl]) => (
                  <div key={k}>
                    <div className="flex items-baseline justify-between">
                      <label htmlFor={`${k}-price`} className="text-xs font-medium">
                        {name}
                      </label>
                      {pnl != null && (
                        <span className={`numeric text-xs ${pnl >= 0n ? "text-long" : "text-short"}`}>
                          {formatUsdg(pnl, 2, { sign: true })} {SYMBOL}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center rounded border border-sand bg-beige focus-within:border-brass">
                      <span className="pl-2.5 text-sm text-ink/50">$</span>
                      <input
                        id={`${k}-price`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="none"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="numeric w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-ink/35"
                      />
                      {value && (
                        <button type="button" onClick={() => set("")} className="px-2 text-xs text-ink/50 hover:text-short" aria-label={`Clear ${name}`}>
                          ×
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {chips.map((roe) => (
                        <button
                          key={roe}
                          type="button"
                          onClick={() => roeChip(roe, k)}
                          className={`numeric rounded-sm border px-1.5 py-0.5 text-[11px] hover:border-brass ${k === "tp" ? "border-long/40 text-long" : "border-short/40 text-short"}`}
                        >
                          {k === "tp" ? "+" : "−"}
                          {roe}%
                        </button>
                      ))}
                      <span className="self-center text-[10px] text-ink/45">return on margin</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink/55">Close automatically at a profit target or a loss limit. The keeper fills them when the oracle price gets there.</p>
            )}
          </fieldset>
        )}

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-sand pt-4 text-sm">
          <dt className="text-ink/65">Position size</dt>
          <dd className="numeric text-right">{p ? formatUsdg(p.notional) : "—"}</dd>
          <dt className="text-ink/65">{type === "market" ? "Entry (mark)" : "Entry (trigger)"}</dt>
          <dd className="numeric text-right">{entry ? formatPrice(entry) : "—"}</dd>
          <dt className="text-ink/65">Liquidation price</dt>
          <dd className="numeric text-right text-short">{p ? formatPrice(p.liquidation) : "—"}</dd>
          <dt className="text-ink/65">Distance to liquidation</dt>
          <dd className="numeric text-right">{p ? formatBps(p.liqDistanceBps, 2, false) : "—"}</dd>
          <dt className="text-ink/65">
            Open fee <span className="numeric text-xs">({formatBps(FEES.openFeeBps, 2, false)})</span>
          </dt>
          <dd className="numeric text-right">{p ? formatUsdg(p.openFee) : "—"}</dd>
          {FEES.borrowBpsPerDay > 0 && (
            <>
              <dt className="text-ink/65">Borrow fee</dt>
              <dd className="numeric text-right">{p ? `${formatUsdg(p.borrowPerDay)}/day` : "—"}</dd>
            </>
          )}
          <dt className="font-medium text-ink/80">Total cost</dt>
          <dd className="numeric text-right font-medium">{total != null ? `${formatUsdg(total)} ${SYMBOL}` : "—"}</dd>
        </dl>

        {leverage >= 50 && p && (
          <p className="rounded border border-short/40 bg-short/10 px-3 py-2 text-xs text-short">
            At {leverage}x a {formatBps(p.liqDistanceBps, 2, false)} move against you liquidates this position.
          </p>
        )}

        {problems.map((pr) => (
          <p key={pr} className="rounded border border-brass/50 bg-brass/10 px-3 py-2 text-xs text-wine">
            {pr}
          </p>
        ))}

        <button
          type="submit"
          disabled={busy || !collateral || insufficient || !entry || problems.length > 0}
          className={`${sideColor} rounded py-3 text-sm font-semibold text-beige transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {busy ? (type === "market" ? "Opening…" : "Placing…") : type === "market" ? `Open ${side} · ${market.city} · ${leverage}x` : label}
        </button>

        <p aria-live="polite" className={`min-h-[1.25rem] text-xs ${message?.kind === "error" ? "text-short" : "text-long"}`}>
          {message?.text}
        </p>
      </form>
    </section>
  );
}
