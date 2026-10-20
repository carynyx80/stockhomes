import "server-only";
import { Redis } from "@upstash/redis";
import { contracts, publicClient } from "@/lib/chain";
import {
  botSettings,
  creatorKey,
  databaseUrl,
  network,
  payoutWalletAddress,
  redisConfig,
  telegramConfig,
  tokenAddress,
} from "@/lib/env";
import { privateKeyToAccount } from "viem/accounts";
import { telegramAlerts } from "./alerts";
import type { Deps, Settings } from "./engine";
import { liveChain } from "./live";
import { memoryLock, redisLock } from "./lock";
import { memoryStore } from "./memory-store";
import { pgStore } from "./store-pg";
import type { LockPort, StorePort } from "./types";

export type BotSetup =
  | { ok: true; deps: Deps; settings: Settings; notes: string[] }
  | { ok: false; outcome: string; message: string; plumbing?: { store: StorePort; lock: LockPort } };

/** Assembles the bot from env, refusing anything unsafe (live mode without a lock, a database or a key). */
export function setupBot(): BotSetup {
  const net = network();
  const s = botSettings();
  const notes: string[] = [];

  const dbUrl = databaseUrl();
  const redis = redisConfig();
  if (!s.dryRun && (!dbUrl || !redis)) {
    return { ok: false, outcome: "misconfigured", message: "Live mode needs DATABASE_URL and the Redis lock (KV_REST_API_URL/TOKEN)." };
  }
  const store = dbUrl ? pgStore(dbUrl) : memoryStore();
  const lock = redis ? redisLock(new Redis({ url: redis.url, token: redis.token })) : memoryLock();
  if (!dbUrl) notes.push("No DATABASE_URL: this dry run keeps its log in memory only.");
  if (!redis) notes.push("No Redis configured: using an in-process lock (dry run only).");

  const c = contracts();
  if (!c) {
    return {
      ok: false,
      outcome: "unavailable",
      message: `Pons V2 and Uniswap v4 aren't deployed on ${net}; checked the lock and database only.`,
      plumbing: { store, lock },
    };
  }

  const token = tokenAddress();
  if (!token) return { ok: false, outcome: "not-configured", message: "TOKEN_ADDRESS is not set yet; nothing to do until launch." };

  const key = creatorKey();
  const readOnly = payoutWalletAddress();
  if (!s.dryRun && !key) return { ok: false, outcome: "misconfigured", message: "Live mode needs CREATOR_PRIVATE_KEY." };
  if (key && readOnly && privateKeyToAccount(key).address.toLowerCase() !== readOnly.toLowerCase()) {
    return { ok: false, outcome: "misconfigured", message: "PAYOUT_WALLET_ADDRESS doesn't match CREATOR_PRIVATE_KEY." };
  }

  return {
    ok: true,
    notes,
    deps: {
      chain: liveChain(publicClient(), c, token, readOnly),
      store,
      lock,
      alerts: telegramAlerts(telegramConfig()),
    },
    settings: {
      network: net,
      dryRun: s.dryRun,
      thresholdUsd: s.thresholdUsd,
      burnShareBps: s.burnShareBps,
      maxSlippageBps: s.maxSlippageBps,
      maxGasShareBps: s.maxGasShareBps,
      minGasWei: s.minGasWei,
      startBlock: s.startBlock,
      txWaitMs: 60_000,
    },
  };
}
