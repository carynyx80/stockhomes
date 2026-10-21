import { stringToHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { KEEPER, type OracleMarket } from "@/config/oracle";
import type { ExchangeDeployment } from "@/config/exchange";
import { priceOracleAbi, stoxhomesPerpsAbi } from "@/lib/exchange/abis";
import { marketPriceAt, nextPost, toOracleUnits, type Observation } from "@/lib/oracle/price";

/**
 * The exchange keeper. Each run:
 *   1. posts oracle prices (batched),
 *   2. fills resting limit/stop orders whose trigger the new prices reached,
 *   3. closes positions whose take-profit or stop-loss was reached,
 *   4. liquidates under-margined positions.
 * Prices only change when the keeper posts, so running 2–4 right after 1 never misses a fill.
 * Every action is simulated first; `wallet` null = dry run: everything is computed and reported, nothing is sent.
 */

export const marketKey = (id: string): Hex => stringToHex(id, { size: 32 });

/** Markets per price transaction. */
const POST_CHUNK = 50;

type Action = { kind: "order" | "trigger" | "liquidation"; id: string; tx: Hex | null };

export type KeeperReport = {
  chainTime: number;
  prices: { market: string; onChain: string; target: string; posted: string | null; reason: string }[];
  priceTxs: Hex[];
  scanned: number;
  scannedOrders: number;
  actions: Action[];
  /** Kept for callers of the first version: liquidations only. */
  liquidations: { id: string; tx: Hex | null }[];
  log: string[];
};

export type KeeperDeps = {
  client: PublicClient;
  wallet: WalletClient | null;
  account: Address;
  deployment: ExchangeDeployment;
  /** Price model per market id. */
  markets: OracleMarket[];
  /** Monthly readings per market id (fetched by the caller, so they can be cached). */
  observations: Record<string, Observation[]>;
};

type PositionView = { owner: Address; market: Hex; isLong: boolean; collateral: bigint; size: bigint; entryPrice: bigint; takeProfit: bigint; stopLoss: bigint };
type OrderView = { owner: Address; market: Hex; isLong: boolean; triggerAbove: boolean; triggerPrice: bigint };

export async function runKeeper(d: KeeperDeps): Promise<KeeperReport> {
  const log: string[] = [];
  const block = await d.client.getBlock();
  // Chain time, not the server clock: heartbeats and glide targets must agree with what the contracts see.
  const chainTime = Number(block.timestamp);
  const report: KeeperReport = { chainTime, prices: [], priceTxs: [], scanned: 0, scannedOrders: 0, actions: [], liquidations: [], log };
  const perps = { address: d.deployment.perps, abi: stoxhomesPerpsAbi } as const;

  /** Multicall where the chain has Multicall3 (Robinhood Chain does), else plain parallel reads (a bare Anvil). */
  async function readMany<T>(contracts: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }[]): Promise<T[]> {
    if (d.client.chain?.contracts?.multicall3) return (await d.client.multicall({ allowFailure: false, contracts: contracts as never })) as T[];
    return Promise.all(contracts.map((c) => d.client.readContract(c as Parameters<PublicClient["readContract"]>[0]) as Promise<T>));
  }

  async function send(functionName: string, address: Address, abi: readonly unknown[], args: readonly unknown[]): Promise<Hex | null> {
    const call = { account: d.account, address, abi, functionName, args };
    await d.client.simulateContract(call as Parameters<PublicClient["simulateContract"]>[0]);
    if (!d.wallet) return null;
    // Headroom over the estimate: liquidations and closes delete storage, and the refund makes a bare estimate run out of gas.
    const gas = ((await d.client.estimateContractGas(call as Parameters<PublicClient["estimateContractGas"]>[0])) * 13n) / 10n;
    // The wallet's own (local) account signs here; a bare address would ask the RPC node to sign, which public nodes refuse.
    const account = d.wallet.account ?? d.account;
    const hash = await d.wallet.writeContract({ account, chain: d.wallet.chain, address, abi, functionName, args, gas } as Parameters<WalletClient["writeContract"]>[0]);
    const r = await d.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return hash;
  }

  // ---- 1. Prices
  const ids = d.deployment.markets;
  const feeds = await readMany<[bigint, bigint, number, number, boolean]>(
    ids.map((id) => ({ address: d.deployment.oracle, abi: priceOracleAbi, functionName: "feeds", args: [marketKey(id)] })),
  );
  const price: Record<string, bigint> = {};
  const toPost: { key: Hex; price: bigint }[] = [];
  ids.forEach((id, i) => {
    const [onChain, updatedAt] = feeds[i];
    price[id] = onChain;
    const m = d.markets.find((x) => x.id === id);
    const obs = d.observations[id];
    if (!m || !obs?.length) {
      report.prices.push({ market: id, onChain: onChain.toString(), target: "?", posted: null, reason: "no price source" });
      return;
    }
    const target = toOracleUnits(marketPriceAt(m, obs, chainTime * 1000));
    const next = nextPost(onChain, target, KEEPER.maxStepBps);
    const changeBps = onChain === 0n ? 10_000n : ((next > onChain ? next - onChain : onChain - next) * 10_000n) / onChain;
    const stale = chainTime - Number(updatedAt) >= KEEPER.heartbeatSeconds;
    const move = changeBps >= BigInt(KEEPER.minChangeBps);
    const reason = move ? `moves ${Number(changeBps) / 100}%` : stale ? "heartbeat" : "unchanged";
    report.prices.push({ market: id, onChain: onChain.toString(), target: target.toString(), posted: move || stale ? next.toString() : null, reason });
    if (move || stale) {
      toPost.push({ key: marketKey(id), price: next });
      price[id] = next;
    }
  });

  for (let i = 0; i < toPost.length; i += POST_CHUNK) {
    const chunk = toPost.slice(i, i + POST_CHUNK);
    // Simulated first: a rejected post (deviation, not a publisher) throws and is reported, not sent.
    const hash = await send("post", d.deployment.oracle, priceOracleAbi, [chunk.map((p) => p.key), chunk.map((p) => p.price)]);
    if (hash) report.priceTxs.push(hash);
  }
  log.push(toPost.length ? (d.wallet ? `Posted ${toPost.length} price(s) in ${report.priceTxs.length} transaction(s).` : `Dry run: would post ${toPost.length} price(s).`) : "Prices unchanged and fresh; nothing to post.");

  const priceByKey = new Map(ids.map((id) => [marketKey(id).toLowerCase(), price[id]]));
  const priceOfKey = (k: Hex) => priceByKey.get(k.toLowerCase()) ?? 0n;
  let budget: number = KEEPER.maxActionsPerRun;

  async function act(kind: Action["kind"], id: bigint, functionName: string) {
    if (budget <= 0) return;
    try {
      // In a dry run the posts weren't sent, so a simulation would still see the old prices: report the candidate.
      const tx = d.wallet ? await send(functionName, perps.address, perps.abi, [id]) : null;
      budget--;
      report.actions.push({ kind, id: id.toString(), tx });
      if (kind === "liquidation") report.liquidations.push({ id: id.toString(), tx });
      log.push(`${d.wallet ? "" : "Dry run: would "}${kind === "order" ? "fill order" : kind === "trigger" ? "close (TP/SL)" : "liquidate"} #${id}${tx ? ` in ${tx}` : ""}.`);
    } catch {
      // Not executable after all (hold time, open-interest cap, margin): left for the next run.
    }
  }

  async function page<T>(countFn: string, idsFn: string, viewFn: string): Promise<{ id: bigint; v: T }[]> {
    const count = Number(await d.client.readContract({ ...perps, functionName: countFn } as Parameters<PublicClient["readContract"]>[0]));
    const out: { id: bigint; v: T }[] = [];
    for (let offset = 0; offset < count; offset += KEEPER.pageSize) {
      const pageIds = (await d.client.readContract({ ...perps, functionName: idsFn, args: [BigInt(offset), BigInt(KEEPER.pageSize)] } as Parameters<PublicClient["readContract"]>[0])) as readonly bigint[];
      if (!pageIds.length) break;
      const views = await readMany<T>(pageIds.map((id) => ({ ...perps, functionName: viewFn, args: [id] })));
      pageIds.forEach((id, i) => out.push({ id, v: views[i] }));
    }
    return out;
  }

  // ---- 2. Resting orders
  const orders = await page<OrderView>("openOrderCount", "openOrderIds", "order");
  report.scannedOrders = orders.length;
  for (const { id, v } of orders) {
    const p = priceOfKey(v.market);
    if (p > 0n && (v.triggerAbove ? p >= v.triggerPrice : p <= v.triggerPrice)) await act("order", id, "executeOrder");
  }

  // ---- 3 & 4. Positions: take-profit / stop-loss, then liquidations
  const positions = await page<PositionView>("openPositionCount", "openPositionIds", "position");
  report.scanned = positions.length;
  const keys = [...new Set(positions.map((p) => p.v.market.toLowerCase() as Hex))];
  const params = await readMany<{ p: { maintenanceBps: number } }>(keys.map((k) => ({ ...perps, functionName: "market", args: [k] })));
  const maintenance = new Map(keys.map((k, i) => [k, BigInt(params[i].p.maintenanceBps)]));
  for (const { id, v } of positions) {
    const p = priceOfKey(v.market);
    if (p === 0n) continue;
    const tp = v.takeProfit > 0n && (v.isLong ? p >= v.takeProfit : p <= v.takeProfit);
    const sl = v.stopLoss > 0n && (v.isLong ? p <= v.stopLoss : p >= v.stopLoss);
    if (tp || sl) {
      await act("trigger", id, "executeTriggers");
      continue;
    }
    // Near or past the liquidation price (borrow fees pull it in slowly): let the contract decide.
    const mm = (v.size * (maintenance.get(v.market.toLowerCase() as Hex) ?? 50n)) / 10_000n;
    const cushion = v.collateral > mm ? v.collateral - mm : 0n;
    const distance = (v.entryPrice * cushion) / v.size;
    const liq = v.isLong ? v.entryPrice - distance : v.entryPrice + distance;
    const slack = (liq * 30n) / 10_000n; // 0.3%
    if (v.isLong ? p <= liq + slack : p >= liq - slack) await act("liquidation", id, "liquidate");
  }

  log.push(`Scanned ${report.scannedOrders} order(s) and ${report.scanned} open position(s).`);
  if (budget <= 0) log.push("Action limit reached; the rest wait for the next run.");
  return report;
}
