import { describe, expect, it } from "vitest";
import { AGENTS, RISK, SEED_AGENTS } from "@/config/openHouse";
import { SIMULATED } from "@/config/stoxhomes";
import type { OpenPositionRequest } from "@/lib/data/types";
import { mockBrain } from "./brain-mock";
import { SimAgentExchange } from "./exchange";
import { memoryKeyedLock, memoryPublisher, type HouseEvent } from "./infra";
import { dailyLossLimitHit, effectiveLimits } from "./risk";
import { memoryAgentStore } from "./store";
import { runDue, type TickDeps } from "./tick";
import type { Agent } from "./types";

const U = 1_000_000n;
const START = Date.UTC(2026, 6, 6); // a Monday
const DAYS = 7;

/** Wraps the exchange so every open is checked against the agent's limits at the moment it happens. */
class CheckedExchange extends SimAgentExchange {
  violations: string[] = [];
  opens = 0;
  override accountFor(agent: Agent, now: number, meta: { reason: string; equityAtOpen: bigint }) {
    const inner = super.accountFor(agent, now, meta);
    return {
      closePosition: inner.closePosition,
      openPosition: async (req: OpenPositionRequest) => {
        const lim = effectiveLimits(agent.risk);
        const fresh = (await this.storeRef.getAgent(agent.id))!;
        const { equity, open } = await this.equity(fresh, now);
        const tag = `${agent.slug}@${new Date(now).toISOString()}`;
        if (fresh.status !== "active") this.violations.push(`${tag} opened while ${fresh.status}`);
        if (req.leverage > lim.maxLeverage || req.leverage > RISK.leverageCeiling) this.violations.push(`${tag} leverage ${req.leverage}`);
        if (!agent.cities.includes(req.marketId)) this.violations.push(`${tag} market ${req.marketId}`);
        if (req.collateral * 100n > meta.equityAtOpen * BigInt(lim.maxPositionPct)) this.violations.push(`${tag} size ${req.collateral}`);
        if (req.collateral < BigInt(SIMULATED.minCollateralUsdg) * U) this.violations.push(`${tag} dust ${req.collateral}`);
        if (open.length >= lim.maxOpenPositions) this.violations.push(`${tag} ${open.length + 1} positions`);
        if (dailyLossLimitHit(equity, fresh.dayStartEquity, lim.dailyLossLimitPct)) this.violations.push(`${tag} opened past the daily loss limit`);
        this.opens++;
        return inner.openPosition(req);
      },
    };
  }
  constructor(public storeRef: ReturnType<typeof memoryAgentStore>) {
    super(storeRef);
  }
}

describe("7 simulated days, 6 agents", () => {
  it("never breaches a risk limit, and exchange fees match the trades", { timeout: 120_000 }, async () => {
    const store = memoryAgentStore();
    const exchange = new CheckedExchange(store);
    const publisher = memoryPublisher();
    const events: { slug: string; e: HouseEvent }[] = [];
    for (const s of SEED_AGENTS) await publisher.subscribe(s.slug, (e) => events.push({ slug: s.slug, e }));

    const deps: TickDeps = { store, exchange, brain: mockBrain({ misbehaveRate: 0.2, failRate: 0.05 }), publisher, lock: memoryKeyedLock(() => 0) };
    await store.ensureSeeded(SEED_AGENTS, new Date(START), BigInt(AGENTS.startingBankrollUsdg) * U, AGENTS.tickMinutes);

    const outcomes = new Map<string, number>();
    for (let t = START; t < START + DAYS * 86_400_000; t += 60_000) {
      for (const s of await runDue(deps, new Date(t), { dailyBudgetUsd: 20, tickMinutes: AGENTS.tickMinutes, limit: 6 })) {
        outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
      }
      if (t % 3_600_000 === 0) {
        for (const a of await store.listAgents()) expect(a.cash >= 0n, `${a.slug} cash went negative`).toBe(true);
      }
    }

    if (process.env.SIM_VERBOSE) {
      const agents = await store.listAgents();
      console.info({ outcomes: Object.fromEntries(outcomes), opens: exchange.opens, fees: exchange.feesCharged, boarded: agents.filter((a) => a.status === "boarded_up").map((a) => a.slug) });
    }
    // 6 agents × 288 ticks/day × 7 days, minus any boarded-up time.
    const total = [...outcomes.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(6 * 288 * DAYS * 0.9);
    expect(exchange.opens).toBeGreaterThan(100);
    expect(outcomes.get("rejected") ?? 0).toBeGreaterThan(0); // the misbehaving brain was caught
    expect(exchange.violations).toEqual([]);

    // Exchange fee ledger = sum of fees on every trade row, to the unit.
    expect(exchange.feesCharged).toBe(await store.feeTotals());
    expect(exchange.feesCharged > 0n).toBe(true);

    // Every trade a stream talked about actually exists, and was published after it executed.
    const allTrades = new Map<string, number>();
    for (const a of await store.listAgents()) for (const t of await store.trades(a.id)) allTrades.set(t.id, t.openedAt);
    for (const { e } of events) {
      if (e.type === "trade") expect(allTrades.has(e.tradeId)).toBe(true);
      if (e.type === "commentary" && e.kind === "trade") {
        expect(e.tradeId && allTrades.has(e.tradeId)).toBeTruthy();
        expect(Date.parse(e.at)).toBeGreaterThanOrEqual(allTrades.get(e.tradeId!)!);
      }
    }

    // Boarded-up agents stop trading for good.
    for (const a of await store.listAgents()) {
      if (a.status !== "boarded_up") continue;
      const after = (await store.trades(a.id)).filter((t) => t.openedAt > a.boardedAt!.getTime());
      expect(after).toEqual([]);
      expect((await store.trades(a.id, { status: "open" })).length).toBe(0);
    }
  });
});
