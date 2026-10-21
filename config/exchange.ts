/**
 * The Stoxhomes exchange contracts (contracts/). Addresses are public, not secrets.
 * Testnet deployment of 2026-10-20 (Robinhood Chain testnet, 46630); see docs/VERIFIED_CONTRACTS.md.
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
    oracle: "0x7ddbbe04dD07e8765F21eE30a5281D7100aE3159",
    vault: "0x73e615e2558DA1Bbd5da735Dcc07967541A965F2",
    perps: "0x69A9d5D11834c3c1417e1f1C9534Bd0dA64e0648",
    fromBlock: 139_678_022n,
    markets: ["nyc", "mia", "lax", "lon"],
  },
  mainnet: null,
};

/** Slippage allowance on the oracle price when opening and closing from the UI. */
export const UI_SLIPPAGE_BPS = 50;
