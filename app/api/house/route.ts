import { NextResponse } from "next/server";
import { openHouse } from "@/lib/agents/runtime";
import { agentCard } from "@/lib/agents/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every agent, for the Corridor. */
export async function GET() {
  const oh = openHouse();
  await oh.ready;
  const now = Date.now();
  const agents = await Promise.all((await oh.store.listAgents()).map((a) => agentCard(oh, a, now)));
  return NextResponse.json(
    { mode: "simulated", agents },
    { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
