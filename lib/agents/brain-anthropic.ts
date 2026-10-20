import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AGENTS } from "@/config/openHouse";
import { acceptDecision, costMicros, maxTokensFor, modelFor, type Brain, type BrainResult } from "./brain";
import { DecisionSchema } from "./decision";
import { systemPrompt, userPrompt } from "./prompt";

/**
 * Claude-backed brain. Structured output (Zod) for the decision, a cached per-agent system prompt,
 * capped output tokens, and low effort for routine ticks. Any failure returns ok:false; the tick then holds.
 */
export function anthropicBrain(client = new Anthropic()): Brain {
  return {
    name: "anthropic",
    async decide(ctx): Promise<BrainResult> {
      const model = modelFor(ctx.mode);
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: maxTokensFor(ctx.mode),
          system: [{ type: "text", text: systemPrompt(ctx), cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userPrompt(ctx) }],
          output_config: {
            effort: ctx.mode === "big" ? AGENTS.effortBig : AGENTS.effortRoutine,
            format: zodOutputFormat(DecisionSchema),
          },
        });
        const usage = {
          model,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          costMicros: costMicros(model, res.usage),
        };
        if (res.stop_reason === "refusal") return { ok: false, error: "model declined", usage };
        if (res.stop_reason === "max_tokens") return { ok: false, error: "hit the token cap", usage };
        const accepted = acceptDecision(res.parsed_output);
        return "error" in accepted ? { ok: false, error: accepted.error, usage } : { ok: true, decision: accepted.decision, usage };
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "rate limited", usage: null };
        if (err instanceof Anthropic.APIError) return { ok: false, error: `API error ${err.status}`, usage: null };
        return { ok: false, error: err instanceof Error ? err.message : "unknown error", usage: null };
      }
    },
  };
}
