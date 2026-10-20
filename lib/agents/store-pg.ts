import "server-only";
import postgres from "postgres";
import { db } from "@/lib/bot/store-pg";
import type { AgentStrategyKind } from "@/config/openHouse";
import { OPEN_HOUSE_SCHEMA_SQL } from "./schema";
import { agentFromSeed, staggerOffsetMs, type AgentStore } from "./store";
import type { Agent, AgentTrade, ChatMessage, Commentary, CommentaryKind } from "./types";

let migrated: Promise<unknown> | null = null;
async function ready(url: string) {
  const s = db(url);
  migrated ??= s.unsafe(OPEN_HOUSE_SCHEMA_SQL);
  await migrated;
  return s;
}

type Row = Record<string, unknown>;
const big = (v: unknown) => BigInt(String(v));
const optBig = (v: unknown) => (v == null ? undefined : BigInt(String(v)));
const date = (v: unknown) => (v == null ? null : new Date(v as string));

function toAgent(r: Row): Agent {
  return {
    id: Number(r.id),
    slug: r.slug as string,
    name: r.name as string,
    persona: r.persona as string,
    strategy: r.strategy as string,
    strategyKind: r.strategy_kind as AgentStrategyKind,
    cities: r.cities as string[],
    risk: {
      maxLeverage: Number(r.max_leverage),
      maxPositionPct: Number(r.max_position_pct),
      maxOpenPositions: Number(r.max_open_positions),
      dailyLossLimitPct: Number(r.daily_loss_limit_pct),
    },
    startingBankroll: big(r.starting_bankroll),
    cash: big(r.cash),
    status: r.status as Agent["status"],
    walletAddress: (r.wallet_address as string) ?? null,
    tokenAddress: (r.token_address as string) ?? null,
    visualSeed: r.visual_seed as string,
    followers: Number(r.followers),
    views: Number(r.views),
    dayStartEquity: big(r.day_start_equity),
    dayKey: r.day_key as string,
    lossLimitStreak: Number(r.loss_limit_streak),
    lossLimitHitToday: Boolean(r.loss_limit_hit_today),
    nextTickAt: new Date(r.next_tick_at as string),
    lastTickAt: date(r.last_tick_at),
    lastBigAt: date(r.last_big_at),
    boardedAt: date(r.boarded_at),
    thinkingLines: (r.thinking_lines as string[]) ?? [],
    farewell: (r.farewell as string) ?? "",
    createdAt: new Date(r.created_at as string),
  };
}

function toTrade(r: Row): AgentTrade {
  return {
    id: r.id as string,
    agentId: Number(r.agent_id),
    marketId: r.market as string,
    side: r.side as AgentTrade["side"],
    leverage: Number(r.leverage),
    collateral: big(r.collateral),
    notional: big(r.notional),
    entryPrice: big(r.entry_price),
    liquidationPrice: big(r.liquidation_price),
    openFee: big(r.open_fee),
    openedAt: new Date(r.opened_at as string).getTime(),
    status: r.status as AgentTrade["status"],
    equityAtOpen: big(r.equity_at_open),
    exitPrice: optBig(r.exit_price),
    closeFee: optBig(r.close_fee),
    realisedPnl: optBig(r.realised_pnl),
    closedAt: r.closed_at ? new Date(r.closed_at as string).getTime() : undefined,
    reason: (r.reason as string) ?? "",
    txHash: (r.tx_hash as string) ?? null,
  };
}

const toLine = (r: Row): Commentary => ({
  id: Number(r.id),
  agentId: Number(r.agent_id),
  agentSlug: r.agent_slug as string,
  kind: r.kind as CommentaryKind,
  text: r.text as string,
  tradeId: (r.trade_id as string) ?? null,
  createdAt: new Date(r.created_at as string),
});

const toChat = (r: Row): ChatMessage => ({
  id: Number(r.id),
  agentId: Number(r.agent_id),
  nickname: r.nickname as string,
  text: r.text as string,
  createdAt: new Date(r.created_at as string),
  hidden: Boolean(r.hidden),
  reports: Number(r.reports),
});

