import { NextResponse, type NextRequest } from "next/server";
import { EXCHANGE } from "@/config/exchange";
import { runKeeper } from "@/lib/keeper/keeper";
import { setupKeeper } from "@/lib/keeper/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Seconds between posts for markets someone is watching or trading, and for the rest. */
const HOT_SECONDS = 20;
const FULL_SECONDS = 600;

let inFlight: Promise<unknown> | null = null;
let lastRun = 0;

/**
 * Live prices while people are on the site. Open pages call this every ~20s with the market they're viewing; it
 * posts due prices (only ever the oracle model's price, so callers can't steer it) and then fills orders, TP/SL and
 * liquidations. Throttled per instance, and on-chain by each market's last post time, so calling it more often
 * changes nothing. Testnet only.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { focus?: unknown };
  const known = new Set(EXCHANGE.testnet?.markets ?? []);
  const focus = (Array.isArray(body.focus) ? body.focus : []).filter((f): f is string => typeof f === "string" && known.has(f)).slice(0, 3);

  if (inFlight || Date.now() - lastRun < 5_000) return NextResponse.json({ outcome: "busy" });
  const setup = await setupKeeper();
  if (!setup.ok || setup.dryRun || setup.deps.deployment.chainId !== 46630) return NextResponse.json({ outcome: "idle" });
  lastRun = Date.now();
  const run = runKeeper(setup.deps, { mode: "tick", focus, hotSeconds: HOT_SECONDS, fullSeconds: FULL_SECONDS, maxActions: 10 });
  inFlight = run;
  try {
    const r = await run;
    return NextResponse.json({ outcome: "ok", posted: r.prices.filter((p) => p.posted).length, actions: r.actions.length });
  } catch (err) {
    // Another instance posting at the same moment (nonce race) lands here; the next tick catches up.
    return NextResponse.json({ outcome: "error", message: err instanceof Error ? err.message.split("\n")[0] : String(err) }, { status: 200 });
  } finally {
    inFlight = null;
  }
}
