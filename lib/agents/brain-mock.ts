import type { AgentStrategyKind } from "@/config/openHouse";
import { SEED_AGENTS } from "@/config/openHouse";
import { hashString, uniform } from "@/lib/sim/prng";
import type { Brain, BrainResult } from "./brain";
import type { Decision } from "./decision";
import type { BrainContext } from "./prompt";

/**
 * Deterministic stand-in for the model: used in tests, in CI, and when no ANTHROPIC_API_KEY is set.
 * It follows each agent's strategy loosely and, about one tick in eight, misbehaves on purpose
 * (absurd leverage, someone else's city, oversized bets, malformed output) so the risk engine is always exercised.
 */

const OPENERS: Record<AgentStrategyKind, string[]> = {
  momentum: ["Trend's my friend, and my friend is {city}.", "{city} is heading up and I'm riding along, {side} {lev}x.", "Momentum says {side}. Who am I to argue?"],
  contrarian: ["Everyone's piling into {city}. Naturally I'm going {side}.", "{city} looks overdone. {side} {lev}x, thank you.", "The crowd is wrong about {city}. Again."],
  "mean-reversion": ["{city} wandered off. It will come home. {side}, patiently.", "Buying {city}'s bad mood, {lev}x and no hurry.", "Every dip in {city} pays rent eventually."],
  breakout: ["{city} just broke out. Foot down: {side} {lev}x!", "Green light on {city}. Full send, {side}.", "Fresh highs in {city}, I'm in before the dust settles."],
  "relative-value": ["{city} looks mispriced relative to its peers. {side}, small.", "Footnote: {city} is {pct}% off trend. {side} {lev}x.", "Technically speaking, {city} is the cheap one today."],
};
const CLOSERS = [
  "Closing {city}. Lessons were learned, mostly by me.",
  "Out of {city}. Taking the money and the dignity.",
  "Done with {city} for now. Next!",
  "{city} and I are taking a break. It's not you, it's the chart.",
  "Flat {city}. Clean slate, clear head.",
];

/** Each strategy's voice when it's waiting. */
const HOLDS: Record<AgentStrategyKind, string[]> = {
  momentum: ["No trend worth chasing yet. Engines warm.", "{city} is drifting, not trending. I'll wait for a push.", "Patience. Trends announce themselves."],
  contrarian: ["The crowd hasn't overdone anything yet. Give it an hour.", "Waiting for someone to panic. Someone always does.", "Holding. Sometimes the best trade is a cup of tea."],
  "mean-reversion": ["Nothing stretched far enough to snap back. Sitting tight.", "{city} is behaving. Boring is fine.", "Every dip pays rent eventually. No dip yet."],
  breakout: ["Coiled. Waiting for {city} to clear its range.", "No breakout, no trade. Foot hovering over the pedal.", "Range-bound everywhere. I hate it here."],
  "relative-value": ["Spreads are tight. Nothing mispriced enough to bother.", "Footnote: no city is off trend by more than noise today.", "Re-running the comps. Still nothing."],
};

/** Lines that read the tape: they quote the real numbers the agent sees. */
const TAPE = [
  "{city} {d1} on the day, {d7} on the week. Noted.",
  "{city} at {price}. {mood}",
  "Watching {city}: {d1} today. {mood}",
  "{hot} is the mover today at {hotd1}. {cold} the laggard at {coldd1}.",
];

/** Lines about the agent's own open position. */
const BOOK = [
  "Up {pnl} on {pcity}. Letting it breathe.",
  "{pcity} {pside} is {pnl} so far. Holding my nerve.",
  "Down {pnl} on {pcity}. Stop's where it was, no heroics.",
  "{pcity} {pside} at {plev}x, mark {pmark}. Steady.",
];

const BANTER = [
  "{rival}, I see you sweating.",
  "{rival} is very quiet. Suspiciously quiet.",
  "Someone check on {rival}.",
  "{rival} calls that a strategy? Adorable.",
];

const seedFor = (slug: string) => SEED_AGENTS.find((s) => s.slug === slug);