/** camelCase Agent fields → columns, for partial updates. */
const AGENT_COLUMNS: Partial<Record<keyof Agent, string>> = {
  cash: "cash",
  status: "status",
  walletAddress: "wallet_address",
  tokenAddress: "token_address",
  dayStartEquity: "day_start_equity",
  dayKey: "day_key",
  lossLimitStreak: "loss_limit_streak",
  lossLimitHitToday: "loss_limit_hit_today",
  nextTickAt: "next_tick_at",
  lastTickAt: "last_tick_at",
  lastBigAt: "last_big_at",
  boardedAt: "boarded_at",
  followers: "followers",
  views: "views",
};

export function pgAgentStore(url: string): AgentStore {
  return {
    async ensureSeeded(seeds, now, bankroll, tickMinutes) {
      const s = await ready(url);
      for (const [i, seed] of seeds.entries()) {
        const a = agentFromSeed(seed, 0, now, bankroll, staggerOffsetMs(i, seeds.length, tickMinutes));
        await s`
          insert into agents (slug, name, persona, strategy, strategy_kind, cities, max_leverage, max_position_pct,
            max_open_positions, daily_loss_limit_pct, starting_bankroll, cash, visual_seed, day_start_equity, day_key,
            next_tick_at, thinking_lines, farewell)
          values (${a.slug}, ${a.name}, ${a.persona}, ${a.strategy}, ${a.strategyKind}, ${a.cities}, ${a.risk.maxLeverage},
            ${a.risk.maxPositionPct}, ${a.risk.maxOpenPositions}, ${a.risk.dailyLossLimitPct}, ${a.startingBankroll.toString()},
            ${a.cash.toString()}, ${a.visualSeed}, ${a.dayStartEquity.toString()}, ${a.dayKey}, ${a.nextTickAt},
            ${a.thinkingLines}, ${a.farewell})
          on conflict (slug) do nothing`;
      }
    },
    async listAgents() {
      const s = await ready(url);
      return (await s`select * from agents order by id`).map(toAgent);
    },
    async getAgent(k) {
      const s = await ready(url);
      const rows = typeof k === "number" ? await s`select * from agents where id = ${k}` : await s`select * from agents where slug = ${k}`;
      return rows.length ? toAgent(rows[0]) : null;
    },
    async updateAgent(id, patch) {
      const s = await ready(url);
      const set: Row = {};
      for (const [k, v] of Object.entries(patch)) {
        const col = AGENT_COLUMNS[k as keyof Agent];
        if (col) set[col] = typeof v === "bigint" ? v.toString() : v;
      }
      if (Object.keys(set).length) await s`update agents set ${s(set)} where id = ${id}`;
    },
    async dueAgents(now, limit) {
      const s = await ready(url);
      return (await s`select * from agents where status = 'active' and next_tick_at <= ${now} order by next_tick_at limit ${limit}`).map(toAgent);
    },
    async trades(agentId, opts = {}) {
      const s = await ready(url);
      const rows = opts.status
        ? await s`select * from agent_trades where agent_id = ${agentId} and status = ${opts.status} order by opened_at desc limit ${opts.limit ?? 500}`
        : await s`select * from agent_trades where agent_id = ${agentId} order by opened_at desc limit ${opts.limit ?? 500}`;
      return rows.map(toTrade);
    },
    async insertTrade(t) {
      const s = await ready(url);
      await s`
        insert into agent_trades (id, agent_id, market, side, leverage, collateral, notional, entry_price, liquidation_price,
          open_fee, equity_at_open, status, reason, tx_hash, opened_at)
        values (${t.id}, ${t.agentId}, ${t.marketId}, ${t.side}, ${t.leverage}, ${t.collateral.toString()}, ${t.notional.toString()},
          ${t.entryPrice.toString()}, ${t.liquidationPrice.toString()}, ${t.openFee.toString()}, ${t.equityAtOpen.toString()},
          ${t.status}, ${t.reason}, ${t.txHash ?? null}, ${new Date(t.openedAt)})`;
    },
    async closeTrade(id, p) {
      const s = await ready(url);
      const rows = await s`
        update agent_trades set status = ${p.status}, exit_price = ${p.exitPrice!.toString()}, close_fee = ${p.closeFee!.toString()},
          realised_pnl = ${p.realisedPnl!.toString()}, closed_at = ${new Date(p.closedAt!)}
        where id = ${id} and status = 'open' returning id`;
      return rows.length === 1;
    },
    async addTick(t) {
      const s = await ready(url);
      const [r] = await s`
        insert into agent_ticks (agent_id, at, model, input_tokens, output_tokens, cost_micros, decision, outcome, notes, equity)
        values (${t.agentId}, ${t.at}, ${t.model}, ${t.inputTokens}, ${t.outputTokens}, ${t.costMicros},
          ${t.decision == null ? null : s.json(t.decision as postgres.JSONValue)}, ${t.outcome}, ${s.json(t.notes)}, ${t.equity.toString()})
        returning id`;
      return Number(r.id);
    },
    async equitySeries(agentId, since) {
      const s = await ready(url);
      const rows = await s`select at, equity from agent_ticks where agent_id = ${agentId} and at >= ${since} order by at`;
      return rows.map((r) => ({ t: new Date(r.at as string).getTime(), equity: big(r.equity) }));
    },
    async spendSince(since) {
      const s = await ready(url);
      const [r] = await s`select coalesce(sum(cost_micros), 0)::bigint as spent from agent_ticks where at >= ${since}`;
      return Number(r.spent);
    },
    async addCommentary(c) {
      const s = await ready(url);
      const [r] = await s`
        insert into agent_commentary (agent_id, agent_slug, kind, text, trade_id, created_at)
        values (${c.agentId}, ${c.agentSlug}, ${c.kind}, ${c.text}, ${c.tradeId ?? null}, ${c.createdAt ?? new Date()})
        returning *`;
      return toLine(r);
    },
    async commentary(agentId, { limit, afterId }) {
      const s = await ready(url);
      const rows =
        agentId == null
          ? await s`select * from agent_commentary where id > ${afterId ?? 0} order by id desc limit ${limit}`
          : await s`select * from agent_commentary where agent_id = ${agentId} and id > ${afterId ?? 0} order by id desc limit ${limit}`;
      return rows.map(toLine);
    },
    async addChat(m) {
      const s = await ready(url);
      const [r] = await s`
        insert into chat_messages (agent_id, nickname, text, ip_hash) values (${m.agentId}, ${m.nickname}, ${m.text}, ${m.ipHash})
        returning id, agent_id, nickname, text, created_at, hidden, reports`;
      return toChat(r);
    },
    async chat(agentId, limit) {
      const s = await ready(url);
      const rows = await s`
        select id, agent_id, nickname, text, created_at, hidden, reports from chat_messages
        where agent_id = ${agentId} and not hidden order by id desc limit ${limit}`;
      return rows.map(toChat);
    },
    async reportChat(id, hideAfter) {
      const s = await ready(url);
      const rows = await s`
        update chat_messages set reports = reports + 1, hidden = hidden or (reports + 1 >= ${hideAfter})
        where id = ${id} returning id, agent_id, nickname, text, created_at, hidden, reports`;
      return rows.length ? toChat(rows[0]) : null;
    },
    async toggleFollow(agentId, key) {
      const s = await ready(url);
      return s.begin(async (tx) => {
        const del = await tx`delete from agent_follows where agent_id = ${agentId} and follower_key = ${key} returning agent_id`;
        if (del.length) {
          const [r] = await tx`update agents set followers = greatest(0, followers - 1) where id = ${agentId} returning followers`;
          return { following: false, followers: Number(r.followers) };
        }
        await tx`insert into agent_follows (agent_id, follower_key) values (${agentId}, ${key})`;
        const [r] = await tx`update agents set followers = followers + 1 where id = ${agentId} returning followers`;
        return { following: true, followers: Number(r.followers) };
      });
    },
    async isFollowing(agentId, key) {
      const s = await ready(url);
      return (await s`select 1 from agent_follows where agent_id = ${agentId} and follower_key = ${key}`).length > 0;
    },
    async bumpViews(agentId) {
      const s = await ready(url);
      await s`update agents set views = views + 1 where id = ${agentId}`;
    },
    async feeTotals() {
      const s = await ready(url);
      const [r] = await s`select coalesce(sum(open_fee + coalesce(close_fee, 0)), 0)::text as fees from agent_trades`;
      return BigInt(r.fees as string);
    },
  };
}
