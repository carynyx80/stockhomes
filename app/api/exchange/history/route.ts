import { NextResponse, type NextRequest } from "next/server";
import { ORACLE_MARKETS, SOURCE_LABEL } from "@/config/oracle";
import { lastPostedAt } from "@/lib/exchange/last-post";
import { observations } from "@/lib/keeper/setup";
import { livePriceAt } from "@/lib/oracle/live-price";
import { noiseSeed } from "@/lib/oracle/noise";

export const runtime = "nodejs";

const RANGES: Record<string, { span: number; step: number }> = {
  "1D": { span: 86_400_000, step: 5 * 60_000 },
  "1W": { span: 7 * 86_400_000, step: 30 * 60_000 },
  "1M": { span: 30 * 86_400_000, step: 3 * 3_600_000 },
  "6M": { span: 182 * 86_400_000, step: 86_400_000 },
  "1Y": { span: 365 * 86_400_000, step: 2 * 86_400_000 },
};

/** Price path for a live market from its official index (the same model the keeper posts on-chain). */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("market") ?? "";
  const range = RANGES[req.nextUrl.searchParams.get("range") ?? "1M"] ?? RANGES["1M"];
  const market = ORACLE_MARKETS.find((m) => m.id === id);
  if (!market) return NextResponse.json({ error: "Unknown market." }, { status: 404 });
  const obs = (await observations())[id];
  if (!obs?.length) return NextResponse.json({ error: "No readings for this market right now." }, { status: 503 });
  const now = Math.min(Date.now(), await lastPostedAt(id));
  const seed = noiseSeed();
  const points: { t: number; price: number }[] = [];
  const first = Math.ceil((now - range.span) / range.step) * range.step;
  for (let t = first; t < now; t += range.step) points.push({ t, price: livePriceAt(market, obs, t, seed) });
  points.push({ t: now, price: livePriceAt(market, obs, now, seed) });
  return NextResponse.json(
    { market: id, source: SOURCE_LABEL[market.source.kind], latestReading: obs.at(-1), points },
    { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } },
  );
}
