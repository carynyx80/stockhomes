/**
 * Full claim → swap → burn against a local Anvil fork of Robinhood Chain mainnet, on a real graduated Pons V2 token.
 *
 *   FORK=1 RPC_URL_MAINNET=<archive-capable mainnet RPC> npx vitest run test/fork
 *
 * Needs `anvil` (Foundry) on PATH. Everything happens on the local fork: nothing touches the real chain.
 * Setup on the fork: the token's real fee recipient (impersonated) hands fees to Anvil's dev account #0 via
 * factory.transferCreatorFeeRecipient, and the escrow is funded through its permissionless credit().
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";
import { BOT, CONTRACTS } from "@/config/stoxhomes";
import { erc20Abi, ponsEscrowAbi, ponsFactoryAbi } from "@/lib/abis";
import { memoryStore } from "@/lib/bot/memory-store";

const enabled = process.env.FORK === "1" && spawnSync("anvil", ["--version"]).status === 0;
const UPSTREAM = process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com";
const TOKEN = (process.env.SAMPLE_TOKEN ?? "0x7F1D6332901622e1eA5728D12Bf866D5d1e1b6a8") as Address;
const PORT = 8547;
const FORK_URL = `http://127.0.0.1:${PORT}`;
// Anvil's well-known dev account #0. Exists only on local test chains.
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const C = CONTRACTS.mainnet!;

describe.skipIf(!enabled)("fork: claim → swap → burn on a real Pons V2 token", { timeout: 600_000 }, () => {
  let anvil: ChildProcess;
  let client: PublicClient;
  const dev = privateKeyToAccount(DEV_KEY);

  beforeAll(async () => {
    // Throttled with retries: the public RPC rate-limits hard.
    anvil = spawn(
      "anvil",
      ["--fork-url", UPSTREAM, "--port", String(PORT), "--silent", "--retries", "15", "--fork-retry-backoff", "1500", "--compute-units-per-second", "60"],
      { stdio: "ignore" },
    );
    client = createPublicClient({ chain: robinhood, transport: http(FORK_URL) }) as PublicClient;
    for (let i = 0; i < 60; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Point the app's env at the fork, with the dev key as the payout wallet.
    Object.assign(process.env, {
      NETWORK: "mainnet",
      RPC_URL_MAINNET: FORK_URL,
      TOKEN_ADDRESS: TOKEN,
      CREATOR_PRIVATE_KEY: DEV_KEY,
      DRY_RUN: "false",
    });
    // In-memory store and lock for the test, whatever the shell has configured.
    for (const k of ["DATABASE_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "TELEGRAM_BOT_TOKEN", "PAYOUT_WALLET_ADDRESS"]) {
      delete process.env[k];
    }

    const test = createTestClient({ chain: robinhood, mode: "anvil", transport: http(FORK_URL) });
    const launch = await client.readContract({ address: C.ponsFactory, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [TOKEN] });
    const owner = launch.creatorFeeRecipient;
    await test.impersonateAccount({ address: owner });
    await test.setBalance({ address: owner, value: parseEther("1") });
    const asOwner = createWalletClient({ account: owner, chain: robinhood, transport: http(FORK_URL) });
    const h1 = await asOwner.writeContract({
      address: C.ponsFactory,
      abi: parseAbi(["function transferCreatorFeeRecipient(address token, address newRecipient)"]),
      functionName: "transferCreatorFeeRecipient",
      args: [TOKEN, dev.address],
    });
    await client.waitForTransactionReceipt({ hash: h1 });
    await test.stopImpersonatingAccount({ address: owner });

    // Put 0.2 ETH (~$480) of creator fees in the escrow for the dev wallet.
    const devWallet = createWalletClient({ account: dev, chain: robinhood, transport: http(FORK_URL) });
    const h2 = await devWallet.writeContract({
      address: C.ponsFeeEscrow,
      abi: parseAbi(["function credit(address recipient) payable"]),
      functionName: "credit",
      args: [dev.address],
      value: parseEther("0.2"),
    });
    await client.waitForTransactionReceipt({ hash: h2 });
  });

  afterAll(() => {
    anvil?.kill();
  });

  it("burns exactly the tokens it bought, with 20% of exactly what it claimed", async () => {
    const dead = BOT.deadAddress as Address;
    const deadBefore = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [dead] });
    const escrowBefore = await client.readContract({ address: C.ponsFeeEscrow, abi: ponsEscrowAbi, functionName: "balanceOf", args: [dev.address] });
    expect(escrowBefore).toBe(parseEther("0.2"));

    // Import after env is set, so lib/chain and lib/env read the fork settings.
    // The real live chain adapter and engine; only the store, lock and alerts are in-memory.
    const { liveChain } = await import("@/lib/bot/live");
    const { publicClient } = await import("@/lib/chain");
    const { runOnce } = await import("@/lib/bot/engine");
    const { memoryLock } = await import("@/lib/bot/lock");
    const store = memoryStore();
    const deps = { chain: liveChain(publicClient(), C, TOKEN), store, lock: memoryLock(), alerts: { send: async () => {} } };
    const result = await runOnce(deps, {
      network: "mainnet-fork",
      dryRun: false,
      thresholdUsd: 100,
      burnShareBps: 2000,
      maxSlippageBps: 200,
      maxGasShareBps: 500,
      minGasWei: parseEther("0.002"),
      startBlock: null,
      txWaitMs: 30_000,
    });
    if (process.env.FORK_VERBOSE) console.log(result.log.join("\n"));
    expect(result.outcome, result.log.join("\n")).toBe("burned");

    const escrowAfter = await client.readContract({ address: C.ponsFeeEscrow, abi: ponsEscrowAbi, functionName: "balanceOf", args: [dev.address] });
    expect(escrowAfter).toBe(0n);

    expect(await store.openObligations()).toEqual([]); // nothing left owed

    const deadAfter = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [dead] });
    const devLeft = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [dev.address] });
    const [o] = store.all();
    expect(o.owedAmount).toBe(parseEther("0.04")); // 20% of the 0.2 ETH claimed
    expect(o.tokensBought! > 0n).toBe(true);
    expect(deadAfter - deadBefore).toBe(o.tokensBought); // dead address up by exactly the bought amount
    expect(o.burnedAmount).toBe(o.tokensBought);
    expect(devLeft).toBe(0n);
    if (process.env.FORK_VERBOSE) console.log({ deadBefore, deadAfter, delta: deadAfter - deadBefore, tokensBought: o.tokensBought, owedWei: o.owedAmount });
  });
});
