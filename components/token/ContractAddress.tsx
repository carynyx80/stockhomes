"use client";

import { useState } from "react";
import { TOKEN } from "@/config/stoxhomes";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The $STOXH contract address with copy and explorer buttons. `full` shows the whole address. */
export function ContractAddress({ full = false, className = "" }: { full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the address is still selectable on screen
    }
  };
  return (
    <div className={`inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-brass/70 bg-brass/10 px-3 py-1.5 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">{TOKEN.ticker} CA</span>
      <span className="numeric select-all break-all text-xs text-wine" title={TOKEN.address}>
        {full ? TOKEN.address : short(TOKEN.address)}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={copy} className="text-[11px] font-semibold text-oxblood underline-offset-4 hover:underline" aria-label={`Copy the ${TOKEN.ticker} contract address`}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <a href={TOKEN.explorer} target="_blank" rel="noopener noreferrer" className="text-[11px] text-ink/60 underline-offset-4 hover:text-oxblood hover:underline">
          Explorer ↗
        </a>
      </span>
    </div>
  );
}