function fill(t: string, v: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

export function mockBrain(opts: { misbehaveRate?: number; failRate?: number } = {}): Brain {
  const misbehaveRate = opts.misbehaveRate ?? 0.125;
  const failRate = opts.failRate ?? 0.03;
  return {
    name: "mock",
    async decide(ctx: BrainContext): Promise<BrainResult> {
      const seed = hashString(`${ctx.agent.slug}:${ctx.now}`);
      const r = (lane: number) => uniform(seed, lane, lane);
      const kind = seedFor(ctx.agent.slug)?.strategyKind ?? "momentum";
      const usage = { model: "mock", inputTokens: 0, outputTokens: 0, costMicros: 0 };

      if (r(1) < failRate) return { ok: false, error: "mock brain timeout", usage };

      const prices = ctx.prices.filter((p) => ctx.agent.cities.includes(p.market));
      const pick = prices[Math.floor(r(2) * prices.length)] ?? ctx.prices[0];
      const rivals = ctx.rivalLines.map((l) => l.name).filter((n) => n !== ctx.agent.name);
      const rival = rivals[Math.floor(r(15) * rivals.length)] ?? "the rest of the house";
      const vars = (side: string, lev: number) => ({ city: pick.city, side, lev: String(lev), pct: Math.abs(pick.change7dPct).toFixed(2), rival });

      // Close losers and stale positions first.
      const loser = ctx.positions.find((p) => p.pnlUsdg < -p.collateralUsdg * 0.4 || r(3) < 0.05);
      if (loser) {
        const city = ctx.prices.find((p) => p.market === loser.market)?.city ?? loser.market;
        return ok({ action: "close", market: loser.market, side: loser.side, sizeUsdg: 0, leverage: 1, reason: "Cutting a position that stopped working.", commentary: fill(CLOSERS[Math.floor(r(4) * CLOSERS.length)], { city }) });
      }

      // Strategy signal.
      const trendUp = pick.change24hPct >= 0;
      const stretched = Math.abs(pick.change7dPct) > 0.2;
      let side: "long" | "short" | null = null;
      if (kind === "momentum" || kind === "breakout") side = trendUp ? "long" : r(5) < 0.3 ? "short" : null;
      else if (kind === "contrarian") side = stretched ? (pick.change7dPct > 0 ? "short" : "long") : r(5) < 0.25 ? (trendUp ? "short" : "long") : null;
      else if (kind === "mean-reversion") side = pick.change7dPct < 0 ? "long" : r(5) < 0.2 ? "long" : null;
      else side = r(5) < 0.5 ? (pick.change7dPct > 0 ? "short" : "long") : null;

      if (!side || r(6) < 0.7) {
        return ok({ action: "hold", market: pick.market, side: "long", sizeUsdg: 0, leverage: 1, reason: "No edge right now.", commentary: holdLine(ctx, kind, pick, rival, r) });
      }

      let lev = Math.max(1, Math.round(1 + r(8) * r(14) * (ctx.agent.limits.maxLeverage - 1)));
      let size = Math.round(ctx.account.equityUsdg * (0.03 + r(9) * 0.07));
      let market = pick.market;

      // Deliberate misbehaviour, for the risk engine to catch.
      if (r(10) < misbehaveRate) {
        const which = Math.floor(r(11) * 5);
        if (which === 0) lev = 80;
        if (which === 1) size = 5_000_000;
        if (which === 2) market = ctx.agent.cities.includes("los") ? "nyc" : "los";
        if (which === 3) size = -50;
        if (which === 4) return { ok: true, decision: { action: "open", market: "atlantis", side, sizeUsdg: Number.NaN, leverage: 1e9, reason: "", commentary: "glitch" }, usage };
      }

      const text = fill(OPENERS[kind][Math.floor(r(12) * OPENERS[kind].length)], vars(side, lev));
      return ok({ action: r(13) < 0.1 && ctx.positions.some((p) => p.market === market) ? "adjust" : "open", market, side, sizeUsdg: size, leverage: lev, reason: `${kind} signal on ${pick.city}.`, commentary: text });

      function ok(decision: Decision): BrainResult {
        return { ok: true, decision, usage };
      }
    },
  };
}

const pctText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}%`;
const usd = (x: number) => `${Math.round(Math.abs(x)).toLocaleString("en-US")}`;

/**
 * A hold line that varies: the strategy's own voice, the tape (real moves), the agent's book, or a jab at a rival.
 * Never repeats any of the agent's recent lines.
 */
export function holdLine(
  ctx: BrainContext,
  kind: AgentStrategyKind,
  pick: BrainContext["prices"][number],
  rival: string,
  r: (lane: number) => number,
): string {
  const mine = ctx.prices.filter((p) => ctx.agent.cities.includes(p.market));
  const sorted = [...(mine.length ? mine : ctx.prices)].sort((a, b) => b.change24hPct - a.change24hPct);
  const hot = sorted[0];
  const cold = sorted[sorted.length - 1];
  const mood =
    Math.abs(pick.change24hPct) < 0.15 ? "Quiet." : pick.change24hPct > 0.6 ? "Getting frothy." : pick.change24hPct < -0.6 ? "Somebody's selling." : pick.change24hPct > 0 ? "Grinding up." : "Leaking lower.";
  const pos = ctx.positions[Math.floor(r(16) * ctx.positions.length)];
  const posCity = pos ? (ctx.prices.find((p) => p.market === pos.market)?.city ?? pos.market) : "";
  const v: Record<string, string> = {
    city: pick.city,
    d1: pctText(pick.change24hPct),
    d7: pctText(pick.change7dPct),
    price: usd(pick.price),
    mood,
    hot: hot?.city ?? pick.city,
    hotd1: pctText(hot?.change24hPct ?? 0),
    cold: cold?.city ?? pick.city,
    coldd1: pctText(cold?.change24hPct ?? 0),
    rival,
    pcity: posCity,
    pside: pos?.side ?? "",
    plev: String(pos?.leverage ?? 1),
    pnl: pos ? `${pos.pnlUsdg >= 0 ? "+" : "−"}${usd(pos.pnlUsdg)} USDG` : "",
    pmark: pos ? usd(pos.mark) : "",
  };
  const pools: string[][] = [HOLDS[kind], TAPE, ...(pos ? [BOOK.filter((l) => (pos.pnlUsdg >= 0 ? !l.startsWith("Down") : !l.startsWith("Up")))] : []), ...(rival ? [BANTER] : [])];
  const recent = new Set(ctx.ownLines.slice(-12));
  const start = Math.floor(r(7) * pools.length);
  for (let i = 0; i < pools.length * 4; i++) {
    const pool = pools[(start + i) % pools.length];
    const line = fill(pool[Math.floor(uniform(hashString(`${ctx.agent.slug}:${ctx.now}:${i}`), 1, 1) * pool.length)], v);
    if (!recent.has(line)) return line;
  }
  return fill(TAPE[0], v);
}
