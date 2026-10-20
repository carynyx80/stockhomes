import { AGENTS, AGENT_MODELS, MODEL_PRICING } from "@/config/openHouse";
import { parseDecision, type Decision } from "./decision";
import type { BrainContext } from "./prompt";

export type BrainUsage = { model: string; inputTokens: number; outputTokens: number; costMicros: number };

export type BrainResult =
  | { ok: true; decision: Decision; usage: BrainUsage | null }
  | { ok: false; error: string; usage: BrainUsage | null };

export interface Brain {
  readonly name: string;
  decide(ctx: BrainContext): Promise<BrainResult>;
}

/** Micro-USD for a call: price per million tokens × tokens = micro-dollars. */
export function costMicros(
  model: string,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): number {
  const p = MODEL_PRICING[model] ?? { input: 10, output: 50, cacheRead: 1 }; // unknown model: assume expensive
  return Math.ceil(
    u.input_tokens * p.input +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
      u.output_tokens * p.output,
  );
}

export const modelFor = (mode: BrainContext["mode"]) => (mode === "big" ? AGENT_MODELS.big : AGENT_MODELS.routine);
export const maxTokensFor = (mode: BrainContext["mode"]) => (mode === "big" ? AGENTS.maxTokensBig : AGENTS.maxTokensRoutine);

/** Accepts anything a brain produced; returns a Decision or a reason it can't be used. */
export function acceptDecision(raw: unknown): { decision: Decision } | { error: string } {
  const d = parseDecision(raw);
  if (!d) return { error: "model output did not match the decision schema" };
  return { decision: d };
}
