import { NextResponse } from "next/server";
import type { Address } from "viem";
import { BOT, TOKEN } from "@/config/stoxhomes";
import { erc20Abi } from "@/lib/abis";
import { burnsSummary } from "@/lib/bot/store-pg";
import { activeChain, contracts, publicClient } from "@/lib/chain";
import { databaseUrl, network, tokenAddress } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type BurnsResponse = {
  status: "not-launched" | "live";
  network: string;
  ticker: string;
  explorer: string;
  token: string | null;
  /** Base units (18 decimals), as strings. */
  totalBurned: string;
  onChainDeadBalance: string | null;
  totalSupply: string;
  totalClaimedWei: string;
  owedBurns: number;
  burns: { id: number; amount: string; txHash: string; at: string }[];
  lastRun: { at: string; outcome: string; dryRun: boolean } | null;
  nextCheckAt: string;
};

function nextCheck(now = Date.now()): string {
  const step = BOT.cronIntervalMinutes * 60_000;
  return new Date(Math.ceil((now + 1) / step) * step).toISOString();
}

/** Public, read-only. Burn ledger from the database, cross-checked against the dead address on-chain. */
export async function GET() {
  const token = tokenAddress();
  const supply = TOKEN.totalSupply * 10n ** BigInt(TOKEN.decimals);
  const base: BurnsResponse = {
    status: token ? "live" : "not-launched",
    network: network(),
    ticker: TOKEN.ticker,
    explorer: activeChain().blockExplorers!.default.url,
    token,
    totalBurned: "0",
    onChainDeadBalance: null,
    totalSupply: supply.toString(),
    totalClaimedWei: "0",
    owedBurns: 0,
    burns: [],
    lastRun: null,
    nextCheckAt: nextCheck(),
  };

  const url = databaseUrl();
  const [summary, dead] = await Promise.all([
    url ? burnsSummary(url).catch(() => null) : null,
    token && contracts()
      ? publicClient()
          .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [BOT.deadAddress as Address] })
          .catch(() => null)
      : null,
  ]);

  const body: BurnsResponse = {
    ...base,
    onChainDeadBalance: dead != null ? dead.toString() : null,
    ...(summary && {
      totalBurned: summary.totalBurned.toString(),
      totalClaimedWei: summary.totalClaimedWei.toString(),
      owedBurns: summary.owed,
      burns: summary.burns.map((b) => ({ id: b.id, amount: b.amount.toString(), txHash: b.txHash, at: b.at })),
      lastRun: summary.lastRun,
    }),
  };
  return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" } });
}
