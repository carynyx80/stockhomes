import { DECIMALS } from "@/config/stoxhomes";

const MINUS = "−";

/** Exact decimal formatting of a fixed-point bigint, rounded half away from zero, with thousands separators. */
export function formatFixed(
  value: bigint,
  decimals: number,
  dp: number,
  opts: { sign?: boolean } = {},
): string {
  const neg = value < 0n;
  let abs = neg ? -value : value;
  if (dp < decimals) {
    const drop = 10n ** BigInt(decimals - dp);
    abs = (abs + drop / 2n) / drop;
  } else if (dp > decimals) {
    abs *= 10n ** BigInt(dp - decimals);
  }
  const s = abs.toString().padStart(dp + 1, "0");
  const int = s.slice(0, s.length - dp).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = dp > 0 ? `.${s.slice(s.length - dp)}` : "";
  const isZero = abs === 0n;
  const prefix = neg && !isZero ? MINUS : opts.sign && !isZero ? "+" : "";
  return `${prefix}${int}${frac}`;
}

export const formatUsdg = (v: bigint, dp = 2, opts?: { sign?: boolean }) => formatFixed(v, DECIMALS.usdg, dp, opts);
export const formatPrice = (v: bigint, dp = 2) => formatFixed(v, DECIMALS.price, dp);

/** Compact USDG for stat tiles: 2.41M, 812.3K. */
export function formatUsdgCompact(v: bigint): string {
  const n = Number(v) / 10 ** DECIMALS.usdg;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

export function formatBps(bps: number, dp = 2, sign = true): string {
  const pct = Math.abs(bps / 100).toFixed(dp);
  const prefix = bps < 0 && Number(pct) !== 0 ? MINUS : sign && bps > 0 ? "+" : "";
  return `${prefix}${pct}%`;
}

export function toNumber(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

/** Parses user input like "1,250.5" into USDG fixed point. Returns null for anything that isn't a plain amount. */
export function parseUsdg(input: string): bigint | null {
  const s = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  if (frac.length > DECIMALS.usdg) return null;
  return BigInt(int || "0") * 10n ** BigInt(DECIMALS.usdg) + BigInt(frac.padEnd(DECIMALS.usdg, "0") || "0");
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
