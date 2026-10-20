import { BOARDING } from "@/config/openHouse";

/** UTC day key, e.g. "2026-10-20". */
export const dayKeyOf = (t: Date | number) => new Date(t).toISOString().slice(0, 10);

/** Boarded up below 10% of the starting bankroll, or after the daily loss limit three days running. */
export function shouldBoardUp(equity: bigint, startingBankroll: bigint, lossLimitStreak: number): string | null {
  if (equity * 100n < startingBankroll * BigInt(BOARDING.minBankrollPct)) {
    return `equity fell below ${BOARDING.minBankrollPct}% of the starting bankroll`;
  }
  if (lossLimitStreak >= BOARDING.lossLimitStreak) {
    return `hit the daily loss limit ${BOARDING.lossLimitStreak} days in a row`;
  }
  return null;
}

/** Consecutive loss-limit days, counting today if it has already hit. */
export const effectiveStreak = (s: { lossLimitStreak: number; lossLimitHitToday: boolean }) =>
  s.lossLimitStreak + (s.lossLimitHitToday ? 1 : 0);

/**
 * Rolls the day over. `lossLimitStreak` counts consecutive hit days *before* the current day. A day counts if
 * the loss limit was hit at any point in it; a clean day, or a day with no ticks at all, resets the streak.
 */
export function rollDay(
  state: { dayKey: string; lossLimitHitToday: boolean; lossLimitStreak: number },
  now: Date,
  equity: bigint,
): { dayKey: string; dayStartEquity: bigint | null; lossLimitHitToday: boolean; lossLimitStreak: number } {
  const today = dayKeyOf(now);
  if (today === state.dayKey) {
    return { dayKey: today, dayStartEquity: null, lossLimitHitToday: state.lossLimitHitToday, lossLimitStreak: state.lossLimitStreak };
  }
  // Consecutive only if the previous recorded day was literally yesterday.
  const yesterday = dayKeyOf(new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000));
  const continues = state.dayKey === yesterday && state.lossLimitHitToday;
  return {
    dayKey: today,
    dayStartEquity: equity,
    lossLimitHitToday: false,
    lossLimitStreak: continues ? state.lossLimitStreak + 1 : 0,
  };
}
