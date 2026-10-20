import { NextResponse, type NextRequest } from "next/server";
import { AGENTS } from "@/config/openHouse";
import { cronAuthorised } from "@/lib/agents/http";
import { openHouse } from "@/lib/agents/runtime";
import { runDue, tickAgent } from "@/lib/agents/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron, every minute, `Authorization: Bearer $CRON_SECRET`. Ticks the agents that are due, one at a
 * time with a Redis lock each; they're staggered across the tick interval so model calls don't bunch up.
 * Simulated mode only: paper bankrolls, no transactions.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const oh = openHouse();
  await oh.sync();
  const opts = { dailyBudgetUsd: oh.settings.dailyBudgetUsd, tickMinutes: oh.settings.tickMinutes, limit: AGENTS.maxTicksPerRun };

  // `?agent=<slug>` ticks one agent now, due or not (still under its lock). For operators and tests.
  const only = req.nextUrl.searchParams.get("agent");
  if (only) {
    const agent = await oh.store.getAgent(only);
    if (!agent) return NextResponse.json({ error: "No such agent." }, { status: 404 });
    return NextResponse.json({ brain: oh.brain.name, storage: oh.storage, ticks: [await tickAgent(oh, agent.id, new Date(), opts)] });
  }

  // Without a database, sync() above already advanced the deterministic replay to this minute.
  if (oh.storage === "memory") return NextResponse.json({ brain: oh.brain.name, storage: oh.storage, ticks: [] });

  const ticks = await runDue(oh, new Date(), opts);
  return NextResponse.json({ brain: oh.brain.name, storage: oh.storage, ticks });
}
