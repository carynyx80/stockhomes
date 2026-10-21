import { CATALOGUE, GBP_USD, type CatalogueSource } from "./markets";

/**
 * Price sources for the on-chain city markets.
 *
 * TESTNET ONLY. These are the best free sources (monthly). Gliding between monthly readings makes the path
 * predictable, which would let traders farm the drift against the Vault with leverage. Mainnet needs a daily
 * licensed feed (Parcl Labs for US cities; an equivalent for the UK). See docs/ORACLE.md.
 *
 * price(t) = reading(t) × scale, glided linearly between monthly readings:
 *   US: Zillow Home Value Index (typical home value, mid tier, smoothed and seasonally adjusted), USD, scale 1.
 *   UK: UK House Price Index average price (HM Land Registry, OGL), GBP × a fixed GBP_USD.
 */

export type OracleMarket = {
  id: string;
  city: string;
  source: CatalogueSource;
  /** Reading → USD. */
  scale: number;
  /**
   * Months after the reference month at which a reading is fully reflected. Chosen so a reading is always
   * published before its glide segment starts (ZHVI lands mid-next-month, UK HPI ~2.5 months later), so prices never jump.
   */
  lagMonths: number;
};

export const SOURCE_LABEL: Record<CatalogueSource["kind"], string> = {
  zillow: "Zillow Home Value Index (ZHVI), metro, mid tier",
  ukhpi: "UK House Price Index, HM Land Registry (OGL)",
};

export const ORACLE_MARKETS: OracleMarket[] = CATALOGUE.map((m) => ({
  id: m.id,
  city: m.city,
  source: m.source,
  scale: m.source.kind === "ukhpi" ? GBP_USD : 1,
  lagMonths: m.source.kind === "ukhpi" ? 4 : 3,
}));

export const KEEPER = {
  /** Stay under the on-chain 1% per-post limit; bigger moves are walked over several posts. */
  maxStepBps: 90,
  /** Skip a post when the price would change by less than this (saves gas, keeps the feed fresh via heartbeat). */
  minChangeBps: 1,
  /** Re-post at least this often even if unchanged, so feeds never go stale (on-chain max age is 2 days). */
  heartbeatSeconds: 6 * 60 * 60,
  /** Page size when scanning positions and orders. */
  pageSize: 200,
  /** Most liquidations / trigger fills / order fills sent per run, so a run fits in the function's time limit. */
  maxActionsPerRun: 60,
} as const;
