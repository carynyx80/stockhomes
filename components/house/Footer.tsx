import Link from "next/link";
import { TRADING } from "@/config/stoxhomes";
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
          <LeaveTheHouse />
          <p className="numeric text-xs text-ink/50">Robinhood Chain</p>
        </div>
      </div>
    </footer>
  );
}
