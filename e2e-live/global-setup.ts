import { spawn, spawnSync } from "node:child_process";

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
  // Warm the fork: the first reads pull contract state from the real testnet.
  const call = (to: string, data: string) =>
    fetch(`http://127.0.0.1:${PORT}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) }).catch(() => null);
  const ORACLE = "0x7ddbbe04dD07e8765F21eE30a5281D7100aE3159";
  const NYC = "6e79630000000000000000000000000000000000000000000000000000000000";
  await call(ORACLE, `0x8d4c1a8e${NYC}`); // lastPrice(bytes32) selector is irrelevant for warming; any call pulls the code
  await fetch("http://localhost:3400/api/exchange/history?market=nyc&range=1D").catch(() => null);
  return () => {
    anvil.kill();
  };
}
