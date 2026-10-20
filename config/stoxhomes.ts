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
