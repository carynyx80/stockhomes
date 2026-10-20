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
const CLOSERS = ["Closing {city}. Lessons were learned, mostly by me.", "Out of {city}. Taking the money and the dignity.", "Done with {city} for now. Next!"];
const HOLDS = ["Holding. Sometimes the best trade is a cup of tea.", "Nothing worth doing yet. Watching {city}.", "Sitting tight. {rival}, I see you sweating."];

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
      const rival = ctx.rivalLines[0]?.name ?? "everyone";
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
        return ok({ action: "hold", market: pick.market, side: "long", sizeUsdg: 0, leverage: 1, reason: "No edge right now.", commentary: fill(HOLDS[Math.floor(r(7) * HOLDS.length)], vars("long", 1)) });
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
