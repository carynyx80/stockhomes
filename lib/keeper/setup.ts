import "server-only";
import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { EXCHANGE } from "@/config/exchange";
import { ORACLE_MARKETS } from "@/config/oracle";
import { network, rpcUrl } from "@/lib/env";
import { fetchAllObservations } from "@/lib/oracle/sources";
import type { Observation } from "@/lib/oracle/price";
import { noiseSeed } from "@/lib/oracle/noise";
import type { KeeperDeps } from "./keeper";

/**
 * Readings change monthly: cached per server instance for an hour. Each source (one Zillow CSV, one UK HPI query)
 * is fetched independently with one retry, so a failing source only skips its own markets, and the last good
 * readings are kept.
 */
let cache: { at: number; data: Record<string, Observation[]> } = { at: 0, data: {} };
let pending: Promise<Record<string, Observation[]>> | null = null;

export async function observations(): Promise<Record<string, Observation[]>> {
  if (Date.now() - cache.at < 3_600_000 && Object.keys(cache.data).length === ORACLE_MARKETS.length) return cache.data;
  pending ??= fetchAllObservations(ORACLE_MARKETS)
    .then((fresh) => {
      cache = { at: Date.now(), data: { ...cache.data, ...fresh } };
      return cache.data;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** A read-only client for the configured network, shared by the API routes. */
let shared: PublicClient | null = null;
export function readClient(): PublicClient {
  if (shared) return shared;
  const chain = network() === "mainnet" ? robinhood : robinhoodTestnet;
  shared = createPublicClient({ chain, transport: http(rpcUrl() ?? chain.rpcUrls.default.http[0], { retryCount: 2, retryDelay: 500 }), batch: { multicall: true } }) as PublicClient;
  return shared;
}

export type KeeperSetup = { ok: true; deps: KeeperDeps; dryRun: boolean } | { ok: false; message: string };

/**
 * KEEPER_PRIVATE_KEY: the oracle publisher (testnet: the testnet deployer). Server-only, never logged.
 * KEEPER_DRY_RUN defaults to true, like the fee bot. The keeper never runs against mainnet until a mainnet
 * deployment exists in config/exchange.ts.
 */
export async function setupKeeper(): Promise<KeeperSetup> {
  const net = network();
  const deployment = EXCHANGE[net];
  if (!deployment) return { ok: false, message: `No Stoxhomes exchange deployed on ${net}.` };
  const chain = net === "mainnet" ? robinhood : robinhoodTestnet;
  const transport = http(rpcUrl() ?? chain.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 800 });
  const client = createPublicClient({ chain, transport }) as PublicClient;

  const dryRun = !["false", "0", "no", "off"].includes((process.env.KEEPER_DRY_RUN ?? "true").toLowerCase());
  const raw = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!raw) return { ok: false, message: "KEEPER_PRIVATE_KEY is not set." };
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return { ok: false, message: "KEEPER_PRIVATE_KEY is malformed." };
  const account = privateKeyToAccount(key);
  const wallet = dryRun ? null : createWalletClient({ account, chain, transport });

  return { ok: true, dryRun, deps: { client, wallet, account: account.address, deployment, markets: ORACLE_MARKETS, observations: await observations(), noiseSeed: network() === "testnet" ? noiseSeed() : undefined } };
}
