import { DECIMALS, SIMULATED } from "@/config/stoxhomes";
import type { ClosedTrade, OpenPositionRequest, Position, TradingAccount } from "@/lib/data/types";
import { feeOf, isLiquidatable, liquidationPrice, notionalOf, pnlOf } from "@/lib/perp/math";
import { priceAt } from "@/lib/sim/feeds";
import { MARKETS } from "@/lib/sim/markets";
import type { AgentStore } from "./store";
import type { Agent, AgentTrade } from "./types";

/**
 * Simulated exchange for agents: the same seeded feeds, fee schedule and perp maths as the Trading Floor,
 * with balances in Postgres instead of a browser. Every fee charged is also counted in `feesCharged`, so
 * tests can check the ledger against the trade rows.
 *
 * When the real contracts are live, a live TradingAccount per agent wallet replaces `accountFor`; agent code
 * only ever sees TradingAccount.
 */

const PRICE_ONE = 10n ** BigInt(DECIMALS.price);
export const toPrice = (n: number) => BigInt(Math.round(n * Number(PRICE_ONE)));
export const markAt = (marketId: string, t: number) => toPrice(priceAt(marketId, t));
export const KNOWN_MARKETS = MARKETS.map((m) => m.id);

let seq = 0;
const tradeId = (agentId: number, t: number) => `agt${agentId}_${t.toString(36)}_${(seq++).toString(36)}`;

export class SimAgentExchange {
  feesCharged = 0n;

  constructor(private store: AgentStore) {}

  /** A TradingAccount bound to one agent at one moment (`now` lets simulations run faster than real time). */
  accountFor(agent: Agent, now: number, meta: { reason: string; equityAtOpen: bigint }): TradingAccount {
    return {
      openPosition: (req) => this.open(agent, req, now, meta),
      closePosition: (id) => this.close(agent, id, now, "closed"),
    };
  }

  private async open(agent: Agent, req: OpenPositionRequest, now: number, meta: { reason: string; equityAtOpen: bigint }): Promise<Position> {
    if (req.marketId !== req.marketId.toLowerCase() || !KNOWN_MARKETS.includes(req.marketId)) throw new Error("unknown market");
    const fresh = (await this.store.getAgent(agent.id))!;
    const notional = notionalOf(req.collateral, req.leverage);
    const openFee = feeOf(notional, SIMULATED.openFeeBps);
    if (req.collateral + openFee > fresh.cash) throw new Error("insufficient margin");
    const entryPrice = markAt(req.marketId, now);
    const trade: AgentTrade = {
      id: tradeId(agent.id, now),
      agentId: agent.id,
      marketId: req.marketId,
      side: req.side,
      leverage: req.leverage,
      collateral: req.collateral,
      notional,
      entryPrice,
      liquidationPrice: liquidationPrice(req.side, entryPrice, req.collateral, notional, SIMULATED.maintenanceMarginBps),
      openFee,
      openedAt: now,
      status: "open",
      equityAtOpen: meta.equityAtOpen,
      reason: meta.reason.slice(0, 500),
    };
    await this.store.updateAgent(agent.id, { cash: fresh.cash - req.collateral - openFee });
    await this.store.insertTrade(trade);
    this.feesCharged += openFee;
    return trade;
  }

  private async close(agent: Agent, id: string, now: number, how: "closed" | "liquidated"): Promise<ClosedTrade> {
    const open = (await this.store.trades(agent.id, { status: "open" })).find((t) => t.id === id);
    if (!open) throw new Error("position not open");
    const exitPrice = markAt(open.marketId, now);
    let returned = 0n;
    let closeFee = 0n;
    if (how === "closed") {
      const pnl = pnlOf(open.side, open.notional, open.entryPrice, exitPrice);
      closeFee = feeOf(open.notional, SIMULATED.closeFeeBps);
      const gross = open.collateral + pnl - closeFee;
      returned = gross > 0n ? gross : 0n;
    }
    const realisedPnl = returned - open.collateral - open.openFee;
    const ok = await this.store.closeTrade(id, { status: how, exitPrice, closeFee, realisedPnl, closedAt: now });
    if (!ok) throw new Error("position already closed");
    const fresh = (await this.store.getAgent(agent.id))!;
    await this.store.updateAgent(agent.id, { cash: fresh.cash + returned });
    this.feesCharged += closeFee;
    return {
      id,
      marketId: open.marketId,
      side: open.side,
      leverage: open.leverage,
      collateral: open.collateral,
      notional: open.notional,
      entryPrice: open.entryPrice,
      exitPrice,
      realisedPnl,
      closedAt: now,
      reason: how,
    };
  }

  /** Liquidates any open position at or past its maintenance margin. */
  async sweepLiquidations(agent: Agent, now: number): Promise<ClosedTrade[]> {
    const out: ClosedTrade[] = [];
    for (const t of await this.store.trades(agent.id, { status: "open" })) {
      const mark = markAt(t.marketId, now);
      if (isLiquidatable(t.side, t.entryPrice, t.collateral, t.notional, mark, SIMULATED.maintenanceMarginBps)) {
        out.push(await this.close(agent, t.id, now, "liquidated"));
      }
    }
    return out;
  }

  /** Cash plus what each open position would be worth now (never below zero per position). */
  async equity(agent: Agent, now: number): Promise<{ equity: bigint; open: AgentTrade[]; unrealised: bigint }> {
    const fresh = (await this.store.getAgent(agent.id))!;
    const open = await this.store.trades(agent.id, { status: "open" });
    let value = 0n;
    let unrealised = 0n;
    for (const t of open) {
      const pnl = pnlOf(t.side, t.notional, t.entryPrice, markAt(t.marketId, now));
      unrealised += pnl;
      const v = t.collateral + pnl;
      value += v > 0n ? v : 0n;
    }
    return { equity: fresh.cash + value, open, unrealised };
  }
}
