import type { NextRequest } from "next/server";
import { AGENTS } from "@/config/openHouse";
import { openHouse } from "@/lib/agents/runtime";
import { publicLine } from "@/lib/agents/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;
/** Close a little before the function limit; EventSource reconnects with Last-Event-ID and misses nothing. */
const LIFETIME_MS = 270_000;

/**
 * Server-Sent Events for one room. Replays the last lines (or everything after Last-Event-ID), then follows
 * the live bus (Redis pub/sub in production). Commentary carries its id so the client can de-duplicate.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const oh = openHouse();
  await oh.ready;
  const agent = await oh.store.getAgent(slug);
  if (!agent) return new Response("No such room.", { status: 404 });

  const lastId = Number(req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        controller.enqueue(enc.encode(`${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Subscribe before replaying, so nothing published in between is lost (duplicates are de-duplicated by id).
      const unsubscribe = await oh.publisher.subscribe(slug, (e) => {
        if (e.type === "commentary") send("commentary", { id: e.id, kind: e.kind, text: e.text, at: e.at, tradeId: e.tradeId ?? null }, e.id);
        else send(e.type, e);
      });
      const backlog = await oh.store.commentary(agent.id, { limit: AGENTS.replayLines, afterId: lastId || undefined });
      for (const line of backlog.reverse()) send("commentary", publicLine(line), line.id);
      send("ready", { at: new Date().toISOString() });

      const heartbeat = setInterval(() => !closed && controller.enqueue(enc.encode(": ping\n\n")), HEARTBEAT_MS);
      const stop = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        await unsubscribe().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const lifetime = setTimeout(() => void stop(), LIFETIME_MS);
      req.signal.addEventListener("abort", () => void stop());
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
