import { formatEther, zeroAddress, type Hex } from "viem";
import { BOT, TOKEN } from "@/config/stoxhomes";
import {
  burnShare,
  gasTooExpensive,
  keepsGasReserve,
  meetsThreshold,
  minOutAfterSlippage,
  USD_DECIMALS,
  weiToUsd,
} from "./math";
import type { AlertPort, ChainPort, ClaimEvent, LockPort, Obligation, RunRecord, StorePort } from "./types";

/**
 * One run of the creator-fee bot.
 *
 *   1. Take the lock (two runs never overlap).
 *   2. Record every claim the payout wallet made since the last run, by the bot or by hand, as a burn obligation.
 *   3. Finish owed burns first, oldest first. If one can't finish, stop here: nothing new until it does.
 *   4. If the escrow holds ≥ threshold and gas is reasonable, claim, then buy back and burn 20% of exactly what arrived.
 *
 * Swaps and burns are signed with a fixed nonce and stored before they are broadcast, and a stored transaction
 * is only ever re-broadcast, never re-signed, until the chain proves it can't land. That's what makes a double
 * burn impossible and a skipped burn visible.
 */

export type Settings = {
  network: string;
  dryRun: boolean;
  thresholdUsd: number;
  burnShareBps: number;
  maxSlippageBps: number;
  maxGasShareBps: number;
  minGasWei: bigint;
  startBlock: bigint | null;
  /** How long to wait for a transaction before leaving it for the next run. */
  txWaitMs: number;
};

export type Deps = { chain: ChainPort; store: StorePort; lock: LockPort; alerts: AlertPort; now?: () => Date };

export type RunResult = Pick<RunRecord, "outcome" | "message" | "log">;

type Step = "done" | "waiting" | "failed";

const usd = (v: bigint) => `$${(Number(v) / 10 ** USD_DECIMALS).toFixed(2)}`;
const eth = (wei: bigint) => `${formatEther(wei)} ETH`;
const tokens = (n: bigint) => `${formatEther(n)} ${TOKEN.ticker}`; // 18 decimals

