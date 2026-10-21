import "server-only";
import { EXCHANGE } from "@/config/exchange";
import { priceOracleAbi } from "@/lib/exchange/abis";
import { marketKey } from "@/lib/keeper/keeper";
import { readClient } from "@/lib/keeper/setup";

/** When the market's price was last posted on-chain: history never runs past it, so it can't leak the next post. */
export async function lastPostedAt(id: string): Promise<number> {
  const dep = EXCHANGE.testnet;
  if (!dep) return Date.now();
  try {
    const [, updatedAt] = (await readClient().readContract({ address: dep.oracle, abi: priceOracleAbi, functionName: "lastPrice", args: [marketKey(id)] })) as readonly [bigint, bigint];
    return updatedAt > 0n ? Number(updatedAt) * 1000 : Date.now();
  } catch {
    return Date.now() - 60_000;
  }
}

/** Last on-chain post time for every market, in one multicall (ms; now if unknown). */
export async function lastPostedAll(ids: string[]): Promise<Record<string, number>> {
  const dep = EXCHANGE.testnet;
  const now = Date.now();
  if (!dep) return Object.fromEntries(ids.map((id) => [id, now]));
  try {
    const rows = (await readClient().multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: dep.oracle, abi: priceOracleAbi, functionName: "lastPrice", args: [marketKey(id)] }) as const),
    })) as readonly (readonly [bigint, bigint])[];
    return Object.fromEntries(ids.map((id, i) => [id, rows[i][1] > 0n ? Number(rows[i][1]) * 1000 : now]));
  } catch {
    return Object.fromEntries(ids.map((id) => [id, now - 60_000]));
  }
}
