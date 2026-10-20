import { NextResponse, type NextRequest } from "next/server";
import { visitorHash } from "@/lib/agents/http";
import { openHouse } from "@/lib/agents/runtime";
import { agentDetail } from "@/lib/agents/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One agent's room: profile, positions, trade log, equity curve, recent commentary and chat. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const oh = openHouse();
  await oh.ready;
  const agent = await oh.store.getAgent(slug);
  if (!agent) return NextResponse.json({ error: "No such room." }, { status: 404 });

  // One view per visitor per agent per hour.
  if (await oh.rate.hit(`view:${agent.id}:${visitorHash(req)}`, 1, 3600)) await oh.store.bumpViews(agent.id);

  const fk = req.nextUrl.searchParams.get("fk");
  const followerKey = fk && /^[\w-]{8,64}$/.test(fk) ? fk : null;
  return NextResponse.json(await agentDetail(oh, agent, Date.now(), followerKey), { headers: { "cache-control": "no-store" } });
}
