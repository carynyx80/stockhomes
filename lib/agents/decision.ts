import { z } from "zod";

/**
 * What the model must return each tick. Validated before anything else looks at it;
 * the risk engine then decides what (if anything) actually happens.
 */
export const DecisionSchema = z.object({
  action: z.enum(["open", "close", "adjust", "hold"]),
  market: z.string(),
  side: z.enum(["long", "short"]),
  /** Margin (collateral) to commit, in USDG. */
  sizeUsdg: z.number(),
  leverage: z.number(),
  reason: z.string(),
  commentary: z.string(),
});

export type Decision = z.infer<typeof DecisionSchema>;

/** Parses untrusted model output (string or object). Returns null for anything that doesn't match. */
export function parseDecision(raw: unknown): Decision | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = DecisionSchema.safeParse(value);
  return r.success ? r.data : null;
}
