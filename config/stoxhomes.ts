/**
 * Every tunable value for Stoxhomes lives here.
 * Secrets never go in this file — they come from environment variables, read server-side only.
 */

export const BRAND = {
  name: "Stoxhomes",
  tagline: "Long or short the price of a home, city by city.",
} as const;

/** The project token. Change the ticker here and nowhere else. */
export const TOKEN = {
  ticker: "$STOXH",
  totalSupply: 1_000_000_000n,
  decimals: 18,
} as const;

/** Settlement asset for the exchange. */
export const SETTLEMENT = {
  symbol: "USDG",
} as const;

export const TRADING = {
  maxLeverage: 100,
} as const;

/**
 * Geo-restriction for trading pages (leveraged derivatives).
 * Country codes are ISO 3166-1 alpha-2, as sent by Vercel's `x-vercel-ip-country` header.
 * Review this list with counsel before launch.
 */
export const GEO = {
  restrictedRoutes: ["/trade", "/vault", "/wars"],
  blockedCountries: [
    "US", // United States
    "GB", // United Kingdom
    "CA", // Canada
    // Comprehensively sanctioned jurisdictions
    "CU", // Cuba
    "IR", // Iran
    "KP", // North Korea
    "SY", // Syria
    "RU", // Russia
    "BY", // Belarus
  ],
  /** Region codes (`x-vercel-ip-country-region`) blocked inside otherwise-allowed countries. */
  blockedRegions: {
    UA: ["43", "14", "09"], // Crimea, Donetsk, Luhansk
  } as Record<string, string[]>,
  /** In production, block restricted routes when the country header is missing. */
  failClosedInProduction: true,
} as const;

/**
 * Fixed-point precision used across the DataSource interface.
 * USDG decimals: VERIFY on the Robinhood Chain explorer before any live use.
 */
export const DECIMALS = {
  usdg: 6,
  price: 8,
} as const;

/** Simulated mode: paper trading against mock feeds. None of this touches real funds. */
export const SIMULATED = {
  startingBalanceUsdg: 10_000,
  minCollateralUsdg: 10,
  maintenanceMarginBps: 50,
  openFeeBps: 6,
  closeFeeBps: 6,
  /** Standard deviation of a city's daily move (0.1%). */
  dailyVol: 0.001,
  /** Every simulated series starts here, so all visitors see the same prices. */
  genesis: Date.UTC(2025, 0, 6), // a Monday: City Wars rounds run Monday to Monday, UTC
  tickMs: 2_000,
  vault: {
    baseTvlUsdg: 2_400_000,
    meanApr: 0.15,
  },
  wars: {
    /** Winning picks return stake × this (the House keeps the rest). */
    payoutMultiplier: 1.9,
    minStakeUsdg: 5,
  },
} as const;
