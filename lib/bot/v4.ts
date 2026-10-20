import { encodeAbiParameters, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { universalRouterAbi } from "@/lib/abis";

/**
 * Uniswap v4 swap calldata for Universal Router 2.1.2, built from its verified source:
 *   command V4_SWAP (0x10) → actions SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f).
 * Native ETH is settled from msg.value; bought tokens go to the caller.
 */

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export const COMMAND_V4_SWAP = 0x10;
export const ACTION = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;

const POOL_KEY = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

/** Sorted the way v4 (and PonsV2LaunchFactory) sorts currencies. */
export function poolKeyFor(pairToken: Address, token: Address, fee: number, tickSpacing: number, hook: Address): PoolKey {
  const [currency0, currency1] = BigInt(pairToken) < BigInt(token) ? [pairToken, token] : [token, pairToken];
  return { currency0, currency1, fee, tickSpacing, hooks: hook };
}

const MAX_UINT128 = (1n << 128n) - 1n;

export function encodeEthToTokenSwap(key: PoolKey, amountIn: bigint, minOut: bigint, deadline: bigint): Hex {
  if (key.currency0 !== zeroAddress) throw new Error("expected native ETH as currency0");
  if (amountIn <= 0n || amountIn > MAX_UINT128 || minOut < 0n || minOut > MAX_UINT128) throw new Error("amount out of range");

  const actions = `0x${[ACTION.SWAP_EXACT_IN_SINGLE, ACTION.SETTLE_ALL, ACTION.TAKE_ALL]
    .map((a) => a.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const swap = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { ...POOL_KEY, name: "poolKey" },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "minHopPriceX36", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne: true, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key.currency0, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key.currency1, minOut]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swap, settle, take]]);

  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [`0x${COMMAND_V4_SWAP.toString(16)}` as Hex, [input], deadline],
  });
}
