import { describe, expect, it } from "vitest";
import { createPublicClient, http, parseEther, zeroAddress, type Address } from "viem";
import { robinhood } from "viem/chains";
import { CONTRACTS } from "@/config/stoxhomes";
import { chainlinkAbi, ponsFactoryAbi, v4QuoterAbi } from "@/lib/abis";
import { minOutAfterSlippage } from "./math";
import { encodeEthToTokenSwap, poolKeyFor } from "./v4";

/**
 * Read-only checks against Robinhood Chain mainnet: real quoter, real router, real Pons hook.
 * Nothing is signed or sent; the swap is an eth_call from a throwaway address given 1 ETH by state override.
 *   MAINNET_READS=1 npx vitest run lib/bot/mainnet.read.test.ts
 * SAMPLE_TOKEN: any graduated, ETH-paired Pons V2 token (default: one that graduated on 2026-10-20).
 */
const enabled = process.env.MAINNET_READS === "1";
const TOKEN = (process.env.SAMPLE_TOKEN ?? "0x7F1D6332901622e1eA5728D12Bf866D5d1e1b6a8") as Address;
const C = CONTRACTS.mainnet!;
const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com", { retryCount: 6, retryDelay: 1500 }),
});
const FROM = "0x000000000000000000000000000000000000c0de" as Address;

describe.skipIf(!enabled)("mainnet reads (no transactions)", { timeout: 90_000 }, () => {
  it("reads a live ETH/USD price", async () => {
    const [, answer, , updatedAt] = await client.readContract({ address: C.chainlinkEthUsd, abi: chainlinkAbi, functionName: "latestRoundData" });
    expect(answer > 100n * 10n ** 8n).toBe(true);
    expect(Date.now() / 1000 - Number(updatedAt)).toBeLessThan(3 * 3600);
  });

  it("quotes and simulates our exact swap calldata through Universal Router 2.1.2 and the Pons hook", async () => {
    const l = await client.readContract({ address: C.ponsFactory, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [TOKEN] });
    expect(l.exists && l.phase === 2 && l.pairToken === zeroAddress).toBe(true);
    const key = poolKeyFor(l.pairToken, TOKEN, l.poolFee, l.tickSpacing, C.ponsMemeHook);

    const amountIn = parseEther("0.001");
    const { result } = await client.simulateContract({
      address: C.uniswapV4Quoter,
      abi: v4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: key, zeroForOne: true, exactAmount: amountIn, hookData: "0x" }],
    });
    const quoted = result[0];
    expect(quoted > 0n).toBe(true);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const call = (minOut: bigint) =>
      client.call({
        account: FROM,
        to: C.uniswapUniversalRouter,
        data: encodeEthToTokenSwap(key, amountIn, minOut, deadline),
        value: amountIn,
        stateOverride: [{ address: FROM, balance: parseEther("1") }],
      });

    await expect(call(minOutAfterSlippage(quoted, 200))).resolves.toBeDefined();
    // Asking for more than the pool gives must revert (V4TooLittleReceived): the minimum is enforced.
    await expect(call((quoted * 105n) / 100n)).rejects.toThrow();
  });
});
