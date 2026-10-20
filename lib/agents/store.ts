import type { AgentSeed } from "@/config/openHouse";
import type { Agent, AgentTrade, ChatMessage, Commentary, CommentaryKind, TickRecord } from "./types";

/** Persistence for the Open House. Postgres in production (store-pg.ts), memory in tests and key-less dev. */
export interface AgentStore {
  ensureSeeded(seeds: AgentSeed[], now: Date, startingBankroll: bigint, tickMinutes: number): Promise<void>;
  listAgents(): Promise<Agent[]>;
  getAgent(slugOrId: string | number): Promise<Agent | null>;
  updateAgent(id: number, patch: Partial<Agent>): Promise<void>;
  dueAgents(now: Date, limit: number): Promise<Agent[]>;

  trades(agentId: number, opts?: { status?: AgentTrade["status"]; limit?: number }): Promise<AgentTrade[]>;
  insertTrade(t: AgentTrade): Promise<void>;
  /** Compare-and-set on status = open, so a trade can only be closed once. */
  closeTrade(
    id: string,
    patch: Pick<AgentTrade, "status" | "exitPrice" | "closeFee" | "realisedPnl" | "closedAt">,
  ): Promise<boolean>;

  addTick(t: TickRecord): Promise<number>;
  equitySeries(agentId: number, since: Date): Promise<{ t: number; equity: bigint }[]>;
  /** Model spend (micro-USD) since a time, across all agents. */
  spendSince(since: Date): Promise<number>;

  addCommentary(c: { agentId: number; agentSlug: string; kind: CommentaryKind; text: string; tradeId?: string | null; createdAt?: Date }): Promise<Commentary>;
  /** Newest first. `afterId` returns only lines newer than it. `agentId` null = every agent. */
  commentary(agentId: number | null, opts: { limit: number; afterId?: number }): Promise<Commentary[]>;

  addChat(m: { agentId: number; nickname: string; text: string; ipHash: string }): Promise<ChatMessage>;
  chat(agentId: number, limit: number): Promise<ChatMessage[]>;
  reportChat(id: number, hideAfter: number): Promise<ChatMessage | null>;

  toggleFollow(agentId: number, followerKey: string): Promise<{ following: boolean; followers: number }>;
  isFollowing(agentId: number, followerKey: string): Promise<boolean>;
  bumpViews(agentId: number): Promise<void>;

  /** Sum of open + close fees over every agent trade (paper fees in Simulated mode). */
  feeTotals(): Promise<bigint>;
}

export function agentFromSeed(seed: AgentSeed, id: number, now: Date, bankroll: bigint, offsetMs: number): Agent {
  return {
    id,
    slug: seed.slug,
    name: seed.name,
    persona: seed.persona,
    strategy: seed.strategy,
    strategyKind: seed.strategyKind,
    cities: seed.cities,
    risk: {
      maxLeverage: seed.maxLeverage,
      maxPositionPct: seed.maxPositionPct ?? 20,
      maxOpenPositions: seed.maxOpenPositions ?? 3,
      dailyLossLimitPct: seed.dailyLossLimitPct ?? 15,
    },
    startingBankroll: bankroll,
    cash: bankroll,
    status: "active",
    walletAddress: null,
    tokenAddress: null,
    visualSeed: seed.visualSeed,
    followers: 0,
    views: 0,
    dayStartEquity: bankroll,
    dayKey: now.toISOString().slice(0, 10),
    lossLimitStreak: 0,
    lossLimitHitToday: false,
    // Staggered so agents don't all call the model in the same minute.
    nextTickAt: new Date(now.getTime() + offsetMs),
    lastTickAt: null,
    lastBigAt: null,
    boardedAt: null,
    thinkingLines: seed.thinkingLines,
    farewell: seed.farewell,
    createdAt: now,
  };
}

/** Spread agents evenly across one tick interval. */
export const staggerOffsetMs = (index: number, count: number, tickMinutes: number) =>
  Math.floor((index * tickMinutes * 60_000) / Math.max(1, count));

