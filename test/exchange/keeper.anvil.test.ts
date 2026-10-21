/**
 * The keeper against the real contracts on a throwaway local Anvil chain (chain id 31337, so the real testnet
 * broadcast records are never touched).   ANVIL=1 npx vitest run test/exchange
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ExchangeDeployment } from "@/config/exchange";
import { priceOracleAbi, stoxhomesPerpsAbi, testUSDGAbi } from "@/lib/exchange/abis";
import { marketKey, runKeeper } from "@/lib/keeper/keeper";
import type { Observation } from "@/lib/oracle/price";

const enabled = process.env.ANVIL === "1" && spawnSync("anvil", ["--version"]).status === 0;
const PORT = 8561;
const RPC = `http://127.0.0.1:${PORT}`;
// Anvil's public dev accounts #0 (deployer/publisher) and #1 (trader). Local test chain only.
const K0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const K1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

// Flat readings: target = anchor (782,000 for New York). `obsAt(x)` adds a later reading at x% of the anchor.
const flat: Observation[] = [{ month: "2025-01", value: 100 }];
const obsAt = (pct: number): Observation[] => [...flat, { month: "2025-02", value: pct }];

describe.skipIf(!enabled)("keeper on a local chain", { timeout: 180_000 }, () => {
  let anvil: ChildProcess;
  let client: PublicClient;
  let dep: ExchangeDeployment;
  const keeper = privateKeyToAccount(K0);
  const trader = privateKeyToAccount(K1);

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    client = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
    for (let i = 0; i < 50; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "--private-key", K0], {
      cwd: "contracts",
      env: { ...process.env, INITIAL_PRICES: "78200000000000,59400000000000,96100000000000,52100000000000", SEED_VAULT_USDG: "500000" },
      stdio: "ignore",
    });
    const run = JSON.parse(readFileSync("contracts/broadcast/Deploy.s.sol/31337/run-latest.json", "utf8")) as {
      transactions: { contractName: string; contractAddress: Address; transactionType: string }[];
    };
    const addr = (name: string) => run.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === name)!.contractAddress;
    dep = { chainId: 31337, usdg: addr("TestUSDG"), usdgHasFaucet: true, oracle: addr("PriceOracle"), vault: addr("StoxhomesVault"), perps: addr("StoxhomesPerps"), fromBlock: 0n, markets: ["nyc", "mia", "lax", "lon"] };
  });

  afterAll(() => anvil?.kill());

  const wallet = (k: `0x${string}` = K0) => createWalletClient({ account: privateKeyToAccount(k), chain, transport: http(RPC) });
  const nycPrice = async () => ((await client.readContract({ address: dep.oracle, abi: priceOracleAbi, functionName: "feeds", args: [marketKey("nyc")] })) as unknown as bigint[])[0];
  const observations = (nyc: Observation[]) => ({ nyc, mia: flat, lax: flat, lon: flat });

  it("dry run computes the walk but sends nothing", async () => {
    const before = await nycPrice();
    const r = await runKeeper({ client, wallet: null, account: keeper.address, deployment: dep, observations: observations(obsAt(103)) });
    expect(r.prices.find((p) => p.market === "nyc")?.posted).toBe(((before * 10_090n) / 10_000n).toString());
    expect(r.priceTx).toBeNull();
    expect(await nycPrice()).toBe(before);
  });

  it("posts, walking toward a 3% move in 0.9% steps, and leaves unchanged markets alone", async () => {
    const before = await nycPrice();
    const r = await runKeeper({ client, wallet: wallet(), account: keeper.address, deployment: dep, observations: observations(obsAt(103)) });
    expect(r.priceTx).toMatch(/^0x/);
    expect(await nycPrice()).toBe(before + (before * 90n) / 10_000n);
    expect(r.prices.filter((p) => p.posted).map((p) => p.market)).toEqual(["nyc"]);
  });

  it("liquidates a position the move puts under maintenance, in the same run", async () => {
    // Trader: faucet, approve, open a 100x New York long (liquidation 0.5% below entry).
    const t = wallet(K1);
    await client.waitForTransactionReceipt({ hash: await t.writeContract({ address: dep.usdg, abi: testUSDGAbi, functionName: "faucet" }) });
    await client.waitForTransactionReceipt({ hash: await t.writeContract({ address: dep.usdg, abi: testUSDGAbi, functionName: "approve", args: [dep.perps, 10n ** 12n] }) });
    await client.waitForTransactionReceipt({
      hash: await t.writeContract({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "open", args: [marketKey("nyc"), true, 100_000_000n, 100n, 2n ** 255n] }),
    });
    const [id] = (await client.readContract({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "positionsOf", args: [trader.address] })) as readonly bigint[];
    expect(id).toBeGreaterThan(0n);

    // The index now says −2%: the keeper posts −0.9%, then finds and liquidates the position.
    const r = await runKeeper({ client, wallet: wallet(), account: keeper.address, deployment: dep, observations: observations(obsAt(98)) });
    expect(r.scanned).toBe(1);
    expect(r.liquidations.map((l) => l.id)).toEqual([id.toString()]);
    expect(((await client.readContract({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "positionsOf", args: [trader.address] })) as readonly bigint[]).length).toBe(0);
  });
});
