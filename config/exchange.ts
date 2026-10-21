import { CATALOGUE } from "./markets";

/**
 * The Stoxhomes exchange contracts (contracts/). Addresses are public, not secrets.
 * Testnet deployment v2 of 2026-10-21 (Robinhood Chain testnet, 46630): 100 city markets, limit/stop orders,
 * take-profit/stop-loss, partial closes and margin withdrawal. See docs/VERIFIED_CONTRACTS.md.
 * Mainnet: none. The contracts must be audited first, with the owner role on a multisig.
 */

type Address = `0x${string}`;

export type ExchangeDeployment = {
  chainId: number;
  usdg: Address;
  /** True for the testnet TestUSDG, which has a public faucet. */
  usdgHasFaucet: boolean;
  oracle: Address;
  vault: Address;
  perps: Address;
  /** Block the contracts were deployed in (for event scans). */
  fromBlock: bigint;
  markets: string[];
};

export const EXCHANGE: Record<"testnet" | "mainnet", ExchangeDeployment | null> = {
  testnet: {
    chainId: 46630,
    usdg: "0xE33f794eD0ebC1009bb7277835C2830F8C9d74A1",
    usdgHasFaucet: true,
    oracle: "0x2b67155A19419E35c78072D6e8AECfCB8549ef26",
    vault: "0x369A37EC6054c19Ab4908fE3C00Acabd6B6104f3",
    perps: "0xbaB5921C739b02e9520B2B97038c3698257dAd0f",
    fromBlock: 139_711_406n,
    markets: CATALOGUE.map((m) => m.id),
  },
  mainnet: null,
};

/**
 * Market parameters the contracts were deployed with (contracts/script/Deploy.s.sol), for previews in the UI.
 * The contracts are the source of truth; these only drive estimates.
 */
export const EXCHANGE_PARAMS = {
  maxLeverage: 100,
  openFeeBps: 6,
  closeFeeBps: 6,
  maintenanceBps: 50,
  borrowBpsPerDay: 1,
  minCollateral: 10,
  minHoldSeconds: 60,
  maxOrdersPerOwner: 25,
} as const;

/** Slippage allowance on the oracle price when opening and closing from the UI. */
export const UI_SLIPPAGE_BPS = 50;
