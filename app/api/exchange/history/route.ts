import { NextResponse, type NextRequest } from "next/server";
import { ORACLE_MARKETS } from "@/config/oracle";
import { observations } from "@/lib/keeper/setup";
import { marketPriceAt } from "@/lib/oracle/price";

export const runtime = "nodejs";

const RANGES: Record<string, { span: number; step: number }> = {
  "1D": { span: 86_400_000, step: 30 * 60_000 },
  "1W": { span: 7 * 86_400_000, step: 3 * 3_600_000 },
  "1M": { span: 30 * 86_400_000, step: 12 * 3_600_000 },
  "6M": { span: 182 * 86_400_000, step: 2 * 86_400_000 },
  "1Y": { span: 365 * 86_400_000, step: 4 * 86_400_000 },
};

/** Price path for a live market from its official index (the same model the keeper posts on-chain). */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("market") ?? "";
  const range = RANGES[req.nextUrl.searchParams.get("range") ?? "1M"] ?? RANGES["1M"];
  const market = ORACLE_MARKETS.find((m) => m.id === id);
  if (!market) return NextResponse.json({ error: "Unknown market." }, { status: 404 });
  const obs = (await observations())[id];
  const now = Date.now();
  const points: { t: number; price: number }[] = [];
  for (let t = now - range.span; t < now; t += range.step) points.push({ t, price: marketPriceAt(market, obs, t) });
  points.push({ t: now, price: marketPriceAt(market, obs, now) });
  return NextResponse.json(
    { market: id, source: market.source.label, latestReading: obs.at(-1), points },
    { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}
