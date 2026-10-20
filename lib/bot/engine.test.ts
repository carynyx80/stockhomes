import { describe, expect, it, vi } from "vitest";
import { keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { runOnce, type Settings } from "./engine";
import { memoryLock, redisLock } from "./lock";
import { memoryStore } from "./memory-store";
import type { AlertPort, ChainPort, ClaimEvent, LaunchState, SignedTx, TxStatus } from "./types";

const ETH = 10n ** 18n;
const WALLET = "0x00000000000000000000000000000000000000a1" as Address;
const PRICE = 2_400n * 10n ** 8n;
const RATE = 1_000_000n; // tokens per ETH in the fake pool

type Script = Partial<Record<"swap" | "burn", TxStatus["status"][]>>;

/** A chain you can steer: escrow balances, claim events, and what each sent transaction does. */
function fakeChain(opts: { escrowWei?: bigint; escrowTokens?: bigint; balance?: bigint; launch?: Partial<LaunchState>; script?: Script } = {}) {
  let nonce = 0;
  let block = 1_000n;
  const escrow = { wei: opts.escrowWei ?? 0n, tokens: opts.escrowTokens ?? 0n };
  const external: ClaimEvent[] = [];
  const signed: { kind: "swap" | "burn"; tx: SignedTx; amount: bigint }[] = [];
  const broadcasts: Hex[] = [];
  const claims: ClaimEvent[] = [];
  const script: Script = { swap: [...(opts.script?.swap ?? [])], burn: [...(opts.script?.burn ?? [])] };
  const outcome = new Map<Hex, TxStatus>();
  let deadBalance = 0n;
  let balance = opts.balance ?? ETH;

  const sign = (kind: "swap" | "burn", amount: bigint): SignedTx => {
    const raw = toHex(`${kind}:${amount}:${nonce}`);
    const tx = { hash: keccak256(raw), raw, nonce: nonce++ };
    signed.push({ kind, tx, amount });
    return tx;
  };

  const chain: ChainPort = {
    wallet: WALLET,
    blockNumber: async () => block,
    launch: async () => ({
      phase: "pool",
      pairToken: zeroAddress,
      creatorFeeRecipient: WALLET,
      buybackEnabled: false,
      ...opts.launch,
    }),
    claimableEth: async () => escrow.wei,
    claimableToken: async () => escrow.tokens,
    ethBalance: async () => balance,
    ethUsd: async () => PRICE,
    gasPrice: async () => 10_000_000n, // 0.01 gwei
    estimateClaimGas: async () => 120_000n,
    quoteEthForToken: async (amt) => amt * RATE,
    claimEvents: async (from, to) => external.filter((e) => e.blockNumber >= from && e.blockNumber <= to),
    claim: async (asset) => {
      const amount = asset === "eth" ? escrow.wei : escrow.tokens;
      if (asset === "eth") {
        escrow.wei = 0n;
        balance += amount;
      } else escrow.tokens = 0n;
      const e: ClaimEvent = { txHash: keccak256(toHex(`claim:${claims.length}:${asset}`)), blockNumber: block, asset, amount };
      claims.push(e);
      return e;
    },
    signSwap: async (amountIn) => sign("swap", amountIn),
    signBurn: async (amount) => sign("burn", amount),
    broadcast: async (tx) => {
      broadcasts.push(tx.hash);
    },
    txStatus: async (tx, kind) => {
      const settled = outcome.get(tx.hash);
      if (settled) return settled;
      const next = script[kind]!.shift() ?? "success";
      const s = signed.find((x) => x.tx.hash === tx.hash)!;
      let st: TxStatus;
      if (next === "success") {
        if (kind === "swap") {
          balance -= s.amount;
          st = { status: "success", tokensReceived: s.amount * RATE };
        } else {
          deadBalance += s.amount;
          st = { status: "success" };
        }
      } else st = { status: next } as TxStatus;
      if (next !== "pending") outcome.set(tx.hash, st);
      return st;
    },
    tokenBalanceOfDead: async () => deadBalance,
  };

  return {
    chain,
    escrow,
    signed,
    broadcasts,
    claims,
    dead: () => deadBalance,
    mine: () => (block += 100n),
    externalClaim: (amount: bigint) => {
      block += 10n;
      const e: ClaimEvent = { txHash: keccak256(toHex(`manual:${block}`)), blockNumber: block, asset: "eth", amount };
      external.push(e);
      balance += amount;
      return e;
    },
  };
}

const settings = (over: Partial<Settings> = {}): Settings => ({
  network: "mainnet",
  dryRun: false,
  thresholdUsd: 100,
  burnShareBps: 2000,
  maxSlippageBps: 200,
  maxGasShareBps: 500,
  minGasWei: ETH / 500n,
  startBlock: null,
  txWaitMs: 0,
  ...over,
});

const quietAlerts = (): AlertPort & { sent: string[] } => {
  const sent: string[] = [];
  return { sent, send: async (t) => void sent.push(t) };
};

function harness(opts: Parameters<typeof fakeChain>[0] = {}) {
  const f = fakeChain(opts);
  const store = memoryStore();
  const lock = memoryLock();
  const alerts = quietAlerts();
  const run = (over?: Partial<Settings>) => runOnce({ chain: f.chain, store, lock, alerts }, settings(over));
  return { ...f, store, lock, alerts, run };
}

describe("threshold", () => {
  it("does nothing below $100", async () => {
    const h = harness({ escrowWei: ETH / 25n }); // $96
    const r = await h.run();
    expect(r.outcome).toBe("below-threshold");
    expect(h.claims).toHaveLength(0);
    expect(h.signed).toHaveLength(0);
  });

  it("claims, buys with exactly 20% of what arrived, and burns exactly what was bought", async () => {
    const claimed = ETH / 10n + 7n; // $240 and some odd wei
    const h = harness({ escrowWei: claimed });
    const r = await h.run();
    expect(r.outcome).toBe("burned");
    const share = (claimed * 2000n) / 10_000n;
    expect(h.signed.map((s) => [s.kind, s.amount])).toEqual([
      ["swap", share],
      ["burn", share * RATE],
    ]);
    expect(h.dead()).toBe(share * RATE);
    expect(h.store.all()[0]).toMatchObject({ state: "burned", claimedAmount: claimed, owedAmount: share });
    expect(h.alerts.sent.some((t) => t.startsWith("🔥"))).toBe(true);
  });

  it("treats an empty escrow as nothing to do, even with a $0 threshold", async () => {
    const h = harness({ escrowWei: 0n });
    expect((await h.run({ thresholdUsd: 0 })).outcome).toBe("below-threshold");
    expect(h.claims).toHaveLength(0);
  });

  it("waits until the token has graduated", async () => {
    const h = harness({ escrowWei: ETH, launch: { phase: "curve" } });
    expect((await h.run()).outcome).toBe("waiting");
    expect(h.claims).toHaveLength(0);
  });

  it("refuses when the bot wallet isn't the fee recipient", async () => {
    const h = harness({ escrowWei: ETH, launch: { creatorFeeRecipient: "0x00000000000000000000000000000000000000b2" } });
    expect((await h.run()).outcome).toBe("wrong-wallet");
    expect(h.claims).toHaveLength(0);
  });
});

describe("pending-burn retry", () => {
  it("retries a failed swap before anything new, then completes", async () => {
    const h = harness({ escrowWei: ETH / 10n, script: { swap: ["reverted"] } });
    expect((await h.run()).outcome).toBe("pending");
    expect(h.store.all()[0].state).toBe("owed");
    expect(h.alerts.sent.some((t) => t.includes("reverted"))).toBe(true);

    // More fees arrive meanwhile: the owed burn must still go first.
    h.escrow.wei = ETH / 5n;
    h.mine();
    const second = await h.run();
    expect(second.outcome).toBe("burned");
    const owed = (ETH / 10n) * 2000n / 10_000n;
    expect(h.signed[1]).toMatchObject({ kind: "swap", amount: owed });
    expect(h.store.all().every((o) => o.state === "burned")).toBe(true);
  });

  it("blocks new claims while an owed burn can't complete", async () => {
    const h = harness({ escrowWei: ETH / 10n, script: { swap: ["reverted", "reverted"] } });
    await h.run();
    h.escrow.wei = ETH;
    const r = await h.run();
    expect(r.outcome).toBe("pending");
    expect(h.claims).toHaveLength(1); // the second $2,400 was not claimed
  });

  it("never double-burns: a pending burn is re-broadcast, not re-signed", async () => {
    const h = harness({ escrowWei: ETH / 10n, script: { burn: ["pending", "pending"] } });
    expect((await h.run()).outcome).toBe("pending");
    expect((await h.run()).outcome).toBe("pending");
    expect((await h.run()).outcome).toBe("burned");
    const burns = h.signed.filter((s) => s.kind === "burn");
    expect(burns).toHaveLength(1);
    expect(h.broadcasts.filter((b) => b === burns[0].tx.hash).length).toBeGreaterThanOrEqual(3);
    expect(h.dead()).toBe(burns[0].amount);
  });

  it("re-signs a burn only once the chain shows the old one can never land", async () => {
    const h = harness({ escrowWei: ETH / 10n, script: { burn: ["dropped"] } });
    expect((await h.run()).outcome).toBe("pending");
    expect(h.store.all()[0].state).toBe("to_burn");
    expect((await h.run()).outcome).toBe("burned");
    const burns = h.signed.filter((s) => s.kind === "burn");
    expect(burns).toHaveLength(2);
    expect(burns[0].tx.nonce).not.toBe(burns[1].tx.nonce);
    expect(h.dead()).toBe(burns[0].amount); // burned once
  });

  it("survives a broadcast error after the transaction was stored", async () => {
    const h = harness({ escrowWei: ETH / 10n });
    const original = h.chain.broadcast;
    h.chain.broadcast = vi.fn().mockRejectedValueOnce(new Error("already known")).mockImplementation(original);
    expect((await h.run()).outcome).toBe("burned");
    expect(h.signed.filter((s) => s.kind === "swap")).toHaveLength(1);
  });
});

describe("claims made outside the bot", () => {
  it("finds a manual claim on-chain and still burns 20% of it", async () => {
    const h = harness();
    await h.run(); // sets the scan cursor
    const manual = h.externalClaim(ETH / 2n);
    const r = await h.run();
    expect(r.outcome).toBe("burned");
    expect(r.message).toMatch(/Finished 1 owed burn.*escrow is empty/); // nothing left in escrow…
    const o = h.store.all()[0];
    expect(o).toMatchObject({ sourceTx: manual.txHash, state: "burned", owedAmount: ETH / 10n }); // …but the owed burn ran
  });

  it("records each claim exactly once", async () => {
    const h = harness({ escrowWei: ETH / 10n });
    await h.run();
    h.mine();
    await h.run();
    expect(h.store.all()).toHaveLength(1);
  });
});

describe("token-side fees", () => {
  it("burns claimed $STOXH as-is, with no swap", async () => {
    const h = harness({ escrowWei: ETH / 10n, escrowTokens: 5_000n * ETH });
    await h.run();
    const tokenBurn = h.store.all().find((o) => o.asset === "token")!;
    expect(tokenBurn).toMatchObject({ state: "burned", burnedAmount: 1_000n * ETH });
    expect(h.signed.filter((s) => s.kind === "swap")).toHaveLength(1); // only the ETH leg swapped
  });
});

describe("gas guard", () => {
  it("skips when gas would exceed 5% of the claim", async () => {
    const h = harness({ escrowWei: ETH / 10n });
    h.chain.gasPrice = async () => 10n ** 13n; // 10,000 gwei
    expect((await h.run()).outcome).toBe("gas-too-high");
    expect(h.claims).toHaveLength(0);
  });

  it("keeps MIN_GAS_ETH untouched and leaves the burn owed", async () => {
    const h = harness({ escrowWei: ETH / 20n, balance: 0n });
    h.chain.ethBalance = async () => ETH / 20n; // what the claim adds; nothing above the reserve for gas
    const r = await h.run({ minGasWei: ETH / 20n });
    expect(r.outcome).toBe("low-gas");
    expect(h.signed).toHaveLength(0);
  });
});

describe("dry run", () => {
  it("sends nothing, records nothing, and says what it would do", async () => {
    const h = harness({ escrowWei: ETH / 10n });
    const r = await h.run({ dryRun: true });
    expect(r.outcome).toBe("dry-run");
    expect(h.claims).toHaveLength(0);
    expect(h.signed).toHaveLength(0);
    expect(h.broadcasts).toHaveLength(0);
    expect(h.store.all()).toHaveLength(0);
    expect(h.store.cursor).toBeNull();
    expect(r.log.join("\n")).toMatch(/Would claim 0\.1 ETH/);
    expect(r.log.join("\n")).toMatch(/Would swap 0\.02 ETH/);
  });
});

describe("lock", () => {
  it("lets only one run in at a time and releases after errors", async () => {
    const h = harness({ escrowWei: ETH / 10n });
    const token = await h.lock.acquire(60);
    expect((await h.run()).outcome).toBe("locked");
    await h.lock.release(token!);

    h.chain.launch = async () => {
      throw new Error("rpc down");
    };
    expect((await h.run()).outcome).toBe("error");
    expect(h.lock.held()).toBe(false);
  });

  it("expires so a crashed run can't block forever", async () => {
    let t = 0;
    const lock = memoryLock(() => t);
    expect(await lock.acquire(240)).not.toBeNull();
    expect(await lock.acquire(240)).toBeNull();
    t += 241_000;
    expect(await lock.acquire(240)).not.toBeNull();
  });

  it("uses SET NX EX and only deletes its own token in Redis", async () => {
    const calls: unknown[][] = [];
    const redis = {
      set: vi.fn(async (...a: unknown[]) => (calls.push(["set", ...a]), calls.length === 1 ? "OK" : null)),
      eval: vi.fn(async (...a: unknown[]) => (calls.push(["eval", ...a]), 1)),
    };
    const lock = redisLock(redis, () => "tok-1");
    expect(await lock.acquire(240)).toBe("tok-1");
    expect(await lock.acquire(240)).toBeNull();
    await lock.release("tok-1");
    expect(redis.set).toHaveBeenCalledWith("stoxhomes:fee-bot:lock", "tok-1", { nx: true, ex: 240 });
    expect(redis.eval.mock.calls[0][0]).toMatch(/redis.call\("get", KEYS\[1\]\) == ARGV\[1\]/);
    expect(redis.eval.mock.calls[0][2]).toEqual(["tok-1"]);
  });
});
