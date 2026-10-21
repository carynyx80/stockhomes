import { NextResponse } from "next/server";
import { ORACLE_MARKETS } from "@/config/oracle";
import { observations } from "@/lib/keeper/setup";
import { marketPriceAt } from "@/lib/oracle/price";

export const runtime = "nodejs";

const DAY = 86_400_000;

/** 24-hour, 30-day and 1-year change for every live market, from the same model the keeper posts on-chain. */
export async function GET() {
  const obs = await observations();
  const now = Date.now();
  const changes: Record<string, { d1Bps: number; d30Bps: number; y1Bps: number }> = {};
  for (const m of ORACLE_MARKETS) {
    const o = obs[m.id];
    if (!o?.length) continue;
    const p = (t: number) => marketPriceAt(m, o, t);
    const bps = (a: number, b: number) => Math.round((b / a - 1) * 10_000);
    const cur = p(now);
    changes[m.id] = { d1Bps: bps(p(now - DAY), cur), d30Bps: bps(p(now - 30 * DAY), cur), y1Bps: bps(p(now - 365 * DAY), cur) };
  }
  return NextResponse.json({ changes }, { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}
