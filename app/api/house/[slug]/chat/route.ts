import { NextResponse, type NextRequest } from "next/server";
import { CHAT } from "@/config/openHouse";
import { visitorHash } from "@/lib/agents/http";
import { moderate, moderateNickname } from "@/lib/agents/moderation";
import { openHouse } from "@/lib/agents/runtime";
import { publicChat } from "@/lib/agents/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { nickname?: unknown; text?: unknown; action?: unknown; id?: unknown };

/**
 * Viewer chat. POST {nickname, text} to talk; POST {action: "report", id} to report a message.
 * Rate-limited per visitor, filtered before it's stored, and handed to agents only as untrusted text.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const oh = openHouse();
  await oh.ready;
  const agent = await oh.store.getAgent(slug);
  if (!agent) return NextResponse.json({ error: "No such room." }, { status: 404 });

  const raw = await req.text();
  if (raw.length > 2_000) return NextResponse.json({ error: "Too long." }, { status: 413 });
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const who = visitorHash(req);

  if (body.action === "report") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    if (!(await oh.rate.hit(`report:${who}`, 10, 600))) return NextResponse.json({ error: "Too many reports." }, { status: 429 });
    const msg = await oh.store.reportChat(id, CHAT.hideAfterReports);
    if (!msg || msg.agentId !== agent.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (msg.hidden) await oh.publisher.publish(slug, { type: "chat_hidden", id });
    return NextResponse.json({ ok: true });
  }

  const nick = moderateNickname(String(body.nickname ?? ""));
  if (!nick.ok) return NextResponse.json({ error: nick.reason }, { status: 422 });
  const text = moderate(String(body.text ?? ""));
  if (!text.ok) return NextResponse.json({ error: text.reason }, { status: 422 });

  const okInterval = await oh.rate.hit(`chat:${who}`, 1, CHAT.minIntervalSeconds);
  const okBurst = await oh.rate.hit(`chat-burst:${who}`, CHAT.burst.count, CHAT.burst.windowSeconds);
  if (!okInterval || !okBurst) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429, headers: { "retry-after": String(CHAT.minIntervalSeconds) } });
  }

  const msg = await oh.store.addChat({ agentId: agent.id, nickname: nick.text, text: text.text, ipHash: who });
  const pub = publicChat(msg);
  await oh.publisher.publish(slug, { type: "chat", ...pub });
  return NextResponse.json(pub, { status: 201 });
}
