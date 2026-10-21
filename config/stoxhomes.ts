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
  restrictedRoutes: ["/trade", "/vault", "/wars", "/house", "/api/house"],
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

/**
 * Creator-fee buyback & burn. Tunables only; secrets and per-deploy values come from env (lib/env.ts).
 * See docs/VERIFIED_CONTRACTS.md for how each address below was confirmed.
 */
export const BOT = {
  claimThresholdUsd: 100,
  /** Share of every claim spent on buyback and burn, in bps (2000 = 20%). */
  burnShareBps: 2000,
  maxSlippageBps: 200,
  minGasEth: "0.002",
  /** Skip a claim when its gas would cost more than this share of its value. */
  maxGasShareBps: 500,
  /** Chainlink answer older than this is treated as unavailable. */
  maxPriceAgeSeconds: 3 * 60 * 60,
  /** Swap transaction deadline. */
  swapDeadlineSeconds: 300,
  lockTtlSeconds: 240,
  /** Matches the fee cron in vercel.json: daily at 12:00 UTC on Vercel Hobby. On Pro, set 10 here and every-10-minutes there. */
  cronIntervalMinutes: 1440,
  /** Upper bound on blocks scanned per run when looking for claims made outside the bot. */
  maxLogScanBlocks: 50_000n,
  /** Gas units assumed for steps that can't be estimated before the previous one lands. */
  gasUnits: { swap: 450_000n, burn: 90_000n },
  deadAddress: "0x000000000000000000000000000000000000dEaD",
} as const;

type Address = `0x${string}`;

export type NetworkContracts = {
  ponsFactory: Address;
  ponsFeeEscrow: Address;
  ponsMemeHook: Address;
  uniswapUniversalRouter: Address;
  uniswapV4Quoter: Address;
  chainlinkEthUsd: Address;
};

/** Verified on robinhoodchain.blockscout.com and against Uniswap / Chainlink docs on 2026-10-20. */
export const CONTRACTS: Record<"mainnet" | "testnet", NetworkContracts | null> = {
  mainnet: {
    ponsFactory: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e", // PonsV2LaunchFactory
    ponsFeeEscrow: "0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e", // PonsV2FeeEscrow (= factory.feeEscrow())
    ponsMemeHook: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044", // PonsV2MemeHook (= factory.memeHook())
    uniswapUniversalRouter: "0x204FAca1764B154221e35c0d20aBb3c525710498", // UniversalRouter 2.1.2
    uniswapV4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94", // V4Quoter
    chainlinkEthUsd: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", // ETH / USD standard proxy, 8 decimals
  },
  // Pons V2 and Uniswap v4 are not deployed on Robinhood Chain testnet.
  testnet: null,
};
