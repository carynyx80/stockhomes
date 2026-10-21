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
const MINUTE = 60_000;
const DAY = 86_400_000;
/**
 * Without a database the house is a deterministic replay that starts this many days before today (UTC midnight):
 * 2–3 days of history, about a second of catch-up per simulated day on a cold start.
 */
const REPLAY_DAYS = 2;
/** With a database: how often a request may advance due agents (the daily cron alone would freeze them on Hobby). */
const LIVE_TICK_MS = 20_000;

export const replayEpoch = (now: number) => Math.floor(now / DAY) * DAY - REPLAY_DAYS * DAY;

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
  const opts = { dailyBudgetUsd: settings.dailyBudgetUsd, tickMinutes: settings.tickMinutes, limit: AGENTS.maxTicksPerRun };
  const shared = {
    // Without a database every instance runs its own copy, so model calls would multiply and diverge: mock only.
    brain: url && settings.brain === "anthropic" ? anthropicBrain() : mockBrain(),
    publisher: redis ? redisPublisher(redis) : memoryPublisher(),
    lock: redis ? redisKeyedLock(redis) : memoryKeyedLock(),
  };

  /*
   * No database (local dev, or a deployment before Postgres is connected): a deterministic replay.
   * Every instance seeds the same agents at the same epoch (UTC midnight, REPLAY_DAYS ago) and advances on the
   * same one-minute grid with the deterministic mock brain and seeded prices, so any two instances show the same
   * world. It catches up lazily on each request; when the day rolls over, the instance re-anchors to the new epoch
   * so it keeps agreeing with freshly started instances.
   */
  type World = { epoch: number; cursor: number; store: ReturnType<typeof memoryAgentStore>; ready: Promise<void> };
  const newWorld = (epoch: number): World => {
    const store = memoryAgentStore();
    return { epoch, cursor: epoch - MINUTE, store, ready: store.ensureSeeded(SEED_AGENTS, new Date(epoch), BANKROLL, settings.tickMinutes) };
  };

  const pg = url ? pgAgentStore(url) : null;
  let world: World | null = pg ? null : newWorld(replayEpoch(Date.now()));
  let catching: Promise<void> | null = null;
  let lastLiveTick = 0;

  const store = pg ?? world!.store;
  const house: OpenHouse = {
    ...shared,
    store,
    exchange: new SimAgentExchange(store),
    rate: redis ? redisRateLimiter(redis) : memoryRateLimiter(),
    ready: pg ? pg.ensureSeeded(SEED_AGENTS, new Date(), BANKROLL, settings.tickMinutes) : world!.ready,
    sync: async () => {
      await house.ready;
      if (pg) {
        // Postgres: agents are shared state. Advance whoever is due, at most every LIVE_TICK_MS per instance;
        // per-agent locks (Redis) keep two instances from ticking the same agent.
        if (Date.now() - lastLiveTick < LIVE_TICK_MS) return;
        lastLiveTick = Date.now();
        catching ??= runDue(house, new Date(), opts)
          .then(() => undefined)
          .catch(() => undefined)
          .finally(() => {
            catching = null;
          });
        return;
      }
      catching ??= (async () => {
        const epoch = replayEpoch(Date.now());
        if (epoch !== world!.epoch) {
          world = newWorld(epoch);
          house.store = world.store;
          house.exchange = new SimAgentExchange(world.store);
          house.ready = world.ready;
          await world.ready;
        }
        const target = Math.floor(Date.now() / MINUTE) * MINUTE;
        for (let t = world!.cursor + MINUTE; t <= target; t += MINUTE) {
          await runDue(house, new Date(t), opts);
          world!.cursor = t;
        }
      })().finally(() => {
        catching = null;
      });
      await catching;
    },
    storage: pg ? "postgres" : "memory",
    interactive: Boolean(pg) || !process.env.VERCEL,
    settings,
  };
  globalThis.__stoxhomesOpenHouse = house;
  return house;
}
