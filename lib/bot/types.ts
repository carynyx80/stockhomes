import type { Address, Hex } from "viem";

/**
 * Seams between the bot's decision logic (engine.ts) and the outside world, so every rule can be tested
 * with fakes and the live implementations (live.ts, store-pg.ts, lock-redis.ts, alerts.ts) stay thin.
 */

export type LaunchPhase = "not-launched" | "curve" | "graduating" | "pool" | "rescued";

export type LaunchState = {
  phase: LaunchPhase;
  /** address(0) for native ETH. */
  pairToken: Address;
  creatorFeeRecipient: Address;
  buybackEnabled: boolean;
};

/** One claim seen on-chain (by the bot or anyone using the payout wallet). */
export type ClaimEvent = {
  txHash: Hex;
  blockNumber: bigint;
  asset: "eth" | "token";
  amount: bigint;
};

export type SignedTx = { hash: Hex; raw: Hex; nonce: number };

export type TxStatus =
  | { status: "success"; tokensReceived?: bigint }
  | { status: "reverted" }
  /** Not mined yet, still possible. */
  | { status: "pending" }
  /** Its nonce has been used by a different transaction: it can never land. */
  | { status: "dropped" };

export interface ChainPort {
  readonly wallet: Address;
  blockNumber(): Promise<bigint>;
  launch(): Promise<LaunchState>;
  claimableEth(): Promise<bigint>;
  claimableToken(): Promise<bigint>;
  ethBalance(): Promise<bigint>;
  /** ETH/USD with 8 decimals, or null when no fresh price is available. */
  ethUsd(): Promise<bigint | null>;
  gasPrice(): Promise<bigint>;
  estimateClaimGas(asset: "eth" | "token"): Promise<bigint>;
  quoteEthForToken(amountIn: bigint): Promise<bigint>;
  /** Claimed / ClaimedToken events for the wallet in [from, to]. */
  claimEvents(from: bigint, to: bigint): Promise<ClaimEvent[]>;
  /** Sends claim() / claimToken(TOKEN) and waits; returns the claim parsed from the receipt. */
  claim(asset: "eth" | "token"): Promise<ClaimEvent | null>;
  signSwap(amountIn: bigint, minOut: bigint): Promise<SignedTx>;
  signBurn(amount: bigint): Promise<SignedTx>;
  broadcast(tx: SignedTx): Promise<void>;
  /** Waits up to `timeoutMs` for the transaction, then reports what it knows. */
  txStatus(tx: SignedTx, kind: "swap" | "burn", timeoutMs: number): Promise<TxStatus>;
  tokenBalanceOfDead(): Promise<bigint>;
}

export type ObligationState =
  /** 20% of an ETH claim is owed; nothing sent yet. */
  | "owed"
  /** Swap signed and stored; may or may not have landed. */
  | "swap_sent"
  /** Tokens bought (or token-side fees claimed) and waiting to be burned. */
  | "to_burn"
  /** Burn signed and stored. */
  | "burn_sent"
  | "burned";

export type Obligation = {
  id: number;
  sourceTx: Hex;
  asset: "eth" | "token";
  claimedAmount: bigint;
  /** ETH (wei) to spend on the buyback, or tokens to burn directly for token-side claims. */
  owedAmount: bigint;
  state: ObligationState;
  swap?: SignedTx;
  tokensBought?: bigint;
  burn?: SignedTx;
  burnedAmount?: bigint;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  burnedAt?: Date;
};

export type RunRecord = {
  network: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
  outcome: string;
  message: string;
  claimableWei?: bigint;
  claimableUsd?: bigint;
  ethUsd?: bigint;
  claimTx?: Hex;
  log: string[];
};

export interface StorePort {
  /** Inserts one obligation per claim transaction; returns false if that claim was already recorded. */
  addObligation(o: Omit<Obligation, "id" | "createdAt" | "attempts" | "state"> & { state: ObligationState }): Promise<boolean>;
  openObligations(): Promise<Obligation[]>;
  /** Compare-and-set: only updates when the stored state is still `from`. */
  transition(id: number, from: ObligationState, patch: Partial<Obligation> & { state: ObligationState }): Promise<boolean>;
  noteError(id: number, error: string): Promise<void>;
  getCursor(): Promise<bigint | null>;
  setCursor(block: bigint): Promise<void>;
  recordRun(run: RunRecord): Promise<void>;
}

export interface LockPort {
  acquire(ttlSeconds: number): Promise<string | null>;
  release(token: string): Promise<void>;
}

export interface AlertPort {
  send(text: string): Promise<void>;
}
