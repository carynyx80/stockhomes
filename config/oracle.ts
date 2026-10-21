/**
 * Price sources for the on-chain city markets.
 *
 * TESTNET ONLY. These are the best free sources (monthly). Gliding between monthly readings makes the path
 * predictable, which would let traders farm the drift against the Vault with leverage. Mainnet needs a daily
 * licensed feed (Parcl Labs for US cities; an equivalent for London). See docs/ORACLE.md.
 *
 * price(t) = anchorUsd × index(t) / index(anchorMonth), so January 2025 matches the simulated markets' base values.
 */

export type MonthlySource =
  | { kind: "fred"; series: string; label: string }
  | { kind: "ukhpi"; region: string; label: string };

export type OracleMarket = {
  id: string;
  city: string;
  source: MonthlySource;
  anchorMonth: string;
  anchorUsd: number;
  /**
   * Months after the reference month at which a reading is fully reflected. Chosen so a reading is always
   * published before its glide segment starts (Case-Shiller lands ~2.9 months later, UK HPI ~1.5), so prices never jump.
   */
  lagMonths: number;
};

export const ORACLE_MARKETS: OracleMarket[] = [
  { id: "nyc", city: "New York", source: { kind: "fred", series: "NYXRSA", label: "S&P CoreLogic Case-Shiller NY (SA), via FRED" }, anchorMonth: "2025-01", anchorUsd: 782_000, lagMonths: 4 },
  { id: "mia", city: "Miami", source: { kind: "fred", series: "MIXRSA", label: "S&P CoreLogic Case-Shiller Miami (SA), via FRED" }, anchorMonth: "2025-01", anchorUsd: 594_000, lagMonths: 4 },
  { id: "lax", city: "Los Angeles", source: { kind: "fred", series: "LXXRSA", label: "S&P CoreLogic Case-Shiller LA (SA), via FRED" }, anchorMonth: "2025-01", anchorUsd: 961_000, lagMonths: 4 },
  { id: "lon", city: "London", source: { kind: "ukhpi", region: "london", label: "UK House Price Index, HM Land Registry (OGL)" }, anchorMonth: "2025-01", anchorUsd: 521_000, lagMonths: 3 },
];

/** Markets without a usable source: kept simulated ("coming soon") in live mode. */
export const UNSOURCED_MARKETS: Record<string, string> = {
  dxb: "DLD's official monthly index stops in November 2022; DLD transaction data needs registration.",
  los: "No credible, current house price index exists for Lagos.",
};

export const KEEPER = {
  /** Stay under the on-chain 1% per-post limit; bigger moves are walked over several posts. */
  maxStepBps: 90,
  /** Skip a post when the price would change by less than this (saves gas, keeps the feed fresh via heartbeat). */
  minChangeBps: 1,
  /** Re-post at least this often even if unchanged, so feeds never go stale (on-chain max age is 1 day). */
  heartbeatSeconds: 6 * 60 * 60,
  liquidationPageSize: 200,
} as const;
