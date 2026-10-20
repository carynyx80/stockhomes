import type { Position } from "@/lib/data/types";
import type { Side } from "@/lib/perp/math";
import type { AgentStrategyKind } from "@/config/openHouse";

export type AgentStatus = "active" | "paused" | "boarded_up";

export type AgentRisk = {
  maxLeverage: number;
  maxPositionPct: number;
  maxOpenPositions: number;
  dailyLossLimitPct: number;
};

export type Agent = {
  id: number;
  slug: string;
  name: string;
  persona: string;
  strategy: string;
  strategyKind: AgentStrategyKind;
  cities: string[];
  risk: AgentRisk;
  startingBankroll: bigint;
  /** Free USDG not locked as collateral. */
  cash: bigint;
  status: AgentStatus;
  walletAddress: string | null;
  tokenAddress: string | null;
  visualSeed: string;
  followers: number;
  views: number;
  /** Equity at the start of the current UTC day, for the daily loss limit. */
  dayStartEquity: bigint;
  dayKey: string;
  lossLimitStreak: number;
  /** Set when the loss limit was hit today (counts toward the streak). */
  lossLimitHitToday: boolean;
  nextTickAt: Date;
  lastTickAt: Date | null;
  lastBigAt: Date | null;
  boardedAt: Date | null;
  thinkingLines: string[];
  farewell: string;
  createdAt: Date;
};

/** An agent's position on the exchange, plus the context the risk engine needs. */
export type AgentTrade = Position & {
  agentId: number;
  status: "open" | "closed" | "liquidated";
  equityAtOpen: bigint;
  exitPrice?: bigint;
  closeFee?: bigint;
  realisedPnl?: bigint;
  closedAt?: number;
  reason: string;
  txHash?: string | null;
};

export type CommentaryKind = "trade" | "hold" | "thinking" | "liquidation" | "system" | "final" | "chat_reply";

export type Commentary = {
  id: number;
  agentId: number;
  agentSlug: string;
  kind: CommentaryKind;
  text: string;
  tradeId?: string | null;
  createdAt: Date;
};

export type ChatMessage = {
  id: number;
  agentId: number;
  nickname: string;
  text: string;
  createdAt: Date;
  hidden: boolean;
  reports: number;
};

export type TickOutcome = "executed" | "rejected" | "held" | "brain_error" | "budget" | "boarded" | "skipped";

export type TickRecord = {
  agentId: number;
  at: Date;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  decision: unknown;
  outcome: TickOutcome;
  notes: string[];
  equity: bigint;
};

export type { Side };
