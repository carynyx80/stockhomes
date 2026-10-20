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
  storage: "postgres" | "memory";
  settings: ReturnType<typeof openHouseSettings>;
};

const BANKROLL = BigInt(AGENTS.startingBankrollUsdg) * 10n ** BigInt(DECIMALS.usdg);
const WARM_HOURS = 12;

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
    brain: settings.brain === "anthropic" ? anthropicBrain() : mockBrain(),
    publisher: redis ? redisPublisher(redis) : memoryPublisher(),
    lock: redis ? redisKeyedLock(redis) : memoryKeyedLock(),
  };
  const opts = { dailyBudgetUsd: settings.dailyBudgetUsd, tickMinutes: settings.tickMinutes, limit: AGENTS.maxTicksPerRun };

  const ready = (async () => {
    if (url) {
      await store.ensureSeeded(SEED_AGENTS, new Date(), BANKROLL, settings.tickMinutes);
      return;
    }
    // No database: a self-contained demo. Seed 12 hours back and replay them with the mock brain so the corridor
    // has history, then keep ticking in-process (there's no cron locally).
    const now = Date.now();
    const start = new Date(now - WARM_HOURS * 3_600_000);
    await store.ensureSeeded(SEED_AGENTS, start, BANKROLL, settings.tickMinutes);
    const warm = { ...deps, brain: mockBrain() };
    for (let t = start.getTime(); t <= now; t += 60_000) await runDue(warm, new Date(t), opts);
    const timer = setInterval(() => void runDue(deps, new Date(), opts).catch(() => {}), 60_000);
    timer.unref?.();
  })();

  globalThis.__stoxhomesOpenHouse = {
    ...deps,
    rate: redis ? redisRateLimiter(redis) : memoryRateLimiter(),
    ready,
    storage: url ? "postgres" : "memory",
    settings,
  };
  return globalThis.__stoxhomesOpenHouse;
}
