import "server-only";
import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { CONTRACTS, type NetworkContracts } from "@/config/stoxhomes";
import { network, rpcUrl, type Network } from "./env";

export const CHAINS: Record<Network, Chain> = { mainnet: robinhood, testnet: robinhoodTestnet };

const OFFICIAL_RPC: Record<Network, string> = {
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
  testnet: "https://rpc.testnet.chain.robinhood.com",
};

export function activeChain(): Chain {
  return CHAINS[network()];
}

/** Your RPC_URL_* if set, otherwise Robinhood's own public endpoint (rate-limited; fine for the website, not for the bot). */
export function transportUrl(): string {
  return rpcUrl() ?? OFFICIAL_RPC[network()];
}

let cached: { key: string; client: PublicClient } | null = null;

export function publicClient(): PublicClient {
  const key = `${network()}|${transportUrl()}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: createPublicClient({
        chain: activeChain(),
        transport: http(transportUrl(), { retryCount: 3, retryDelay: 800, timeout: 20_000 }),
      }) as PublicClient,
    };
  }
  return cached.client;
}

/** Verified contract set for the active network, or null where Pons/Uniswap aren't deployed. */
export function contracts(): NetworkContracts | null {
  return CONTRACTS[network()];
}

export function explorerTx(hash: string): string {
  return `${activeChain().blockExplorers!.default.url}/tx/${hash}`;
}
