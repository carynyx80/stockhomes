import type { RedisLike } from "@/lib/bot/lock";

/**
 * Per-agent locks, rate limits and the live-event bus. Redis in production; in-memory equivalents with the same
 * semantics for tests and single-process dev. (The fee bot keeps its own lock in lib/bot/lock.ts.)
 */

export interface KeyedLock {
  acquire(key: string, ttlSeconds: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function redisKeyedLock(redis: RedisLike): KeyedLock {
  return {
    async acquire(key, ttl) {
      const token = crypto.randomUUID();
      return (await redis.set(`stoxhomes:lock:${key}`, token, { nx: true, ex: ttl })) === "OK" ? token : null;
    },
    async release(key, token) {
      await redis.eval(RELEASE, [`stoxhomes:lock:${key}`], [token]);
    },
  };
}

export function memoryKeyedLock(now = () => Date.now()): KeyedLock {
  const held = new Map<string, { token: string; until: number }>();
  return {
    async acquire(key, ttl) {
      const h = held.get(key);
      if (h && h.until > now()) return null;
      const token = crypto.randomUUID();
      held.set(key, { token, until: now() + ttl * 1000 });
      return token;
    },
    async release(key, token) {
      if (held.get(key)?.token === token) held.delete(key);
    },
  };
}

/** Fixed-window counters. */
export interface RateLimiter {
  /** Counts a hit; true if still within `limit` hits per `windowSeconds`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export type RedisCounter = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export function redisRateLimiter(redis: RedisCounter): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
      const k = `stoxhomes:rl:${key}:${windowSeconds}:${bucket}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSeconds + 1);
      return n <= limit;
    },
  };
}

export function memoryRateLimiter(now = () => Date.now()): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async hit(key, limit, windowSeconds) {
      const k = `${key}:${windowSeconds}:${Math.floor(now() / 1000 / windowSeconds)}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      if (counts.size > 50_000) counts.clear();
      return n <= limit;
    },
  };
}

/** What a room's stream carries. Commentary and trades are published only after the trade has executed. */
export type HouseEvent =
  | { type: "commentary"; id: number; kind: string; text: string; at: string; tradeId?: string | null }
  | { type: "trade"; tradeId: string; action: "open" | "close" | "liquidated"; market: string; side: string; leverage: number; at: string }
  | { type: "chat"; id: number; nickname: string; text: string; at: string }
  | { type: "chat_hidden"; id: number }
  | { type: "status"; status: string };

export interface Publisher {
  publish(slug: string, event: HouseEvent): Promise<void>;
  subscribe(slug: string, onEvent: (e: HouseEvent) => void): Promise<() => Promise<void>>;
}

export const channelFor = (slug: string) => `stoxhomes:house:${slug}`;

export function memoryPublisher(): Publisher {
  const subs = new Map<string, Set<(e: HouseEvent) => void>>();
  return {
    async publish(slug, e) {
      for (const fn of subs.get(slug) ?? []) fn(e);
    },
    async subscribe(slug, fn) {
      if (!subs.has(slug)) subs.set(slug, new Set());
      subs.get(slug)!.add(fn);
      return async () => {
        subs.get(slug)?.delete(fn);
      };
    },
  };
}

type UpstashLike = {
  publish(channel: string, message: string): Promise<number>;
  subscribe<T = unknown>(channels: string[]): {
    on(type: "message", listener: (e: { channel: string; message: T }) => void): void;
    unsubscribe(channels?: string[]): Promise<void>;
  };
};

export function redisPublisher(redis: UpstashLike): Publisher {
  return {
    async publish(slug, e) {
      await redis.publish(channelFor(slug), JSON.stringify(e));
    },
    async subscribe(slug, fn) {
      const sub = redis.subscribe<string | HouseEvent>([channelFor(slug)]);
      sub.on("message", ({ message }) => {
        try {
          fn(typeof message === "string" ? (JSON.parse(message) as HouseEvent) : message);
        } catch {
          // ignore malformed
        }
      });
      return () => sub.unsubscribe();
    },
  };
}
