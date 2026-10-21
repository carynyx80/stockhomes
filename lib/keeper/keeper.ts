import { stringToHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { KEEPER, ORACLE_MARKETS } from "@/config/oracle";
import type { ExchangeDeployment } from "@/config/exchange";
import { priceOracleAbi, stoxhomesPerpsAbi } from "@/lib/exchange/abis";
import { marketPriceAt, nextPost, toOracleUnits, type Observation } from "@/lib/oracle/price";

/**
 * The exchange keeper: posts oracle prices and liquidates under-margined positions.
 * `wallet` null = dry run: everything is computed and reported, nothing is sent.
 */

export const marketKey = (id: string): Hex => stringToHex(id, { size: 32 });

export type KeeperReport = {
  chainTime: number;
  prices: { market: string; onChain: string; target: string; posted: string | null; reason: string }[];
  priceTx: Hex | null;
  scanned: number;
  liquidations: { id: string; tx: Hex | null }[];
  log: string[];
};

export type KeeperDeps = {
  client: PublicClient;
  wallet: WalletClient | null;
  account: Address;
  deployment: ExchangeDeployment;
  /** Monthly readings per market id (fetched by the caller, so they can be cached). */
  observations: Record<string, Observation[]>;
};

export async function runKeeper(d: KeeperDeps): Promise<KeeperReport> {
  const log: string[] = [];
  const block = await d.client.getBlock();
  // Chain time, not the server clock: heartbeats and glide targets must agree with what the contracts see.
  const chainTime = Number(block.timestamp);
  const report: KeeperReport = { chainTime, prices: [], priceTx: null, scanned: 0, liquidations: [], log };

  // ---- 1. Prices
  const toPost: { key: Hex; price: bigint }[] = [];
  for (const id of d.deployment.markets) {
    const m = ORACLE_MARKETS.find((x) => x.id === id);
    const obs = d.observations[id];
    if (!m || !obs?.length) {
      report.prices.push({ market: id, onChain: "?", target: "?", posted: null, reason: "no price source" });
      continue;
    }
    const target = toOracleUnits(marketPriceAt(m, obs, chainTime * 1000));
    const [onChain, updatedAt] = (await d.client.readContract({
      address: d.deployment.oracle,
      abi: priceOracleAbi,
      functionName: "feeds",
      args: [marketKey(id)],
    })) as unknown as [bigint, bigint, number, number, boolean];
    const next = nextPost(onChain, target, KEEPER.maxStepBps);
    const changeBps = onChain === 0n ? 10_000n : ((next > onChain ? next - onChain : onChain - next) * 10_000n) / onChain;
    const stale = chainTime - Number(updatedAt) >= KEEPER.heartbeatSeconds;
    const move = changeBps >= BigInt(KEEPER.minChangeBps);
    const reason = move ? `moves ${Number(changeBps) / 100}%` : stale ? "heartbeat" : "unchanged";
    report.prices.push({ market: id, onChain: onChain.toString(), target: target.toString(), posted: move || stale ? next.toString() : null, reason });
    if (move || stale) toPost.push({ key: marketKey(id), price: next });
  }

  if (toPost.length) {
    const args = [toPost.map((p) => p.key), toPost.map((p) => p.price)] as const;
    // Simulate first: a rejected post (deviation, not a publisher) is reported, not sent.
    await d.client.simulateContract({ account: d.account, address: d.deployment.oracle, abi: priceOracleAbi, functionName: "post", args });
    if (d.wallet) {
      const hash = await d.wallet.writeContract({
        account: d.account,
        chain: d.wallet.chain,
        address: d.deployment.oracle,
        abi: priceOracleAbi,
        functionName: "post",
        args,
      });
      const r = await d.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (r.status !== "success") throw new Error(`price post reverted: ${hash}`);
      report.priceTx = hash;
      log.push(`Posted ${toPost.length} price(s) in ${hash}.`);
    } else {
      log.push(`Dry run: would post ${toPost.length} price(s).`);
    }
  } else {
    log.push("Prices unchanged and fresh; nothing to post.");
  }

  // ---- 2. Liquidations
  const count = Number(await d.client.readContract({ address: d.deployment.perps, abi: stoxhomesPerpsAbi, functionName: "openPositionCount" }));
  for (let offset = 0; offset < count; offset += KEEPER.liquidationPageSize) {
    const ids = (await d.client.readContract({
      address: d.deployment.perps,
      abi: stoxhomesPerpsAbi,
      functionName: "openPositionIds",
      args: [BigInt(offset), BigInt(KEEPER.liquidationPageSize)],
    })) as readonly bigint[];
    for (const id of ids) {
      report.scanned++;
      try {
        await d.client.simulateContract({ account: d.account, address: d.deployment.perps, abi: stoxhomesPerpsAbi, functionName: "liquidate", args: [id] });
      } catch {
        continue; // not liquidatable (the usual case)
      }
      if (!d.wallet) {
        report.liquidations.push({ id: id.toString(), tx: null });
        log.push(`Dry run: would liquidate #${id}.`);
        continue;
      }
      const hash = await d.wallet.writeContract({
        account: d.account,
        chain: d.wallet.chain,
        address: d.deployment.perps,
        abi: stoxhomesPerpsAbi,
        functionName: "liquidate",
        args: [id],
      });
      await d.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      report.liquidations.push({ id: id.toString(), tx: hash });
      log.push(`Liquidated #${id} in ${hash}.`);
    }
  }
  log.push(`Scanned ${report.scanned} open position(s).`);
  return report;
}
