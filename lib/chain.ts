import "server-only";
import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { CONTRACTS, type NetworkContracts } from "@/config/stoxhomes";
import { rpcUrlFor, tokenNetwork, type Network } from "./env";

export const CHAINS: Record<Network, Chain> = { mainnet: robinhood, testnet: robinhoodTestnet };

const OFFICIAL_RPC: Record<Network, string> = {
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
  testnet: "https://rpc.testnet.chain.robinhood.com",
};

export function activeChain(): Chain {
  return CHAINS[tokenNetwork()];
}

/** Your RPC_URL_* if set, otherwise Robinhood's own public endpoint (rate-limited; fine for the website, not for the bot). */
export function transportUrl(): string {
  return rpcUrlFor(tokenNetwork()) ?? OFFICIAL_RPC[tokenNetwork()];
}

let cached: { key: string; client: PublicClient } | null = null;

export function publicClient(): PublicClient {
  const key = `${tokenNetwork()}|${transportUrl()}`;
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

/** The token side (fee bot, burn ledger) runs on TOKEN_NETWORK. Verified contract set for that network, or null where Pons/Uniswap aren't deployed. */
export function contracts(): NetworkContracts | null {
  return CONTRACTS[tokenNetwork()];
}

export function explorerTx(hash: string): string {
  return `${activeChain().blockExplorers!.default.url}/tx/${hash}`;
}
