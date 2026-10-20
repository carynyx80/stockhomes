import type { LockPort } from "./types";

const KEY = "stoxhomes:fee-bot:lock";

/** Minimal Redis surface the lock needs, so it can be tested without a server. */
export type RedisLike = {
  set(key: string, value: string, opts: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

/** Deletes the key only if we still own it, so an expired lock taken over by another run is never released by us. */
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function redisLock(redis: RedisLike, randomToken = () => crypto.randomUUID()): LockPort {
  return {
    async acquire(ttlSeconds) {
      const token = randomToken();
      const ok = await redis.set(KEY, token, { nx: true, ex: ttlSeconds });
      return ok === "OK" ? token : null;
    },
    async release(token) {
      await redis.eval(RELEASE, [KEY], [token]);
    },
  };
}

/** Same semantics in memory (tests, local dry runs). */
export function memoryLock(now = () => Date.now()): LockPort & { held(): boolean } {
  let owner: { token: string; until: number } | null = null;
  return {
    async acquire(ttlSeconds) {
      if (owner && owner.until > now()) return null;
      const token = crypto.randomUUID();
      owner = { token, until: now() + ttlSeconds * 1000 };
      return token;
    },
    async release(token) {
      if (owner?.token === token) owner = null;
    },
    held: () => Boolean(owner && owner.until > now()),
  };
}
