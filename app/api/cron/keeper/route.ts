import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/agents/http";
import { runKeeper } from "@/lib/keeper/keeper";
import { setupKeeper } from "@/lib/keeper/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Posts oracle prices and runs liquidations. Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const setup = await setupKeeper();
  if (!setup.ok) return NextResponse.json({ outcome: "not-configured", message: setup.message });
  try {
    const report = await runKeeper(setup.deps);
    return NextResponse.json({ outcome: setup.dryRun ? "dry-run" : "ok", ...report });
  } catch (err) {
    return NextResponse.json({ outcome: "error", message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
