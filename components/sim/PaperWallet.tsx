"use client";

import { data } from "@/lib/data";
import { useSnapshot } from "@/lib/data/hooks";
import { formatUsdg } from "@/lib/format";
import { SETTLEMENT } from "@/config/stoxhomes";

export function PaperWallet() {
  const snap = useSnapshot();
  return (
    <div className="panel mt-6 inline-flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Paper balance</span>
      <span className="numeric text-lg text-ink">
        {snap ? formatUsdg(snap.account.balance) : "—"} <span className="text-sm text-ink/60">{SETTLEMENT.symbol}</span>
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
