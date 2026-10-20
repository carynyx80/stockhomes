import "server-only";
import { Redis } from "@upstash/redis";
import { AGENTS, SEED_AGENTS } from "@/config/openHouse";
import { DECIMALS } from "@/config/stoxhomes";
import { databaseUrl, openHouseSettings, redisConfig } from "@/lib/env";
import { anthropicBrain } from "./brain-anthropic";
import { mockBrain } from "./brain-mock";
import { SimAgentExchange } from "./exchange";
import {
  memoryKeyedLock,
  memoryPublisher,
  memoryRateLimiter,
  redisKeyedLock,
  redisPublisher,
  redisRateLimiter,
  type RateLimiter,
} from "./infra";
import { memoryAgentStore } from "./store";
import { pgAgentStore } from "./store-pg";
import { runDue, type TickDeps } from "./tick";

export type OpenHouse = TickDeps & {
  rate: RateLimiter;
  ready: Promise<void>;
  /** Waits until the house is ready and, without a database, catches the simulation up to the current minute. */
  sync(): Promise<void>;
  storage: "postgres" | "memory";
  /** Chat and follows need shared storage; off when serverless instances can't share memory. */
  interactive: boolean;
  settings: ReturnType<typeof openHouseSettings>;
};

const BANKROLL = BigInt(AGENTS.startingBankrollUsdg) * 10n ** BigInt(DECIMALS.usdg);
/** Replay starts one 6-hour block before the current one: 6–12 simulated hours of history on a cold start. */
const BLOCK_MS = 6 * 3_600_000;
const MINUTE = 60_000;

declare global {
  var __stoxhomesOpenHouse: OpenHouse | undefined;
}

/** One Open House per server process (survives dev hot reloads). */
export function openHouse(): OpenHouse {
  if (globalThis.__stoxhomesOpenHouse) return globalThis.__stoxhomesOpenHouse;

  const settings = openHouseSettings();
  const url = databaseUrl();
  const rc = redisConfig();
  const redis = rc ? new Redis({ url: rc.url, token: rc.token }) : null;
  const store = url ? pgAgentStore(url) : memoryAgentStore();
  const deps: TickDeps = {
    store,
    exchange: new SimAgentExchange(store),
    // Without a database every instance runs its own copy, so model calls would multiply and diverge: mock only.
    brain: url && settings.brain === "anthropic" ? anthropicBrain() : mockBrain(),
    publisher: redis ? redisPublisher(redis) : memoryPublisher(),
    lock: redis ? redisKeyedLock(redis) : memoryKeyedLock(),
  };
  const opts = { dailyBudgetUsd: settings.dailyBudgetUsd, tickMinutes: settings.tickMinutes, limit: AGENTS.maxTicksPerRun };

  /*
   * No database (local dev, or a deployment before Postgres is connected): a deterministic replay.
   * Every instance seeds the same agents at the same epoch (the start of the previous 6-hour UTC block) and
   * advances on the same one-minute grid with the deterministic mock brain and seeded prices, so any two
   * instances show the same world. It catches up lazily on each request; there's no timer to keep alive.
   */
  const epoch = Math.floor(Date.now() / BLOCK_MS) * BLOCK_MS - BLOCK_MS;
  let cursor = epoch - MINUTE;
  let catching: Promise<void> | null = null;

  const ready = url
    ? store.ensureSeeded(SEED_AGENTS, new Date(), BANKROLL, settings.tickMinutes)
    : store.ensureSeeded(SEED_AGENTS, new Date(epoch), BANKROLL, settings.tickMinutes);

  const sync = async () => {
    await ready;
    if (url) return;
    catching ??= (async () => {
      const target = Math.floor(Date.now() / MINUTE) * MINUTE;
      for (let t = cursor + MINUTE; t <= target; t += MINUTE) {
        await runDue(deps, new Date(t), opts);
        cursor = t;
      }
    })().finally(() => {
      catching = null;
    });
    await catching;
  };

  globalThis.__stoxhomesOpenHouse = {
    ...deps,
    rate: redis ? redisRateLimiter(redis) : memoryRateLimiter(),
    ready,
    sync,
    storage: url ? "postgres" : "memory",
    interactive: Boolean(url) || !process.env.VERCEL,
    settings,
  };
  return globalThis.__stoxhomesOpenHouse;
}
