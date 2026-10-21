import "server-only";
import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { EXCHANGE } from "@/config/exchange";
import { ORACLE_MARKETS } from "@/config/oracle";
import { network, rpcUrl } from "@/lib/env";
import { fetchSource } from "@/lib/oracle/sources";
import type { Observation } from "@/lib/oracle/price";
import type { KeeperDeps } from "./keeper";

/**
 * Readings change monthly: cached per server instance for an hour. Each source is fetched independently (with one
 * retry), so a slow or failing source only skips its own market, and the last good readings are kept.
 */
let cache: { at: number; data: Record<string, Observation[]> } = { at: 0, data: {} };

export async function observations(): Promise<Record<string, Observation[]>> {
  if (Date.now() - cache.at < 3_600_000 && Object.keys(cache.data).length === ORACLE_MARKETS.length) return cache.data;
  const fetchOne = async (m: (typeof ORACLE_MARKETS)[number]) => {
    try {
      return await fetchSource(m.source);
    } catch {
      return await fetchSource(m.source);
    }
  };
  const results = await Promise.allSettled(ORACLE_MARKETS.map(fetchOne));
  const data = { ...cache.data };
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) data[ORACLE_MARKETS[i].id] = r.value;
  });
  cache = { at: Date.now(), data };
  return data;
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

  return { ok: true, dryRun, deps: { client, wallet, account: account.address, deployment, observations: await observations() } };
}
