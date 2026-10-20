import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, zeroAddress, type Hex } from "viem";
import { universalRouterAbi } from "@/lib/abis";
import { encodeEthToTokenSwap, poolKeyFor } from "./v4";

const TOKEN = "0x2aCAD33eb2Ef947A32Bf2c045a328054aF4F5803";
const HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";

describe("Universal Router v4 swap encoding", () => {
  it("sorts native ETH first, like the Pons factory", () => {
    const k = poolKeyFor(zeroAddress, TOKEN, 0, 200, HOOK);
    expect(k.currency0).toBe(zeroAddress);
    expect(k.currency1).toBe(TOKEN);
  });

  it("encodes V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL and the 2.1.2 param layout", () => {
    const key = poolKeyFor(zeroAddress, TOKEN, 0, 200, HOOK);
    const data = encodeEthToTokenSwap(key, 123n, 456n, 999n);
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data });
    const [commands, inputs, deadline] = args as [Hex, Hex[], bigint];
    expect(commands).toBe("0x10");
    expect(deadline).toBe(999n);

    const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
    expect(actions).toBe("0x060c0f");

    const [swap] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              name: "poolKey",
              type: "tuple",
              components: [
                { name: "currency0", type: "address" },
                { name: "currency1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickSpacing", type: "int24" },
                { name: "hooks", type: "address" },
              ],
            },
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            { name: "minHopPriceX36", type: "uint256" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      params[0],
    );
    expect(swap).toMatchObject({ zeroForOne: true, amountIn: 123n, amountOutMinimum: 456n, minHopPriceX36: 0n, hookData: "0x" });
    expect(swap.poolKey.tickSpacing).toBe(200);
    expect(swap.poolKey.hooks.toLowerCase()).toBe(HOOK);

    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[1])).toEqual([zeroAddress, 123n]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[2])).toEqual([TOKEN, 456n]);
  });

  it("refuses a pool that isn't ETH-paired", () => {
    const key = poolKeyFor("0x0000000000000000000000000000000000000001", TOKEN, 0, 200, HOOK);
    expect(() => encodeEthToTokenSwap(key, 1n, 1n, 1n)).toThrow();
  });
});
