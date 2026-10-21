import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createPublicClient,
  decodeEventLog,
  http,
  maxUint256,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { SIMULATED } from "@/config/stoxhomes";
import { UI_SLIPPAGE_BPS, type ExchangeDeployment } from "@/config/exchange";
import { priceOracleAbi, stoxhomesPerpsAbi, stoxhomesVaultAbi, testUSDGAbi } from "@/lib/exchange/abis";
import { BrowserWallet } from "@/lib/exchange/wallet";
import { feeOf } from "@/lib/perp/math";
import { EXCHANGE_MARKETS } from "@/lib/sim/markets";
import { createSimulatedSource } from "./simulated";
import type {
  Account,
  ClosedTrade,
  DataSource,
  HistoryRange,
  OpenPositionRequest,
  OrderRequest,
  Position,
  PricePoint,
  Quote,
  RestingOrder,
  Snapshot,
  VaultHolding,
  VaultStats,
} from "./types";

/**
 * The on-chain DataSource: the Stoxhomes contracts (PriceOracle, StoxhomesVault, StoxhomesPerps) on Robinhood
 * Chain, read with a public client and traded through the visitor's own wallet. Drop-in for the simulated source.
 *
 * Not on-chain (yet): City Wars stays a paper game (delegated to the simulated source).
 */

const POLL_MS = 6_000;
const SHARE_UNIT = 10n ** 12n; // vault shares: 6 asset decimals + 6 offset decimals
const SHARE_SCALE = 10n ** 6n; // shown to the UI in 6-decimal units, like the simulated vault
const LOG_CHUNK = 50_000n;
const key = (id: string): Hex => stringToHex(id, { size: 32 });
/** +30% gas over the estimate. */
export const withHeadroom = (estimate: bigint) => (estimate * 13n) / 10n;

const FRIENDLY: Record<string, string> = {
  HoldTimeNotMet: "Positions must be held at least a minute before closing.",
  SlippageExceeded: "The price moved past your slippage limit. Try again.",
  OpenInterestCap: "This market is at its open-interest limit right now.",
  CollateralTooSmall: `Minimum collateral is ${SIMULATED.minCollateralUsdg}.`,
  BadLeverage: "That leverage isn't allowed for this market.",
  MarketNotTradable: "This market isn't trading right now.",
  StalePrice: "The price feed is being refreshed. Try again shortly.",
  InsufficientVaultLiquidity: "The Vault can't pay this out right now.",
  NotLiquidatable: "That position isn't liquidatable.",
  FaucetCooldown: "The faucet gives 10,000 tUSDG once a day. Come back tomorrow.",
  ERC20InsufficientBalance: "Not enough balance.",
  ERC4626ExceededMaxWithdraw: "That's more than the Vault can release right now.",
  ERC4626ExceededMaxRedeem: "That's more than the Vault can release right now.",
  EnforcedPause: "Trading is paused. You can still close positions.",
  BadTriggers: "Take-profit must be on the winning side of the price and stop-loss on the losing side.",
  TriggerNotMet: "That order's trigger hasn't been reached yet.",
  TooManyOrders: "You can have at most 25 resting orders. Cancel one first.",
  WouldBreachMargin: "That would leave the position over 100x or too close to liquidation.",
  NoOrder: "That order no longer exists. It may have filled.",
  NoPosition: "Position not found. It may have been closed or liquidated.",
  NotOwner: "That isn't your position.",
};