export async function runOnce(deps: Deps, s: Settings): Promise<RunResult> {
  const { chain, store, lock, alerts } = deps;
  const now = deps.now ?? (() => new Date());
  const log: string[] = [];
  const say = (line: string) => log.push(line);
  const run: RunRecord = {
    network: s.network,
    dryRun: s.dryRun,
    startedAt: now(),
    finishedAt: now(),
    outcome: "",
    message: "",
    log,
  };
  let burnsCompleted = 0;
  const finish = (outcome: string, message: string): RunResult => {
    // A run that finished owed burns reports that first, whatever else it found.
    if (burnsCompleted > 0 && ["below-threshold", "gas-too-high", "low-gas", "no-price"].includes(outcome)) {
      message = `Finished ${burnsCompleted} owed burn(s). ${message}`;
      outcome = "burned";
    }
    run.outcome = outcome;
    run.message = message;
    say(message);
    return { outcome, message, log };
  };

  const lockToken = await lock.acquire(BOT.lockTtlSeconds);
  if (!lockToken) return { outcome: "locked", message: "Another run holds the lock; skipping.", log };

  let result: RunResult;
  try {
    result = await body();
  } catch (err) {
    const message = `Run failed: ${err instanceof Error ? err.message : String(err)}`;
    result = finish("error", message);
    await alerts.send(`⚠️ Stoxhomes fee bot error (${s.network}${s.dryRun ? ", dry run" : ""})\n${message}`).catch(() => {});
  } finally {
    run.finishedAt = now();
    await store.recordRun(run).catch(() => {});
    await lock.release(lockToken).catch(() => {});
  }
  return result!;

  async function body(): Promise<RunResult> {
    if (s.dryRun) say("DRY RUN: reading only, no transactions will be sent.");

    // ---- 0. Is there anything to do?
    const launch = await chain.launch();
    if (launch.phase !== "pool") {
      return finish("waiting", `Token phase is "${launch.phase}"; the bot only acts after graduation to the Uniswap v4 pool.`);
    }
    if (launch.pairToken !== zeroAddress) {
      await alerts.send("⚠️ Fee bot: token is paired with an ERC-20, not native ETH. Only ETH pairs are supported.");
      return finish("unsupported", "Token is not paired with native ETH; refusing to act.");
    }
    if (launch.creatorFeeRecipient.toLowerCase() !== chain.wallet.toLowerCase()) {
      await alerts.send("⚠️ Fee bot: the bot wallet is not this token's creator fee recipient. Nothing to claim.");
      return finish("wrong-wallet", `Creator fee recipient is ${launch.creatorFeeRecipient}, not the bot wallet ${chain.wallet}.`);
    }
    if (launch.buybackEnabled) {
      say("Warning: Pons creator buyback is enabled for this token; those tokens vest instead of burning.");
    }

    // ---- 1. Every claim since last time becomes an obligation, whoever made it.
    const head = await chain.blockNumber();
    const cursor = (await store.getCursor()) ?? (s.startBlock != null ? s.startBlock - 1n : head);
    if (cursor < head) {
      const from = cursor + 1n;
      const to = head - from + 1n > BOT.maxLogScanBlocks ? from + BOT.maxLogScanBlocks - 1n : head;
      const events = await chain.claimEvents(from, to);
      for (const e of events) {
        if (s.dryRun) say(`Would record claim ${e.txHash}: ${e.asset === "eth" ? eth(e.amount) : tokens(e.amount)}.`);
        else if (await addFromClaim(e)) say(`Recorded claim ${e.txHash} (found on-chain).`);
      }
      if (!s.dryRun) await store.setCursor(to);
      if (to < head) say(`Scanned blocks ${from}–${to}; the rest will be scanned next run.`);
    } else if (!s.dryRun && (await store.getCursor()) == null) {
      await store.setCursor(head);
    }

    // ---- 2. Owed burns come first.
    const ethUsd = await chain.ethUsd();
    const gasPrice = await chain.gasPrice();
    const open = await store.openObligations();
    for (const o of open) {
      const step = await advance(o, gasPrice);
      if (step !== "done") {
        return finish("pending", `Owed burn #${o.id} is not finished (${step}); no new claims until it is.`);
      }
    }

    // ---- 3. A new claim?
    if (ethUsd == null) {
      await alerts.send("⚠️ Fee bot: no fresh ETH/USD price; skipped this run.");
      return finish("no-price", "No fresh ETH/USD price; can't check the threshold.");
    }
    const claimableWei = await chain.claimableEth();
    const claimableTokens = await chain.claimableToken();
    const valueUsd = weiToUsd(claimableWei, ethUsd);
    run.claimableWei = claimableWei;
    run.claimableUsd = valueUsd;
    run.ethUsd = ethUsd;
    say(`Claimable: ${eth(claimableWei)} (${usd(valueUsd)} at ${usd(ethUsd)}/ETH)${claimableTokens > 0n ? ` and ${tokens(claimableTokens)}` : ""}.`);

    if (claimableWei === 0n) return finish("below-threshold", "The escrow is empty; nothing to claim.");
    if (!meetsThreshold(valueUsd, s.thresholdUsd)) {
      return finish("below-threshold", `Below the $${s.thresholdUsd} threshold; nothing to do.`);
    }

    const claimGas = (await chain.estimateClaimGas("eth")) * gasPrice;
    const followUpGas = (BOT.gasUnits.swap + BOT.gasUnits.burn) * gasPrice;
    const totalGas = claimGas + followUpGas;
    if (gasTooExpensive(totalGas, claimableWei, s.maxGasShareBps)) {
      return finish("gas-too-high", `Gas (${eth(totalGas)}) would exceed ${s.maxGasShareBps / 100}% of the claim; waiting.`);
    }
    const balance = await chain.ethBalance();
    if (balance - claimGas < s.minGasWei) {
      await alerts.send(`⚠️ Fee bot: wallet ETH (${eth(balance)}) is at the gas reserve. Top it up.`);
      return finish("low-gas", "Not enough ETH above the gas reserve to pay for the claim.");
    }

    const share = burnShare(claimableWei, s.burnShareBps);
    if (s.dryRun) {
      const quote = await chain.quoteEthForToken(share);
      say(`Would claim ${eth(claimableWei)}.`);
      say(`Would swap ${eth(share)} (${s.burnShareBps / 100}%) for at least ${tokens(minOutAfterSlippage(quote, s.maxSlippageBps))} (quote ${tokens(quote)}).`);
      say(`Would burn the tokens bought by sending them to ${BOT.deadAddress}. ${eth(claimableWei - share)} stays in the wallet.`);
      return finish("dry-run", "Dry run complete; nothing was sent.");
    }

    const claimed = await chain.claim("eth");
    if (!claimed) return finish("pending", "Claim sent but not confirmed yet; it'll be picked up from the chain next run.");
    run.claimTx = claimed.txHash;
    await addFromClaim(claimed);
    say(`Claimed ${eth(claimed.amount)} in ${claimed.txHash}.`);
    if (claimableTokens > 0n) {
      const t = await chain.claim("token");
      if (t) await addFromClaim(t);
    }

    for (const o of await store.openObligations()) {
      const step = await advance(o, gasPrice);
      if (step !== "done") return finish("pending", `Claimed; burn #${o.id} will be finished next run (${step}).`);
    }
    return finish("burned", "Claimed, bought back and burned.");
  }

  async function addFromClaim(e: ClaimEvent): Promise<boolean> {
    const owed = burnShare(e.amount, s.burnShareBps);
    return store.addObligation({
      sourceTx: e.txHash,
      asset: e.asset,
      claimedAmount: e.amount,
      owedAmount: owed,
      // Token-side fees are already $STOXH: skip the swap, burn the share as-is.
      state: e.asset === "token" ? "to_burn" : "owed",
      tokensBought: e.asset === "token" ? owed : undefined,
    });
  }

  /** Moves one obligation as far as it can go this run. */
  async function advance(o: Obligation, gasPrice: bigint): Promise<Step> {
    let cur = o;
    for (;;) {
      switch (cur.state) {
        case "owed": {
          if (cur.owedAmount === 0n) {
            await store.transition(cur.id, "owed", { state: "burned", burnedAmount: 0n, burnedAt: now() });
            return "done";
          }
          const quote = await chain.quoteEthForToken(cur.owedAmount);
          const minOut = minOutAfterSlippage(quote, s.maxSlippageBps);
          const swapGas = BOT.gasUnits.swap * gasPrice;
          const balance = await chain.ethBalance();
          if (!keepsGasReserve(balance, cur.owedAmount, swapGas, s.minGasWei)) {
            const msg = `Owed burn #${cur.id} needs ${eth(cur.owedAmount)} plus gas, but the wallet would drop below its gas reserve.`;
            await store.noteError(cur.id, msg);
            await alerts.send(`⚠️ Fee bot: ${msg} Top up the wallet.`);
            return "waiting";
          }
          if (s.dryRun) {
            say(`Would swap owed ${eth(cur.owedAmount)} (burn #${cur.id}) for at least ${tokens(minOut)}, then burn.`);
            return "done";
          }
          const tx = await chain.signSwap(cur.owedAmount, minOut);
          if (!(await store.transition(cur.id, "owed", { state: "swap_sent", swap: tx, attempts: cur.attempts + 1 }))) {
            return "waiting"; // someone else moved it
          }
          await safeBroadcast(tx);
          say(`Swap for burn #${cur.id} sent: ${tx.hash}.`);
          cur = { ...cur, state: "swap_sent", swap: tx, attempts: cur.attempts + 1 };
          break;
        }
        case "swap_sent": {
          const st = await chain.txStatus(cur.swap!, "swap", s.txWaitMs);
          if (st.status === "success") {
            if (st.tokensReceived == null || st.tokensReceived === 0n) throw new Error(`Swap ${cur.swap!.hash} succeeded but no tokens arrived.`);
            await store.transition(cur.id, "swap_sent", { state: "to_burn", tokensBought: st.tokensReceived });
            say(`Bought ${tokens(st.tokensReceived)} for burn #${cur.id}.`);
            cur = { ...cur, state: "to_burn", tokensBought: st.tokensReceived };
            break;
          }
          if (st.status === "pending") {
            if (s.dryRun) return "waiting";
            await safeBroadcast(cur.swap!); // same signed tx, same nonce: can only land once
            return "waiting";
          }
          // Reverted or replaced: the ETH never left; owe it again.
          await store.transition(cur.id, "swap_sent", { state: "owed", swap: undefined });
          const msg = `Swap for burn #${cur.id} ${st.status} (${cur.swap!.hash}); will retry.`;
          await store.noteError(cur.id, msg);
          await alerts.send(`⚠️ Fee bot: ${msg}`);
          return "failed";
        }
        case "to_burn": {
          const amount = cur.tokensBought!;
          if (s.dryRun) {
            say(`Would burn ${tokens(amount)} (burn #${cur.id}).`);
            return "done";
          }
          const tx = await chain.signBurn(amount);
          if (!(await store.transition(cur.id, "to_burn", { state: "burn_sent", burn: tx }))) return "waiting";
          await safeBroadcast(tx);
          say(`Burn #${cur.id} sent: ${tx.hash}.`);
          cur = { ...cur, state: "burn_sent", burn: tx };
          break;
        }
        case "burn_sent": {
          const st = await chain.txStatus(cur.burn!, "burn", s.txWaitMs);
          if (st.status === "success") {
            await store.transition(cur.id, "burn_sent", { state: "burned", burnedAmount: cur.tokensBought!, burnedAt: now() });
            burnsCompleted++;
            say(`Burned ${tokens(cur.tokensBought!)} in ${cur.burn!.hash}.`);
            await alerts.send(
              `🔥 Burned ${tokens(cur.tokensBought!)}\nFrom a claim of ${cur.asset === "eth" ? eth(cur.claimedAmount) : tokens(cur.claimedAmount)}\nTx: ${cur.burn!.hash}`,
            );
            return "done";
          }
          if (st.status === "pending") {
            if (!s.dryRun) await safeBroadcast(cur.burn!);
            return "waiting";
          }
          await store.transition(cur.id, "burn_sent", { state: "to_burn", burn: undefined });
          const msg = `Burn #${cur.id} ${st.status} (${cur.burn!.hash}); tokens are still owed and will be burned next run.`;
          await store.noteError(cur.id, msg);
          await alerts.send(`⚠️ Fee bot: ${msg}`);
          return "failed";
        }
        case "burned":
          return "done";
      }
    }
  }

  async function safeBroadcast(tx: { hash: Hex; raw: Hex; nonce: number }) {
    try {
      await chain.broadcast(tx);
    } catch (err) {
      // "already known" / "nonce too low" just mean the same transaction is already out there or mined.
      say(`Broadcast of ${tx.hash} reported: ${err instanceof Error ? err.message : String(err)} (status is checked from the chain).`);
    }
  }
}
