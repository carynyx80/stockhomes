import { pnlOf } from "@/lib/perp/math";
import { markAt } from "./exchange";
import type { OpenHouse } from "./runtime";
import type { Agent, ChatMessage, Commentary } from "./types";

/** Public, JSON-safe shapes for the Corridor and rooms. Amounts are fixed-point strings (USDG 6dp, price 8dp). */

export type AgentCard = {
  slug: string;
  name: string;
  status: Agent["status"];
  cities: string[];
  strategy: string;
  visualSeed: string;
  live: boolean;
  openPositions: number;
  equity: string;
  pnlToday: string;
  pnlTodayBps: number;
  followers: number;
  views: number;
  boardedAt: string | null;
};

export type PublicLine = { id: number; kind: string; text: string; at: string; tradeId: string | null };
export type PublicChat = { id: number; nickname: string; text: string; at: string };

export type AgentDetail = AgentCard & {
  persona: string;
  risk: Agent["risk"];
  cash: string;
  startingBankroll: string;
  positions: {
    id: string;
    market: string;
    side: string;
    leverage: number;
    collateral: string;
    notional: string;
    entryPrice: string;
    markPrice: string;
    liquidationPrice: string;
    pnl: string;
    openedAt: number;
  }[];
  trades: {
    id: string;
    market: string;
    side: string;
    leverage: number;
    collateral: string;
    entryPrice: string;
    exitPrice: string | null;
    realisedPnl: string | null;
    status: string;
    reason: string;
    openedAt: number;
    closedAt: number | null;
    txHash: string | null;
  }[];
  equitySeries: { t: number; equity: string }[];
  commentary: PublicLine[];
  chat: PublicChat[];
  following: boolean;
  feesPaid: string;
};

export const publicLine = (l: Commentary): PublicLine => ({ id: l.id, kind: l.kind, text: l.text, at: l.createdAt.toISOString(), tradeId: l.tradeId ?? null });
export const publicChat = (c: ChatMessage): PublicChat => ({ id: c.id, nickname: c.nickname, text: c.text, at: c.createdAt.toISOString() });

const LIVE_WINDOW_MS = 15 * 60_000;

export async function agentCard(oh: OpenHouse, a: Agent, now: number): Promise<AgentCard> {
  const { equity, open } = await oh.exchange.equity(a, now);
  const today = new Date(now).toISOString().slice(0, 10);
  const base = a.dayKey === today ? a.dayStartEquity : equity;
  const pnl = equity - base;
  return {
    slug: a.slug,
    name: a.name,
    status: a.status,
    cities: a.cities,
    strategy: a.strategy,
    visualSeed: a.visualSeed,
    live: a.status === "active" && !!a.lastTickAt && now - a.lastTickAt.getTime() < LIVE_WINDOW_MS,
    openPositions: open.length,
    equity: equity.toString(),
    pnlToday: pnl.toString(),
    pnlTodayBps: base > 0n ? Number((pnl * 10_000n) / base) : 0,
    followers: a.followers,
    views: a.views,
    boardedAt: a.boardedAt?.toISOString() ?? null,
  };
}

export async function agentDetail(oh: OpenHouse, a: Agent, now: number, followerKey: string | null): Promise<AgentDetail> {
  const card = await agentCard(oh, a, now);
  const open = await oh.store.trades(a.id, { status: "open" });
  const trades = await oh.store.trades(a.id, { limit: 50 });
  const series = await oh.store.equitySeries(a.id, new Date(now - 7 * 86_400_000));
  const lines = await oh.store.commentary(a.id, { limit: 30 });
  const chat = await oh.store.chat(a.id, 50);
  const fees = trades.reduce((s, t) => s + t.openFee + (t.closeFee ?? 0n), 0n);
  // Thin the equity series to at most ~300 points for the chart.
  const every = Math.max(1, Math.ceil(series.length / 300));
  return {
    ...card,
    persona: a.persona,
    risk: a.risk,
    cash: a.cash.toString(),
    startingBankroll: a.startingBankroll.toString(),
    positions: open.map((p) => {
      const mark = markAt(p.marketId, now);
      return {
        id: p.id,
        market: p.marketId,
        side: p.side,
        leverage: p.leverage,
        collateral: p.collateral.toString(),
        notional: p.notional.toString(),
        entryPrice: p.entryPrice.toString(),
        markPrice: mark.toString(),
        liquidationPrice: p.liquidationPrice.toString(),
        pnl: pnlOf(p.side, p.notional, p.entryPrice, mark).toString(),
        openedAt: p.openedAt,
      };
    }),
    trades: trades.map((t) => ({
      id: t.id,
      market: t.marketId,
      side: t.side,
      leverage: t.leverage,
      collateral: t.collateral.toString(),
      entryPrice: t.entryPrice.toString(),
      exitPrice: t.exitPrice?.toString() ?? null,
      realisedPnl: t.realisedPnl?.toString() ?? null,
      status: t.status,
      reason: t.reason,
      openedAt: t.openedAt,
      closedAt: t.closedAt ?? null,
      txHash: t.txHash ?? null,
    })),
    equitySeries: series.filter((_, i) => i % every === 0 || i === series.length - 1).map((p) => ({ t: p.t, equity: p.equity.toString() })),
    commentary: lines.map(publicLine),
    chat: chat.map(publicChat),
    following: followerKey ? await oh.store.isFollowing(a.id, followerKey) : false,
    feesPaid: fees.toString(),
  };
}
