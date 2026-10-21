import Link from "next/link";
import { SOCIALS, TRADING } from "@/config/stoxhomes";
import { ContractAddress } from "@/components/token/ContractAddress";
import { LeaveTheHouse } from "./LeaveTheHouse";

export function Footer() {
  return (
    <footer className="mt-24 border-t-2 border-brass bg-parchment/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-2xl">
          <p className="editorial text-lg text-oxblood">A word before you trade</p>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">
            Perpetual futures with up to <span className="numeric">{TRADING.maxLeverage}x</span> leverage are
            high-risk. Small price moves can liquidate your whole position. Stoxhomes is not available in the
            United States, the United Kingdom, Canada, or sanctioned jurisdictions.{" "}
            <Link href="/docs#risks" className="text-oxblood underline underline-offset-2 hover:text-wine">
              Read the full risk disclosure
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex items-center gap-3">
            <ContractAddress />
            <a
              href={SOCIALS.x.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Stoxhomes on X (${SOCIALS.x.handle})`}
              title={`Follow ${SOCIALS.x.handle} on X`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-beige transition-colors hover:bg-oxblood focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
          <LeaveTheHouse />
          <p className="numeric text-xs text-ink/50">Robinhood Chain</p>
        </div>
      </div>
    </footer>
  );
}
