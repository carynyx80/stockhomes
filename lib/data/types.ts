/**
 * The one contract between the UI and wherever the numbers come from.
 *
 * Simulated mode implements this with mock feeds and a local paper account (lib/data/simulated.ts).
 * The live implementation will wrap the oracle and the perp/vault contracts. The UI only ever
 * imports `data` from lib/data/index.ts, so switching is a one-file change.
 *
 * Units: USDG amounts are bigint in DECIMALS.usdg fixed point, prices are bigint in DECIMALS.price.
 * Times are ms since epoch.
 */

import type { Market } from "@/lib/sim/markets";
import type { Side } from "@/lib/perp/math";

export type { Market, Side };

export type DataMode = "simulated" | "live";

export type Quote = {
  marketId: string;
  price: bigint;
  /** Change versus 24 hours earlier, in basis points. */
  change24hBps: number;
  at: number;
};

export type HistoryRange = "1D" | "1W" | "1M" | "6M" | "1Y";

export type PricePoint = { t: number; price: bigint };

export type Position = {
  id: string;
  marketId: string;
  side: Side;
  leverage: number;
  collateral: bigint;
  notional: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  openFee: bigint;
  openedAt: number;
  /** On-chain sources: automatic close prices (null = none). */
  takeProfit?: bigint | null;
  stopLoss?: bigint | null;
};

/** A resting limit or stop order (on-chain sources). */
export type RestingOrder = {
  id: string;
  marketId: string;
  side: Side;
  /** limit: fills at the trigger or better. stop: fills once the price passes the trigger. */
  type: "limit" | "stop";
  triggerPrice: bigint;
  collateral: bigint;
  leverage: number;
  notional: bigint;
  takeProfit: bigint | null;
  stopLoss: bigint | null;
  createdAt: number;
};

export type ClosedTrade = {
  id: string;
  marketId: string;
  side: Side;
  leverage: number;
  collateral: bigint;
  notional: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
  /** Net of open and close fees. */
  realisedPnl: bigint;
  closedAt: number;
  reason: "closed" | "liquidated" | "partial" | "take-profit" | "stop-loss";
};

export type Account = {
  balance: bigint;
  positions: Position[];
  history: ClosedTrade[];
  /** On-chain sources: resting limit/stop orders. */
  orders?: RestingOrder[];
};

export type OpenPositionRequest = {
  marketId: string;
  side: Side;
  collateral: bigint;
  leverage: number;
  /** On-chain sources: close automatically here (price, DECIMALS.price). */
  takeProfit?: bigint | null;
  stopLoss?: bigint | null;
};

export type OrderRequest = OpenPositionRequest & { type: "limit" | "stop"; triggerPrice: bigint };

export type VaultStats = {
  tvl: bigint;
  /** USDG per share, in DECIMALS.price fixed point. */
  sharePrice: bigint;
  apr7dBps: number;
  utilizationBps: number;
  openInterestLong: bigint;
  openInterestShort: bigint;
};

export type VaultHolding = {
  shares: bigint;
  /** USDG deposited, net of withdrawals at cost. */
  costBasis: bigint;
};

export type WarSide = "a" | "b";

export type WarMatch = {
  id: string;
  round: number;
  a: string;
  b: string;
  startsAt: number;
  endsAt: number;
  changeABps: number;
  changeBBps: number;
  /** Set once the round has ended. "push" on an exact tie. */
  result?: WarSide | "push";
};

export type WarEntry = {
  matchId: string;
  round: number;
  pick: WarSide;
  stake: bigint;
  enteredAt: number;
  settlement?: { result: WarSide | "push"; payout: bigint };
};

export type LeaderRow = {
  handle: string;
  pnl: bigint;
  wins: number;
  played: number;
  isYou?: boolean;
};

export type WarsState = {
  round: number;
  season: number;
  roundEndsAt: number;
  current: WarMatch[];
  previous: WarMatch[];
  entries: WarEntry[];
  leaderboard: LeaderRow[];
};

export type WalletInfo = {
  /** A browser wallet is installed. */
  available: boolean;
  address: string | null;
  /** Connected to the exchange's chain. */
  chainOk: boolean;
};

export type Snapshot = {
  now: number;
  /** Present for on-chain sources only. */
  wallet?: WalletInfo;
  quotes: Record<string, Quote>;
  account: Account;
  vault: VaultStats;
  vaultHolding: VaultHolding;
  wars: WarsState;
};

/**
 * The trading half of a DataSource, per account. The browser's paper account and each Open House agent's
 * account both implement it, so agents trade through exactly the calls the UI uses.
 */
export interface TradingAccount {
  openPosition(req: OpenPositionRequest): Promise<Position>;
  closePosition(positionId: string): Promise<ClosedTrade>;
}

export interface DataSource extends TradingAccount {
  readonly mode: DataMode;
  /** For on-chain sources: "testnet" or "mainnet". */
  readonly network?: "testnet" | "mainnet";
  /** Symbol of the settlement token as shown to users (USDG, or tUSDG on testnet). */
  readonly settlementSymbol?: string;
  /** Explorer base URL for transaction links. */
  readonly explorer?: string;
  /** On-chain sources: connect a browser wallet. */
  connectWallet?(): Promise<void>;
  /** Testnet only: mint test USDG from the faucet. */
  faucet?(): Promise<void>;
  readonly markets: readonly Market[];

  /** Snapshot store for useSyncExternalStore. The listener fires on every price tick or state change. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;

  getHistory(marketId: string, range: HistoryRange): Promise<PricePoint[]>;
  getVaultHistory(range: HistoryRange): Promise<PricePoint[]>;

  openPosition(req: OpenPositionRequest): Promise<Position>;
  closePosition(positionId: string): Promise<ClosedTrade>;

  deposit(amount: bigint): Promise<void>;
  withdraw(shares: bigint): Promise<void>;

  enterWar(matchId: string, pick: WarSide, stake: bigint): Promise<void>;

  /** Simulated only: restore the starting paper balance and clear everything. */
  resetPaper?(): Promise<void>;

  // ---- Advanced trading (on-chain sources). The UI shows each control only when its method exists.
  /** Place a resting limit or stop order; collateral and fee are escrowed until it fills or is cancelled. */
  placeOrder?(req: OrderRequest): Promise<void>;
  cancelOrder?(orderId: string): Promise<void>;
  /** Close part of a position: `fractionBps` of its size (10,000 = all). */
  decreasePosition?(positionId: string, fractionBps: number): Promise<void>;
  addMargin?(positionId: string, amount: bigint): Promise<void>;
  removeMargin?(positionId: string, amount: bigint): Promise<void>;
  /** Set or clear take-profit / stop-loss (null = none). */
  setTriggers?(positionId: string, takeProfit: bigint | null, stopLoss: bigint | null): Promise<void>;
  /** Longer-horizon change per market (bps): 30 days and 1 year. */
  getChanges?(): Promise<Record<string, { d30Bps: number; y1Bps: number }>>;
}
