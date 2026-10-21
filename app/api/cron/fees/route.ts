import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { BOT } from "@/config/stoxhomes";
import { runOnce } from "@/lib/bot/engine";
import { setupBot } from "@/lib/bot";
import { cronSecret, tokenNetwork } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return false; // no secret configured → nobody may trigger the bot
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron calls this every 10 minutes with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const setup = setupBot();
  if (!setup.ok) {
    // Even where Pons isn't deployed (testnet), exercise the lock and database so the plumbing is proven.
    if (setup.plumbing) {
      const { store, lock } = setup.plumbing;
      const token = await lock.acquire(BOT.lockTtlSeconds);
      if (!token) return NextResponse.json({ outcome: "locked" });
      try {
        const now = new Date();
        await store.recordRun({
          network: tokenNetwork(),
          dryRun: true,
          startedAt: now,
          finishedAt: now,
          outcome: setup.outcome,
          message: setup.message,
          log: [setup.message],
        });
      } finally {
        await lock.release(token);
      }
    }
    return NextResponse.json({ outcome: setup.outcome, message: setup.message });
  }

  const result = await runOnce(setup.deps, setup.settings);
  return NextResponse.json({ ...result, log: [...setup.notes, ...result.log] });
}
