import { AGENTS } from "@/config/openHouse";
import { DECIMALS, SIMULATED } from "@/config/stoxhomes";
import type { ClosedTrade, Position } from "@/lib/data/types";
import { pnlOf } from "@/lib/perp/math";
import { DAY, priceAt } from "@/lib/sim/feeds";
import { marketById } from "@/lib/sim/markets";
import { dayKeyOf, effectiveStreak, rollDay, shouldBoardUp } from "./boarding";
import type { Brain } from "./brain";
import { KNOWN_MARKETS, markAt, type SimAgentExchange } from "./exchange";
import type { HouseEvent, KeyedLock, Publisher } from "./infra";
import { moderateCommentary } from "./moderation";
import type { BrainContext } from "./prompt";
import { dailyLossLimitHit, effectiveLimits, evaluate, type OpenPlan } from "./risk";
import type { AgentStore } from "./store";
import type { Agent, AgentTrade, TickOutcome, TickRecord } from "./types";

export type TickDeps = {
  store: AgentStore;
  exchange: SimAgentExchange;
  brain: Brain;
  publisher: Publisher;
  lock: KeyedLock;
};

export type TickOptions = { dailyBudgetUsd: number; tickMinutes: number };

export type TickSummary = { agent: string; outcome: TickOutcome; notes: string[] };

const USDG = 10 ** DECIMALS.usdg;
const PX = 10 ** DECIMALS.price;
const usdg = (v: bigint) => Number(v) / USDG;
const px = (v: bigint) => Number(v) / PX;
const city = (id: string) => (KNOWN_MARKETS.includes(id) ? marketById(id).city : id);

function startOfUtcDay(t: number) {
  return new Date(Date.parse(`${dayKeyOf(t)}T00:00:00Z`));
}

async function publishLine(d: TickDeps, a: Agent, kind: Parameters<AgentStore["addCommentary"]>[0]["kind"], text: string, at: Date, tradeId?: string) {
  const line = await d.store.addCommentary({ agentId: a.id, agentSlug: a.slug, kind, text, tradeId: tradeId ?? null, createdAt: at });
  await d.publisher.publish(a.slug, { type: "commentary", id: line.id, kind, text, at: at.toISOString(), tradeId: line.tradeId });
  return line;
}

async function publishTrade(d: TickDeps, a: Agent, ev: Extract<HouseEvent, { type: "trade" }>) {
  await d.publisher.publish(a.slug, ev);
}

/** What the model is shown. Viewer chat is passed through as quoted, untrusted text. */
export async function buildContext(d: TickDeps, a: Agent, t: number, open: AgentTrade[], equity: bigint, mode: BrainContext["mode"]): Promise<BrainContext> {
  const lim = effectiveLimits(a.risk);
  const all = await d.store.listAgents();
  const names = new Map(all.map((x) => [x.id, x.name]));
  const own = await d.store.commentary(a.id, { limit: AGENTS.context.ownLines });
  const recent = await d.store.commentary(null, { limit: 40 });
  const chat = await d.store.chat(a.id, AGENTS.context.chatLines);
  return {
    mode,
    now: t,
    agent: { slug: a.slug, name: a.name, persona: a.persona, strategy: a.strategy, cities: a.cities, limits: lim },
    account: {
      cashUsdg: usdg(a.cash),
      equityUsdg: usdg(equity),
      dayStartEquityUsdg: usdg(a.dayStartEquity),
      lossLimitHit: dailyLossLimitHit(equity, a.dayStartEquity, lim.dailyLossLimitPct),
    },
    positions: open.map((p) => {
      const mark = markAt(p.marketId, t);
      return {
        market: p.marketId,
        side: p.side,
        leverage: p.leverage,
        collateralUsdg: usdg(p.collateral),
        entry: px(p.entryPrice),
        mark: px(mark),
        pnlUsdg: usdg(pnlOf(p.side, p.notional, p.entryPrice, mark)),
        liquidation: px(p.liquidationPrice),
      };
    }),
    prices: a.cities.map((m) => {
      const p = priceAt(m, t);
      return {
        market: m,
        city: city(m),
        price: p,
        change24hPct: (p / priceAt(m, t - DAY) - 1) * 100,
        change7dPct: (p / priceAt(m, t - AGENTS.context.priceDays * DAY) - 1) * 100,
      };
    }),
    ownLines: own.map((l) => l.text).reverse(),
    rivalLines: recent
      .filter((l) => l.agentId !== a.id && (l.kind === "trade" || l.kind === "hold"))
      .slice(0, AGENTS.context.rivalLines)
      .map((l) => ({ name: names.get(l.agentId) ?? "another agent", text: l.text })),
    chat: chat.reverse().map((c) => ({ nickname: c.nickname, text: c.text })),
  };
}

