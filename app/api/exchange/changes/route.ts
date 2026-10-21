import { NextResponse } from "next/server";
import { ORACLE_MARKETS } from "@/config/oracle";
import { observations } from "@/lib/keeper/setup";
import { lastPostedAll } from "@/lib/exchange/last-post";
import { livePriceAt } from "@/lib/oracle/live-price";
import { noiseSeed } from "@/lib/oracle/noise";

export const runtime = "nodejs";

const DAY = 86_400_000;

/** 24-hour, 30-day and 1-year change for every live market, from the same model the keeper posts on-chain. */
export const dynamic = "force-dynamic";
export async function GET() {
  const obs = await observations();
  const seed = noiseSeed();
  const posted = await lastPostedAll(ORACLE_MARKETS.map((m) => m.id));
  const changes: Record<string, { d1Bps: number; d30Bps: number; y1Bps: number }> = {};
  for (const m of ORACLE_MARKETS) {
    const o = obs[m.id];
    if (!o?.length) continue;
    const p = (t: number) => livePriceAt(m, o, t, seed);
    const bps = (a: number, b: number) => Math.round((b / a - 1) * 10_000);
    // Up to the last on-chain post only, so the change matches the price on screen and never runs ahead of it.
    const now = Math.min(Date.now(), posted[m.id]);
    const cur = p(now);
    changes[m.id] = { d1Bps: bps(p(now - DAY), cur), d30Bps: bps(p(now - 30 * DAY), cur), y1Bps: bps(p(now - 365 * DAY), cur) };
  }
  return NextResponse.json({ changes }, { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=60" } });
}
