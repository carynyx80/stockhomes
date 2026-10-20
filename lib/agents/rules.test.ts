import { describe, expect, it } from "vitest";
import { effectiveStreak, rollDay, shouldBoardUp } from "./boarding";
import { memoryRateLimiter } from "./infra";
import { moderate, moderateCommentary, moderateNickname, normalise } from "./moderation";

const U = 1_000_000n;

describe("boarding up", () => {
  it("boards up below 10% of the starting bankroll", () => {
    expect(shouldBoardUp(999n * U, 10_000n * U, 0)).toMatch(/below 10%/);
    expect(shouldBoardUp(1_000n * U, 10_000n * U, 0)).toBeNull();
  });

  it("boards up after the loss limit three days in a row, counting today", () => {
    expect(shouldBoardUp(9_000n * U, 10_000n * U, effectiveStreak({ lossLimitStreak: 2, lossLimitHitToday: true }))).toMatch(/3 days/);
    expect(shouldBoardUp(9_000n * U, 10_000n * U, effectiveStreak({ lossLimitStreak: 2, lossLimitHitToday: false }))).toBeNull();
  });

  it("counts consecutive days only", () => {
    const d = (s: string) => new Date(`${s}T00:05:00Z`);
    let s = { dayKey: "2026-10-01", lossLimitHitToday: true, lossLimitStreak: 0 };
    s = { ...rollDay(s, d("2026-10-02"), 1n), lossLimitHitToday: true };
    expect(s.lossLimitStreak).toBe(1);
    s = { ...rollDay(s, d("2026-10-03"), 1n), lossLimitHitToday: true };
    expect(effectiveStreak(s)).toBe(3);
    // A clean day resets.
    const clean = rollDay({ ...s, lossLimitHitToday: false }, d("2026-10-04"), 1n);
    expect(clean.lossLimitStreak).toBe(0);
    // A gap (no ticks for a day) resets too.
    const gap = rollDay({ dayKey: "2026-10-01", lossLimitHitToday: true, lossLimitStreak: 1 }, d("2026-10-03"), 1n);
    expect(gap.lossLimitStreak).toBe(0);
    // Same day: nothing changes and no new day-start equity.
    expect(rollDay(s, new Date("2026-10-03T20:00:00Z"), 1n).dayStartEquity).toBeNull();
  });
});

describe("chat moderation", () => {
  it("lets normal banter through", () => {
    for (const t of ["Miami Bull is cooked lol", "London Doomer was right for once", "fire retardant on the order book please", "100x? cute."]) {
      expect(moderate(t)).toEqual({ ok: true, text: t });
    }
  });

  it("blocks slurs, including disguised ones", () => {
    const slur = [..."reggin"].reverse().join("");
    expect(moderate(`you ${slur}`).ok).toBe(false);
    expect(moderate(`you ${slur.replace("i", "1")}`).ok).toBe(false);
    expect(moderate(`you ${slur.split("").join(" ")}`).ok).toBe(false);
    expect(moderate(`you ${slur.split("").join(".")}`).ok).toBe(false);
  });

  it("blocks harassment, links, contact details and wallet shilling", () => {
    expect(moderate("kys").ok).toBe(false);
    expect(moderate("go die").ok).toBe(false);
    expect(moderate("join my discord.gg/abc").ok).toBe(false);
    expect(moderate("see https://evil.example").ok).toBe(false);
    expect(moderate("mail me a@b.co").ok).toBe(false);
    expect(moderate("call +1 555 123 4567").ok).toBe(false);
    expect(moderate(`send to 0x${"a".repeat(40)}`).ok).toBe(false);
  });

  it("enforces length, shouting and empty messages", () => {
    expect(moderate("x".repeat(281)).ok).toBe(false);
    expect(moderate("   ").ok).toBe(false);
    expect(moderate("THIS IS ALL CAPS SHOUTING").ok).toBe(false);
  });

  it("strips control and bidi characters", () => {
    expect(moderate("hi‮there\u0007")).toEqual({ ok: true, text: "hi there" });
  });

  it("checks nicknames", () => {
    expect(moderateNickname("brick_fan").ok).toBe(true);
    expect(moderateNickname("x").ok).toBe(false);
    expect(moderateNickname("Stoxhomes Admin").ok).toBe(false);
    expect(moderateNickname("<script>").ok).toBe(false);
  });

  it("drops agent commentary that fails the filter", () => {
    expect(moderateCommentary("Rolling into Miami, captain.", 280)).toBe("Rolling into Miami, captain.");
    expect(moderateCommentary("visit https://scam.example", 280)).toBeNull();
  });

  it("normalises leetspeak and repeats for matching", () => {
    expect(normalise("H3LLOOOOO w0rld!")).toBe("helloo worldi");
  });
});

describe("chat rate limits", () => {
  it("allows one message per window and caps bursts", async () => {
    let t = 0;
    const rl = memoryRateLimiter(() => t);
    expect(await rl.hit("v1", 1, 5)).toBe(true);
    expect(await rl.hit("v1", 1, 5)).toBe(false);
    expect(await rl.hit("v2", 1, 5)).toBe(true); // other visitors unaffected
    t += 5_000;
    expect(await rl.hit("v1", 1, 5)).toBe(true);

    const burst = memoryRateLimiter(() => 0);
    for (let i = 0; i < 20; i++) expect(await burst.hit("b", 20, 600)).toBe(true);
    expect(await burst.hit("b", 20, 600)).toBe(false);
  });
});
