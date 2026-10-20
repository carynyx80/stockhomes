import { data } from "@/lib/data";

/** Brass banner on every page running against mock data. Disappears when the live DataSource is in. */
export function SimBanner() {
  if (data.mode !== "simulated") return null;
  return (
    <div
      role="note"
      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-brass bg-brass/15 px-4 py-2.5 text-sm text-wine"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brass" />
      <strong className="font-semibold">Simulated — no real funds.</strong>
      <span className="text-wine/80">Prices are mock feeds and balances are paper USDG kept in this browser.</span>
    </div>
  );
}
