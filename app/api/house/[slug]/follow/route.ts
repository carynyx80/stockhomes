import { NextResponse, type NextRequest } from "next/server";
import { visitorHash } from "@/lib/agents/http";
import { openHouse } from "@/lib/agents/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Back this agent" in phases A and B: a free follow/unfollow toggle keyed by an anonymous browser id. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const oh = openHouse();
  await oh.ready;
  const agent = await oh.store.getAgent(slug);
  if (!agent) return NextResponse.json({ error: "No such room." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { followerKey?: unknown };
  const key = typeof body.followerKey === "string" && /^[\w-]{8,64}$/.test(body.followerKey) ? body.followerKey : null;
  if (!key) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (!(await oh.rate.hit(`follow:${visitorHash(req)}`, 30, 600))) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });

  return NextResponse.json(await oh.store.toggleFollow(agent.id, key));
}