function friendly(err: unknown): Error {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return new Error("You cancelled in your wallet.");
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && FRIENDLY[name]) return new Error(FRIENDLY[name]);
    if (name) return new Error(`Transaction would fail: ${name}.`);
    return new Error(err.shortMessage);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function createLiveSource(dep: ExchangeDeployment, network: "testnet" | "mainnet", rpc?: string): DataSource {
  const chain: Chain = network === "mainnet" ? robinhood : robinhoodTestnet;
  const client = createPublicClient({ chain, transport: http(rpc ?? chain.rpcUrls.default.http[0], { retryCount: 2 }) }) as PublicClient;
  const wallet = new BrowserWallet(chain);
  const paper = createSimulatedSource(); // City Wars only
  const markets = EXCHANGE_MARKETS.filter((m) => dep.markets.includes(m.id));
  const byKey = new Map(markets.map((m) => [key(m.id).toLowerCase(), m.id]));
  const idOfKey = (k: Hex) => byKey.get(k.toLowerCase()) ?? "?";
  const symbol = dep.usdgHasFaucet ? "tUSDG" : "USDG";

  const listeners = new Set<() => void>();
  let snapshot: Snapshot = emptySnapshot();
  let timer: ReturnType<typeof setInterval> | null = null;
  let change24h: Record<string, number> = {};
  let lastChangeFetch = 0;
  let history: ClosedTrade[] = [];
  let historyFor: string | null = null;
  let lastHistoryFetch = 0;
  let inFlight: Promise<void> | null = null;

  function emptySnapshot(): Snapshot {
    const ps = paper.getSnapshot();
    return {
      now: Date.now(),
      wallet: { available: wallet.state.available, address: wallet.state.address, chainOk: wallet.state.chainId === chain.id },
      quotes: {},
      account: { balance: 0n, positions: [], history: [] },
      vault: { tvl: 0n, sharePrice: 0n, apr7dBps: 0, utilizationBps: 0, openInterestLong: 0n, openInterestShort: 0n },
      vaultHolding: { shares: 0n, costBasis: 0n },
      wars: ps.wars,
    };
  }

  const emit = () => {
    for (const l of listeners) l();
  };

  // ---- cost basis for "Earned" in the Vault (not on-chain; kept per wallet in this browser)
  const basisKey = (a: string) => `stoxhomes:vault-basis:${chain.id}:${a.toLowerCase()}`;
  const readBasis = (a: string) => {
    try {
      return BigInt(localStorage.getItem(basisKey(a)) ?? "0");
    } catch {
      return 0n;
    }
  };
  const writeBasis = (a: string, v: bigint) => {
    try {
      localStorage.setItem(basisKey(a), (v < 0n ? 0n : v).toString());
    } catch {
      // storage blocked: Earned just shows 0
    }
  };

  let longChanges: Record<string, { d30Bps: number; y1Bps: number }> = {};
  async function refreshChange24h() {
    if (Date.now() - lastChangeFetch < 10 * 60_000 && Object.keys(change24h).length) return;
    lastChangeFetch = Date.now();
    try {
      const r = await fetch("/api/exchange/changes");
      const body = (await r.json()) as { changes: Record<string, { d1Bps: number; d30Bps: number; y1Bps: number }> };
      change24h = Object.fromEntries(Object.entries(body.changes).map(([id, c]) => [id, c.d1Bps]));
      longChanges = Object.fromEntries(Object.entries(body.changes).map(([id, c]) => [id, { d30Bps: c.d30Bps, y1Bps: c.y1Bps }]));
    } catch {
      lastChangeFetch = 0; // retry on the next poll
    }
  }

  /** Closed and liquidated positions for the wallet, from contract events. */
  async function refreshHistory(owner: Address) {
    if (historyFor === owner && Date.now() - lastHistoryFetch < 30_000) return;
    lastHistoryFetch = Date.now();
    historyFor = owner;
    const head = await client.getBlockNumber();
    const opened = new Map<string, { market: string; isLong: boolean; collateral: bigint; size: bigint; price: bigint }>();
    const closed: ClosedTrade[] = [];
    const triggered = new Map<string, boolean>(); // position id → take-profit (true) or stop-loss (false)
    for (let from = dep.fromBlock; from <= head; from += LOG_CHUNK) {
      const to = from + LOG_CHUNK - 1n > head ? head : from + LOG_CHUNK - 1n;
      const logs = await client.getLogs({ address: dep.perps, fromBlock: from, toBlock: to });
      for (const log of logs) {
        try {
          const ev = decodeEventLog({ abi: stoxhomesPerpsAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "TriggerExecuted") triggered.set(ev.args.id.toString(), ev.args.takeProfit);
          if (ev.eventName === "PositionDecreased" && ev.args.owner.toLowerCase() === owner.toLowerCase()) {
            const o = opened.get(ev.args.id.toString());
            if (!o) continue;
            const share = (o.collateral * ev.args.sizeDelta) / o.size;
            const fee = feeOf(ev.args.sizeDelta, SIMULATED.openFeeBps);
            closed.push({
              id: `${ev.args.id}-${log.blockNumber}-${log.logIndex}`,
              marketId: o.market,
              side: o.isLong ? "long" : "short",
              leverage: Math.round(Number(o.size) / Number(o.collateral)),
              collateral: share,
              notional: ev.args.sizeDelta,
              entryPrice: o.price,
              exitPrice: ev.args.price,
              realisedPnl: ev.args.paidOut - share - fee,
              closedAt: Number(log.blockNumber),
              reason: "partial",
            });
            o.collateral -= share;
            o.size -= ev.args.sizeDelta;
          }
          if (ev.eventName === "PositionOpened" && ev.args.owner.toLowerCase() === owner.toLowerCase()) {
            opened.set(ev.args.id.toString(), {
              market: idOfKey(ev.args.market),
              isLong: ev.args.isLong,
              collateral: ev.args.collateral,
              size: ev.args.size,
              price: ev.args.price,
            });
          }
          if ((ev.eventName === "PositionClosed" || ev.eventName === "PositionLiquidated") && ev.args.owner.toLowerCase() === owner.toLowerCase()) {
            const o = opened.get(ev.args.id.toString());
            if (!o) continue;
            const block = log.blockNumber;
            closed.push({
              id: ev.args.id.toString(),
              marketId: o.market,
              side: o.isLong ? "long" : "short",
              leverage: o.collateral > 0n ? Math.round(Number(o.size) / Number(o.collateral)) : 0,
              collateral: o.collateral,
              notional: o.size,
              entryPrice: o.price,
              exitPrice: ev.args.price,
              realisedPnl: ev.eventName === "PositionClosed" ? ev.args.paidOut - o.collateral - feeOf(o.size, SIMULATED.openFeeBps) : -(o.collateral + feeOf(o.size, SIMULATED.openFeeBps)),
              closedAt: Number(block), // block number: event logs don't carry timestamps
              reason:
                ev.eventName === "PositionLiquidated"
                  ? "liquidated"
                  : triggered.has(ev.args.id.toString())
                    ? triggered.get(ev.args.id.toString()) ? "take-profit" : "stop-loss"
                    : "closed",
            });
          }
        } catch {
          // not one of ours
        }
      }
    }
    history = closed.reverse().slice(0, 50);
  }

  async function poll() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        void refreshChange24h(); // in the background: prices never wait on it
        const owner = wallet.state.address;
        const base = await client.multicall({
          allowFailure: false,
          contracts: [
            ...markets.map((m) => ({ address: dep.oracle, abi: priceOracleAbi, functionName: "lastPrice", args: [key(m.id)] }) as const),
            ...markets.map((m) => ({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "market", args: [key(m.id)] }) as const),
            { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "totalAssets" } as const,
            { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "convertToAssets", args: [SHARE_UNIT] } as const,
          ],
        });
        const n = markets.length;
        const block = await client.getBlock();
        const at = Number(block.timestamp) * 1000;
        const quotes: Record<string, Quote> = {};
        let oiLong = 0n;
        let oiShort = 0n;
        markets.forEach((m, i) => {
          const [price] = base[i] as readonly [bigint, bigint];
          const mk = base[n + i] as { longSize: bigint; shortSize: bigint };
          oiLong += mk.longSize;
          oiShort += mk.shortSize;
          if (price > 0n) quotes[m.id] = { marketId: m.id, price, change24hBps: change24h[m.id] ?? 0, at };
        });
        const tvl = base[2 * n] as bigint;
        const assetsPerShare = base[2 * n + 1] as bigint;
        const vault: VaultStats = {
          tvl,
          sharePrice: assetsPerShare * 100n, // 6 → 8 decimals
          apr7dBps: 0,
          utilizationBps: tvl > 0n ? Number(((oiLong + oiShort) * 10_000n) / tvl) : 0,
          openInterestLong: oiLong,
          openInterestShort: oiShort,
        };

        let account: Account = { balance: 0n, positions: [], history: [] };
        let holding: VaultHolding = { shares: 0n, costBasis: 0n };
        if (owner) {
          const [bal, shares, ids, orderIdsRaw] = await client.multicall({
            allowFailure: false,
            contracts: [
              { address: dep.usdg, abi: testUSDGAbi, functionName: "balanceOf", args: [owner] },
              { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "balanceOf", args: [owner] },
              { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "positionsOf", args: [owner] },
              { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "ordersOf", args: [owner] },
            ],
          });
          const idList = ids as readonly bigint[];
          const orderIdList = orderIdsRaw as readonly bigint[];
          const orderViews = orderIdList.length
            ? await client.multicall({
                allowFailure: false,
                contracts: orderIdList.map((id) => ({ address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "order", args: [id] }) as const),
              })
            : [];
          const orders: RestingOrder[] = orderIdList.map((id, i) => {
            const o = orderViews[i] as {
              market: Hex;
              isLong: boolean;
              triggerAbove: boolean;
              leverage: number;
              collateral: bigint;
              triggerPrice: bigint;
              takeProfit: bigint;
              stopLoss: bigint;
              createdAt: bigint;
            };
            return {
              id: id.toString(),
              marketId: idOfKey(o.market),
              side: o.isLong ? "long" : "short",
              // A long that waits for a lower price is a limit; one that waits for a higher price is a stop.
              type: o.isLong !== o.triggerAbove ? "limit" : "stop",
              triggerPrice: o.triggerPrice,
              collateral: o.collateral,
              leverage: Number(o.leverage),
              notional: o.collateral * BigInt(o.leverage),
              takeProfit: o.takeProfit > 0n ? o.takeProfit : null,
              stopLoss: o.stopLoss > 0n ? o.stopLoss : null,
              createdAt: Number(o.createdAt) * 1000,
            };
          });
          const details = idList.length
            ? await client.multicall({
                allowFailure: false,
                contracts: idList.flatMap((id) => [
                  { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "position", args: [id] } as const,
                  { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "liquidationPrice", args: [id] } as const,
                ]),
              })
            : [];
          const positions: Position[] = idList.map((id, i) => {
            const p = details[2 * i] as {
              market: Hex;
              isLong: boolean;
              collateral: bigint;
              size: bigint;
              entryPrice: bigint;
              openedAt: bigint;
              takeProfit: bigint;
              stopLoss: bigint;
            };
            return {
              id: id.toString(),
              marketId: idOfKey(p.market),
              side: p.isLong ? "long" : "short",
              // Effective leverage: changes when margin is added or removed.
              leverage: Math.max(1, Math.round(Number(p.size) / Number(p.collateral))),
              takeProfit: p.takeProfit > 0n ? p.takeProfit : null,
              stopLoss: p.stopLoss > 0n ? p.stopLoss : null,
              collateral: p.collateral,
              notional: p.size,
              entryPrice: p.entryPrice,
              liquidationPrice: details[2 * i + 1] as bigint,
              openFee: feeOf(p.size, SIMULATED.openFeeBps),
              openedAt: Number(p.openedAt) * 1000,
            };
          });
          await refreshHistory(owner).catch(() => {});
          account = { balance: bal as bigint, positions, history, orders };
          holding = { shares: (shares as bigint) / SHARE_SCALE, costBasis: readBasis(owner) };
        }

        snapshot = {
          now: Date.now(),
          wallet: { available: wallet.state.available, address: owner, chainOk: wallet.state.chainId === chain.id },
          quotes,
          account,
          vault,
          vaultHolding: holding,
          wars: paper.getSnapshot().wars,
        };
      } catch {
        // Keep the last good snapshot; the next poll retries.
        snapshot = { ...snapshot, now: Date.now(), wallet: { available: wallet.state.available, address: wallet.state.address, chainOk: wallet.state.chainId === chain.id } };
      } finally {
        inFlight = null;
        emit();
      }
    })();
    return inFlight;
  }

  wallet.onChange(() => {
    historyFor = null;
    void poll();
  });

  async function send<T>(fn: (w: Awaited<ReturnType<BrowserWallet["client"]>>) => Promise<T>): Promise<T> {
    try {
      const w = await wallet.client();
      return await fn(w);
    } catch (err) {
      throw friendly(err);
    } finally {
      void poll();
    }
  }

  type Signer = Awaited<ReturnType<BrowserWallet["client"]>>;
  /**
   * Every transaction is simulated against the chain first, so a refusal shows the contract's reason
   * (and the wallet never prompts for a transaction that would fail), then signed in the wallet.
   */
  async function write(w: Signer, req: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<Hex> {
    const call = { account: w.account, address: req.address, abi: req.abi, functionName: req.functionName, args: req.args ?? [] } as Parameters<PublicClient["simulateContract"]>[0];
    const { request } = await client.simulateContract(call);
    // Headroom over the estimate: closes delete storage, and the refund makes a bare estimate run out of gas.
    const gas = withHeadroom(await client.estimateContractGas(call as Parameters<PublicClient["estimateContractGas"]>[0]));
    return w.wallet.writeContract({ ...(request as Parameters<typeof w.wallet.writeContract>[0]), gas, chain });
  }

  async function ensureAllowance(w: Awaited<ReturnType<BrowserWallet["client"]>>, spender: Address, needed: bigint) {
    const allowance = (await client.readContract({ address: dep.usdg, abi: testUSDGAbi, functionName: "allowance", args: [w.account, spender] })) as bigint;
    if (allowance >= needed) return;
    const hash = await write(w, { address: dep.usdg, abi: testUSDGAbi, functionName: "approve", args: [spender, needed] });
    await client.waitForTransactionReceipt({ hash });
  }

  async function confirm(hash: Hex) {
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The transaction reverted.");
  }

  const markOf = (marketId: string) => {
    const q = snapshot.quotes[marketId];
    if (!q) throw new Error("No price yet for this market.");
    return q.price;
  };

  return {
    mode: "live",
    network,
    settlementSymbol: symbol,
    explorer: chain.blockExplorers?.default.url,
    markets,

    subscribe(listener) {
      listeners.add(listener);
      if (!timer) {
        void poll();
        timer = setInterval(() => void poll(), POLL_MS);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },

    getSnapshot: () => snapshot,

    async getHistory(marketId, range: HistoryRange): Promise<PricePoint[]> {
      const r = await fetch(`/api/exchange/history?market=${marketId}&range=${range}`);
      if (!r.ok) return [];
      const body = (await r.json()) as { points: { t: number; price: number }[] };
      return body.points.map((p) => ({ t: p.t, price: BigInt(Math.round(p.price * 1e8)) }));
    },

    async getVaultHistory(range: HistoryRange): Promise<PricePoint[]> {
      // No share-price history is stored on-chain yet: show the current price across the range.
      const spans: Record<HistoryRange, number> = { "1D": 86_400_000, "1W": 7 * 86_400_000, "1M": 30 * 86_400_000, "6M": 182 * 86_400_000, "1Y": 365 * 86_400_000 };
      const now = Date.now();
      return [
        { t: now - spans[range], price: snapshot.vault.sharePrice },
        { t: now, price: snapshot.vault.sharePrice },
      ];
    },

    async connectWallet() {
      try {
        await wallet.connect();
      } catch (err) {
        throw friendly(err);
      }
      await poll();
    },

    faucet: dep.usdgHasFaucet
      ? () =>
          send(async (w) => {
            const hash = await write(w, { address: dep.usdg, abi: testUSDGAbi, functionName: "faucet" });
            await client.waitForTransactionReceipt({ hash });
          })
      : undefined,

    openPosition({ marketId, side, collateral, leverage, takeProfit, stopLoss }: OpenPositionRequest) {
      return send(async (w) => {
        const mark = markOf(marketId);
        const fee = feeOf(collateral * BigInt(leverage), SIMULATED.openFeeBps);
        await ensureAllowance(w, dep.perps, collateral + fee);
        const acceptable = side === "long" ? (mark * BigInt(10_000 + UI_SLIPPAGE_BPS)) / 10_000n : (mark * BigInt(10_000 - UI_SLIPPAGE_BPS)) / 10_000n;
        const withTriggers = !!(takeProfit || stopLoss);
        const hash = await write(w, {
          address: dep.perps,
          abi: stoxhomesPerpsAbi,
          functionName: withTriggers ? "openWithTriggers" : "open",
          args: withTriggers
            ? [key(marketId), side === "long", collateral, BigInt(leverage), acceptable, takeProfit ?? 0n, stopLoss ?? 0n]
            : [key(marketId), side === "long", collateral, BigInt(leverage), acceptable],
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: stoxhomesPerpsAbi, data: log.data, topics: log.topics });
            if (ev.eventName === "PositionOpened") {
              return {
                id: ev.args.id.toString(),
                marketId,
                side,
                leverage,
                collateral: ev.args.collateral,
                notional: ev.args.size,
                entryPrice: ev.args.price,
                liquidationPrice: 0n,
                openFee: ev.args.fee,
                openedAt: Date.now(),
              };
            }
          } catch {
            // other log
          }
        }
        throw new Error("Opened, but the position event wasn't found.");
      });
    },

    closePosition(positionId) {
      return send(async (w) => {
        const pos = snapshot.account.positions.find((p) => p.id === positionId);
        if (!pos) throw new Error("Position not found. It may have been liquidated.");
        const mark = markOf(pos.marketId);
        const acceptable = pos.side === "long" ? (mark * BigInt(10_000 - UI_SLIPPAGE_BPS)) / 10_000n : (mark * BigInt(10_000 + UI_SLIPPAGE_BPS)) / 10_000n;
        const hash = await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "close", args: [BigInt(positionId), acceptable] });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: stoxhomesPerpsAbi, data: log.data, topics: log.topics });
            if (ev.eventName === "PositionClosed") {
              return {
                id: positionId,
                marketId: pos.marketId,
                side: pos.side,
                leverage: pos.leverage,
                collateral: pos.collateral,
                notional: pos.notional,
                entryPrice: pos.entryPrice,
                exitPrice: ev.args.price,
                realisedPnl: ev.args.paidOut - pos.collateral - pos.openFee,
                closedAt: Date.now(),
                reason: "closed",
              };
            }
          } catch {
            // other log
          }
        }
        throw new Error("Closed, but the close event wasn't found.");
      });
    },

    placeOrder({ marketId, side, collateral, leverage, type, triggerPrice, takeProfit, stopLoss }: OrderRequest) {
      return send(async (w) => {
        const fee = feeOf(collateral * BigInt(leverage), SIMULATED.openFeeBps);
        await ensureAllowance(w, dep.perps, collateral + fee);
        // Long limit waits for the price to fall to the trigger; long stop for it to rise. Shorts mirror that.
        const triggerAbove = (side === "long") === (type === "stop");
        await confirm(
          await write(w, {
            address: dep.perps,
            abi: stoxhomesPerpsAbi,
            functionName: "placeOrder",
            args: [key(marketId), side === "long", collateral, BigInt(leverage), triggerPrice, triggerAbove, takeProfit ?? 0n, stopLoss ?? 0n],
          }),
        );
      });
    },

    cancelOrder(orderId) {
      return send(async (w) => confirm(await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "cancelOrder", args: [BigInt(orderId)] })));
    },

    decreasePosition(positionId, fractionBps) {
      return send(async (w) => {
        const pos = snapshot.account.positions.find((p) => p.id === positionId);
        if (!pos) throw new Error("Position not found. It may have been liquidated.");
        const mark = markOf(pos.marketId);
        const acceptable = pos.side === "long" ? (mark * BigInt(10_000 - UI_SLIPPAGE_BPS)) / 10_000n : (mark * BigInt(10_000 + UI_SLIPPAGE_BPS)) / 10_000n;
        const sizeDelta = fractionBps >= 10_000 ? maxUint256 : (pos.notional * BigInt(fractionBps)) / 10_000n;
        await confirm(await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "decrease", args: [BigInt(positionId), sizeDelta, acceptable] }));
      });
    },

    addMargin(positionId, amount) {
      return send(async (w) => {
        await ensureAllowance(w, dep.perps, amount);
        await confirm(await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "addCollateral", args: [BigInt(positionId), amount] }));
      });
    },

    removeMargin(positionId, amount) {
      return send(async (w) => confirm(await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "removeCollateral", args: [BigInt(positionId), amount] })));
    },

    setTriggers(positionId, takeProfit, stopLoss) {
      return send(async (w) =>
        confirm(await write(w, { address: dep.perps, abi: stoxhomesPerpsAbi, functionName: "setTriggers", args: [BigInt(positionId), takeProfit ?? 0n, stopLoss ?? 0n] })),
      );
    },

    async getChanges() {
      await refreshChange24h();
      return longChanges;
    },

    deposit(amount) {
      return send(async (w) => {
        await ensureAllowance(w, dep.vault, amount);
        const hash = await write(w, { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "deposit", args: [amount, w.account] });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The transaction reverted.");
        writeBasis(w.account, readBasis(w.account) + amount);
      });
    },

    withdraw(sharesScaled) {
      return send(async (w) => {
        const all = (await client.readContract({ address: dep.vault, abi: stoxhomesVaultAbi, functionName: "balanceOf", args: [w.account] })) as bigint;
        const shares = sharesScaled * SHARE_SCALE >= all ? all : sharesScaled * SHARE_SCALE;
        if (shares === 0n) throw new Error("You don't hold any Vault shares.");
        const hash = await write(w, { address: dep.vault, abi: stoxhomesVaultAbi, functionName: "redeem", args: [shares, w.account, w.account] });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The transaction reverted.");
        const basis = readBasis(w.account);
        writeBasis(w.account, all > 0n ? basis - (basis * shares) / all : 0n);
      });
    },

    // City Wars remains a paper game on every network.
    enterWar: (matchId, pick, stake) => paper.enterWar(matchId, pick, stake),
  };
}

/** Exposed for tests. */
export const __test = { friendly, maxUint256 };