export function memoryAgentStore(): AgentStore {
  const agents: Agent[] = [];
  const trades: AgentTrade[] = [];
  const ticks: (TickRecord & { id: number })[] = [];
  const lines: Commentary[] = [];
  const chats: (ChatMessage & { ipHash: string })[] = [];
  const follows = new Set<string>();
  let lineId = 1;
  let chatId = 1;
  let tickId = 1;

  const find = (slugOrId: string | number) =>
    agents.find((a) => (typeof slugOrId === "number" ? a.id === slugOrId : a.slug === slugOrId)) ?? null;

  return {
    async ensureSeeded(seeds, now, bankroll, tickMinutes) {
      seeds.forEach((s, i) => {
        if (!agents.some((a) => a.slug === s.slug)) {
          agents.push(agentFromSeed(s, agents.length + 1, now, bankroll, staggerOffsetMs(i, seeds.length, tickMinutes)));
        }
      });
    },
    async listAgents() {
      return agents.map((a) => ({ ...a }));
    },
    async getAgent(k) {
      const a = find(k);
      return a ? { ...a } : null;
    },
    async updateAgent(id, patch) {
      const a = find(id);
      if (a) Object.assign(a, patch);
    },
    async dueAgents(now, limit) {
      return agents
        .filter((a) => a.status === "active" && a.nextTickAt <= now)
        .sort((x, y) => x.nextTickAt.getTime() - y.nextTickAt.getTime())
        .slice(0, limit)
        .map((a) => ({ ...a }));
    },
    async trades(agentId, opts = {}) {
      return trades
        .filter((t) => t.agentId === agentId && (!opts.status || t.status === opts.status))
        .sort((a, b) => b.openedAt - a.openedAt)
        .slice(0, opts.limit ?? Infinity)
        .map((t) => ({ ...t }));
    },
    async insertTrade(t) {
      trades.push({ ...t });
    },
    async closeTrade(id, patch) {
      const t = trades.find((x) => x.id === id);
      if (!t || t.status !== "open") return false;
      Object.assign(t, patch);
      return true;
    },
    async addTick(t) {
      ticks.push({ ...t, id: tickId });
      return tickId++;
    },
    async equitySeries(agentId, since) {
      return ticks.filter((t) => t.agentId === agentId && t.at >= since).map((t) => ({ t: t.at.getTime(), equity: t.equity }));
    },
    async spendSince(since) {
      return ticks.filter((t) => t.at >= since).reduce((s, t) => s + t.costMicros, 0);
    },
    async addCommentary(c) {
      const row: Commentary = { id: lineId++, tradeId: null, ...c, createdAt: c.createdAt ?? new Date() };
      lines.push(row);
      return { ...row };
    },
    async commentary(agentId, { limit, afterId }) {
      // Lines are appended in id order, so walk back from the newest.
      const out: Commentary[] = [];
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        const l = lines[i];
        if (afterId != null && l.id <= afterId) break;
        if (agentId == null || l.agentId === agentId) out.push({ ...l });
      }
      return out;
    },
    async addChat(m) {
      const row = { id: chatId++, agentId: m.agentId, nickname: m.nickname, text: m.text, createdAt: new Date(), hidden: false, reports: 0, ipHash: m.ipHash };
      chats.push(row);
      const { ipHash: _ignored, ...pub } = row;
      void _ignored;
      return pub;
    },
    async chat(agentId, limit) {
      return chats
        .filter((c) => c.agentId === agentId && !c.hidden)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map(({ ipHash: _i, ...c }) => (void _i, c));
    },
    async reportChat(id, hideAfter) {
      const c = chats.find((x) => x.id === id);
      if (!c) return null;
      c.reports += 1;
      if (c.reports >= hideAfter) c.hidden = true;
      const { ipHash: _i, ...pub } = c;
      void _i;
      return pub;
    },
    async toggleFollow(agentId, key) {
      const k = `${agentId}:${key}`;
      const a = find(agentId)!;
      if (follows.has(k)) {
        follows.delete(k);
        a.followers = Math.max(0, a.followers - 1);
        return { following: false, followers: a.followers };
      }
      follows.add(k);
      a.followers += 1;
      return { following: true, followers: a.followers };
    },
    async isFollowing(agentId, key) {
      return follows.has(`${agentId}:${key}`);
    },
    async bumpViews(agentId) {
      const a = find(agentId);
      if (a) a.views += 1;
    },
    async feeTotals() {
      return trades.reduce((s, t) => s + t.openFee + (t.closeFee ?? 0n), 0n);
    },
  };
}