function fallbackLine(a: Agent, t: number) {
  const lines = a.thinkingLines.length ? a.thinkingLines : ["Thinking…"];
  return lines[Math.floor(t / 60_000) % lines.length];
}

function tradeLine(a: Agent, verb: string, p: { marketId: string; side: string; leverage: number }) {
  return `${a.name} ${verb} ${p.side} ${city(p.marketId)} ${p.leverage}x.`;
}

/** One tick for one agent. Never throws for model or exchange problems; those become the tick's outcome. */
export async function tickAgent(d: TickDeps, agentId: number, now: Date, opts: TickOptions): Promise<TickSummary> {
  const token = await d.lock.acquire(`agent:${agentId}`, AGENTS.lockTtlSeconds);
  if (!token) return { agent: String(agentId), outcome: "skipped", notes: ["locked"] };
  const notes: string[] = [];
  let a = (await d.store.getAgent(agentId))!;
  const t = now.getTime();
  const finish = async (outcome: TickOutcome, extra: Partial<TickRecord> = {}): Promise<TickSummary> => {
    const { equity } = await d.exchange.equity(a, t);
    await d.store.addTick({
      agentId: a.id,
      at: now,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      decision: null,
      outcome,
      notes,
      equity,
      ...extra,
    });
    return { agent: a.slug, outcome, notes };
  };

  try {
    if (a.status !== "active") return { agent: a.slug, outcome: "skipped", notes: [`status ${a.status}`] };

    // Liquidations happen to the agent, not by it; they're public as soon as they happen.
    for (const liq of await d.exchange.sweepLiquidations(a, t)) {
      notes.push(`liquidated ${liq.id}`);
      await publishTrade(d, a, { type: "trade", tradeId: liq.id, action: "liquidated", market: liq.marketId, side: liq.side, leverage: liq.leverage, at: now.toISOString() });
      await publishLine(d, a, "liquidation", `${a.name} was liquidated on ${city(liq.marketId)} (${liq.side} ${liq.leverage}x).`, now, liq.id);
    }
    a = (await d.store.getAgent(agentId))!;

    // New UTC day? Roll the loss-limit bookkeeping.
    const { equity, open } = await d.exchange.equity(a, t);
    const roll = rollDay(a, now, equity);
    if (roll.dayKey !== a.dayKey) {
      const patch = { dayKey: roll.dayKey, dayStartEquity: roll.dayStartEquity ?? a.dayStartEquity, lossLimitHitToday: roll.lossLimitHitToday, lossLimitStreak: roll.lossLimitStreak };
      await d.store.updateAgent(a.id, patch);
      a = { ...a, ...patch };
    }
    const lim = effectiveLimits(a.risk);
    if (!a.lossLimitHitToday && dailyLossLimitHit(equity, a.dayStartEquity, lim.dailyLossLimitPct)) {
      await d.store.updateAgent(a.id, { lossLimitHitToday: true });
      a = { ...a, lossLimitHitToday: true };
      notes.push("daily loss limit hit");
    }

    // Life and death.
    const why = shouldBoardUp(equity, a.startingBankroll, effectiveStreak(a));
    if (why) {
      const acct = d.exchange.accountFor(a, t, { reason: "boarded up", equityAtOpen: equity });
      for (const p of open) await acct.closePosition(p.id).catch(() => null);
      await d.store.updateAgent(a.id, { status: "boarded_up", boardedAt: now });
      a = { ...a, status: "boarded_up" };
      notes.push(`boarded up: ${why}`);
      await publishLine(d, a, "final", a.farewell, now);
      await d.publisher.publish(a.slug, { type: "status", status: "boarded_up" });
      return await finish("boarded");
    }

    const mode: BrainContext["mode"] = !a.lastBigAt || t - a.lastBigAt.getTime() >= AGENTS.bigDecisionMinutes * 60_000 ? "big" : "routine";
    await d.store.updateAgent(a.id, {
      lastTickAt: now,
      nextTickAt: new Date(t + opts.tickMinutes * 60_000),
      ...(mode === "big" ? { lastBigAt: now } : {}),
    });

    // Global daily budget.
    const spent = await d.store.spendSince(startOfUtcDay(t));
    if (spent >= opts.dailyBudgetUsd * 1_000_000) {
      notes.push("daily model budget reached");
      return await finish("budget");
    }

    const ctx = await buildContext(d, a, t, open, equity, mode);
    const res = await d.brain.decide(ctx);
    const usage = res.usage
      ? { model: res.usage.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costMicros: res.usage.costMicros }
      : {};

    if (!res.ok) {
      notes.push(`brain: ${res.error}`);
      await publishLine(d, a, "thinking", fallbackLine(a, t), now);
      return await finish("brain_error", usage);
    }

    const decision = res.decision;
    const risk = evaluate({
      status: a.status,
      cities: a.cities,
      risk: a.risk,
      decision,
      cash: a.cash,
      equity,
      dayStartEquity: a.dayStartEquity,
      openTrades: open,
      knownMarkets: KNOWN_MARKETS,
      minCollateral: BigInt(SIMULATED.minCollateralUsdg * USDG),
      openFeeBps: SIMULATED.openFeeBps,
    });
    notes.push(...risk.notes);
    const said = moderateCommentary(decision.commentary, AGENTS.commentaryMaxChars);
    if (!said && decision.commentary) notes.push("commentary failed moderation");

    if (risk.kind === "reject") {
      notes.push(...risk.reasons.map((r) => `rejected: ${r}`));
      return await finish("rejected", { ...usage, decision });
    }
    if (risk.kind === "hold") {
      if (said) await publishLine(d, a, "hold", said, now);
      return await finish("held", { ...usage, decision });
    }

    // Execute, then (and only then) publish.
    const acct = d.exchange.accountFor(a, t, { reason: decision.reason, equityAtOpen: equity });
    const closed: ClosedTrade[] = [];
    let opened: Position | null = null;
    try {
      if (risk.kind === "close" || risk.kind === "adjust") {
        for (const id of risk.tradeIds) closed.push(await acct.closePosition(id));
      }
      if (risk.kind === "open" || risk.kind === "adjust") {
        const plan: OpenPlan = risk.open;
        opened = await acct.openPosition({ marketId: plan.marketId, side: plan.side, collateral: plan.collateral, leverage: plan.leverage });
      }
    } catch (err) {
      notes.push(`execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!opened && closed.length === 0) return await finish("rejected", { ...usage, decision });

    for (const c of closed) {
      await publishTrade(d, a, { type: "trade", tradeId: c.id, action: "close", market: c.marketId, side: c.side, leverage: c.leverage, at: now.toISOString() });
    }
    if (opened) {
      await publishTrade(d, a, { type: "trade", tradeId: opened.id, action: "open", market: opened.marketId, side: opened.side, leverage: opened.leverage, at: now.toISOString() });
    }
    const subject = opened ?? closed[0];
    await publishLine(d, a, "trade", said ?? tradeLine(a, opened ? "opened" : "closed", subject), now, subject.id);
    return await finish("executed", { ...usage, decision });
  } catch (err) {
    notes.push(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    return await finish("brain_error").catch(() => ({ agent: a.slug, outcome: "brain_error" as const, notes }));
  } finally {
    await d.lock.release(`agent:${agentId}`, token);
  }
}

/** Called by the per-minute cron: ticks whichever agents are due, one at a time, oldest due first. */
export async function runDue(d: TickDeps, now: Date, opts: TickOptions & { limit: number }): Promise<TickSummary[]> {
  const due = await d.store.dueAgents(now, opts.limit);
  const out: TickSummary[] = [];
  for (const a of due) out.push(await tickAgent(d, a.id, now, opts));
  return out;
}
