"use client";

import { useState } from "react";
import { data } from "@/lib/data";
import { useSnapshot } from "@/lib/data/hooks";
import { formatUsdg } from "@/lib/format";
import { SETTLEMENT } from "@/config/stoxhomes";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Paper balance in Simulated mode; the connected wallet (with a testnet faucet) on-chain. */
export function PaperWallet() {
  const snap = useSnapshot();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const symbol = data.settlementSymbol ?? SETTLEMENT.symbol;

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  if (data.mode === "live") {
    const w = snap?.wallet;
    return (
      <div className="mt-6 flex flex-col gap-1">
        <div className="panel inline-flex flex-wrap items-center gap-x-4 gap-y-2 self-start px-4 py-2.5">
          {!w?.address ? (
            <>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Wallet</span>
              {w && !w.available ? (
                <span className="text-sm text-ink/70">Install a browser wallet (MetaMask, Rabby…) to trade.</span>
              ) : (
                <button type="button" className="btn-oxblood !py-1.5 text-sm" disabled={busy != null} onClick={() => act("connect", () => data.connectWallet!())}>
                  {busy === "connect" ? "Connecting…" : "Connect wallet"}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="numeric text-xs text-ink/60">{short(w.address)}</span>
              <span className="numeric text-lg text-ink">
                {formatUsdg(snap!.account.balance)} <span className="text-sm text-ink/60">{symbol}</span>
              </span>
              {!w.chainOk && (
                <button type="button" className="text-xs text-short underline" onClick={() => act("connect", () => data.connectWallet!())}>
                  Switch to Robinhood Chain {data.network}
                </button>
              )}
              {data.faucet && (
                <button type="button" className="text-xs text-wine underline-offset-4 hover:underline" disabled={busy != null} onClick={() => act("faucet", () => data.faucet!())}>
                  {busy === "faucet" ? "Minting…" : `Get 10,000 ${symbol}`}
                </button>
              )}
            </>
          )}
        </div>
        {error && <p className="text-xs text-short">{error}</p>}
        {data.network === "testnet" && (
          <p className="text-[11px] text-ink/55">
            You need a little testnet ETH for gas: <a className="underline" href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">Robinhood Chain faucet</a>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel mt-6 inline-flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Paper balance</span>
      <span className="numeric text-lg text-ink">
        {snap ? formatUsdg(snap.account.balance) : "—"} <span className="text-sm text-ink/60">{symbol}</span>
      </span>
      {data.resetPaper && (
        <button
          type="button"
          className="text-xs text-wine underline-offset-4 hover:underline"
          onClick={() => {
            if (window.confirm("Reset your paper account? Positions, Vault shares and War picks are cleared.")) {
              void data.resetPaper!();
            }
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
