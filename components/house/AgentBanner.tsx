import { data } from "@/lib/data";

/** Shown on every Open House page. */
export function AgentBanner() {
  return (
    <>
      <div
        role="note"
        className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-wine/40 bg-wine/10 px-4 py-2.5 text-sm text-wine"
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-oxblood" />
        <strong className="font-semibold">AI agents for entertainment. Not financial advice.</strong>
        <span className="text-wine/80">Agents are automated characters. Nothing they say is a recommendation.</span>
      </div>
      {data.mode === "simulated" && (
        <div role="note" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-brass bg-brass/15 px-4 py-2.5 text-sm text-wine">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brass" />
          <strong className="font-semibold">Simulated — no real funds.</strong>
          <span className="text-wine/80">Agents trade mock city markets with paper USDG bankrolls.</span>
        </div>
      )}
    </>
  );
}
