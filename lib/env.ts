import "server-only";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import { BOT } from "@/config/stoxhomes";

/**
 * Server-side environment. Importing this from client code fails the build (server-only).
 * The private key is read lazily by `creatorKey()` and never stored on a returned object, logged or serialised.
 */

export type Network = "mainnet" | "testnet";

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = str(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export function network(): Network {
  const n = (str("NETWORK") ?? "testnet").toLowerCase();
  if (n !== "mainnet" && n !== "testnet") throw new Error("NETWORK must be 'mainnet' or 'testnet'");
  return n;
}

export function rpcUrl(): string | undefined {
  return network() === "mainnet" ? str("RPC_URL_MAINNET") : str("RPC_URL_TESTNET");
}

export function tokenAddress(): Address | null {
  const v = str("TOKEN_ADDRESS");
  if (!v) return null;
  if (!isAddress(v)) throw new Error("TOKEN_ADDRESS is not a valid address");
  return v;
}

export function botSettings() {
  const thresholdUsd = int("CLAIM_THRESHOLD_USD", BOT.claimThresholdUsd);
  const burnShareBps = int("BURN_SHARE_BPS", BOT.burnShareBps);
  const maxSlippageBps = int("MAX_SLIPPAGE_BPS", BOT.maxSlippageBps);
  if (burnShareBps > 10_000) throw new Error("BURN_SHARE_BPS cannot exceed 10000");
  if (maxSlippageBps > 5_000) throw new Error("MAX_SLIPPAGE_BPS above 5000 (50%) is refused");
  return {
    dryRun: bool("DRY_RUN", true), // safe default: never send unless explicitly told to
    thresholdUsd,
    burnShareBps,
    maxSlippageBps,
    maxGasShareBps: BOT.maxGasShareBps,
    minGasWei: parseEther(str("MIN_GAS_ETH") ?? BOT.minGasEth),
    startBlock: str("BOT_START_BLOCK") ? BigInt(str("BOT_START_BLOCK")!) : null,
  };
}

/** The signing key. Only lib/bot/live.ts calls this. */
export function creatorKey(): Hex | null {
  const v = str("CREATOR_PRIVATE_KEY");
  if (!v) return null;
  const hex = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("CREATOR_PRIVATE_KEY is malformed");
  return hex;
}

/** Payout wallet address, for key-less dry runs. */
export function payoutWalletAddress(): Address | null {
  const v = str("PAYOUT_WALLET_ADDRESS");
  if (!v) return null;
  if (!isAddress(v)) throw new Error("PAYOUT_WALLET_ADDRESS is not a valid address");
  return v;
}

/** The Infinite Open House. Phase C (tokens, live wallets) is off unless OPEN_HOUSE_TOKENS=true. */
export function openHouseSettings() {
  return {
    tickMinutes: Math.max(1, int("AGENT_TICK_MINUTES", 5)),
    dailyBudgetUsd: Number(str("AGENT_DAILY_BUDGET_USD") ?? "20"),
    tokensEnabled: bool("OPEN_HOUSE_TOKENS", false),
    roomStakeStoxh: int("ROOM_STAKE_STOXH", 10_000),
    /** "anthropic" when ANTHROPIC_API_KEY is set, unless AGENT_BRAIN=mock forces the deterministic stand-in. */
    brain: str("AGENT_BRAIN") === "mock" || !str("ANTHROPIC_API_KEY") ? ("mock" as const) : ("anthropic" as const),
    chatSalt: str("CHAT_SALT") ?? str("CRON_SECRET") ?? "stoxhomes-dev-salt",
  };
}

export const cronSecret = () => str("CRON_SECRET");
export const databaseUrl = () => str("DATABASE_URL");
export const redisConfig = () => {
  const url = str("KV_REST_API_URL") ?? str("UPSTASH_REDIS_REST_URL");
  const token = str("KV_REST_API_TOKEN") ?? str("UPSTASH_REDIS_REST_TOKEN");
  return url && token ? { url, token } : null;
};
export const telegramConfig = () => {
  const token = str("TELEGRAM_BOT_TOKEN");
  const chatId = str("TELEGRAM_CHAT_ID");
  return token && chatId ? { token, chatId } : null;
};
