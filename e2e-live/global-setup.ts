import { spawn, spawnSync } from "node:child_process";
import { createPublicClient, http, stringToHex } from "viem";
import { robinhoodTestnet } from "viem/chains";
import { EXCHANGE } from "../config/exchange";
import { priceOracleAbi, stoxhomesPerpsAbi, stoxhomesVaultAbi } from "../lib/exchange/abis";

const PORT = 8570;
const UPSTREAM = process.env.RPC_URL_TESTNET ?? "https://rpc.testnet.chain.robinhood.com";

/** Starts an Anvil fork of testnet that signs for any address (the page's stub wallet relies on that). */
export default async function globalSetup() {
  if (spawnSync("anvil", ["--version"]).status !== 0) throw new Error("anvil is required (Foundry)");
  const anvil = spawn("anvil", ["--fork-url", UPSTREAM, "--port", String(PORT), "--auto-impersonate", "--silent", "--retries", "10", "--fork-retry-backoff", "1000"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Warm the fork: the first reads pull contract state from the real testnet, slowly. Make the page's own poll once.
  const dep = EXCHANGE.testnet!;
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(`http://127.0.0.1:${PORT}`, { timeout: 120_000 }) });
  const key = (id: string) => stringToHex(id, { size: 32 });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.multicall({
        allowFailure: true,
        contracts: [
          ...dep.markets.map((m) => ({ address: dep.oracle, abi: priceOracleAbi, functionName: "lastPrice", args: [key(m)] }) as const),
          ...dep.markets.map((m) => ({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "market", args: [key(m)] }) as const),
          { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "totalAssets" } as const,
        ],
      });
      break;
    } catch {
      // the upstream RPC hiccuped; try again
    }
  }
  return () => {
    anvil.kill();
  };
}
