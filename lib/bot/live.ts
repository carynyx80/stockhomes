import "server-only";
import {
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOT, type NetworkContracts } from "@/config/stoxhomes";
import { chainlinkAbi, erc20Abi, ponsEscrowAbi, ponsFactoryAbi, v4QuoterAbi } from "@/lib/abis";
import { activeChain, transportUrl } from "@/lib/chain";
import { creatorKey } from "@/lib/env";
import type { ChainPort, ClaimEvent, LaunchPhase, LaunchState, SignedTx, TxStatus } from "./types";
import { encodeEthToTokenSwap, poolKeyFor, type PoolKey } from "./v4";

const PHASES: LaunchPhase[] = ["curve", "graduating", "pool", "rescued"]; // GraduationPhase enum order
const LOG_CHUNK = 10_000n;

/** viem-backed ChainPort. Holds the signing account in a closure; it is never exposed or logged. */
export function liveChain(client: PublicClient, c: NetworkContracts, token: Address, readOnlyWallet?: Address | null): ChainPort {
  // With no key, a dry run can still read everything for the payout wallet's address; any signing throws.
  const key = creatorKey();
  if (!key && !readOnlyWallet) throw new Error("Set CREATOR_PRIVATE_KEY, or PAYOUT_WALLET_ADDRESS for a key-less dry run");
  const signer = key ? privateKeyToAccount(key) : null;
  const account = { address: signer?.address ?? readOnlyWallet! };
  const wallet = signer ? createWalletClient({ account: signer, chain: activeChain(), transport: http(transportUrl()) }) : null;
  const needSigner = () => {
    if (!signer || !wallet) throw new Error("No signing key: this is a read-only dry run");
    return { signer, wallet };
  };
  const dead = BOT.deadAddress as Address;

  let launchCache: { state: LaunchState; key: PoolKey | null } | null = null;
  async function loadLaunch() {
    if (launchCache) return launchCache;
    const l = await client.readContract({ address: c.ponsFactory, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [token] });
    const state: LaunchState = {
      phase: l.exists ? (PHASES[l.phase] ?? "rescued") : "not-launched",
      pairToken: l.pairToken,
      creatorFeeRecipient: l.creatorFeeRecipient,
      buybackEnabled: l.buybackEnabled,
    };
    const poolKey = l.exists ? poolKeyFor(l.pairToken, token, l.poolFee, l.tickSpacing, c.ponsMemeHook) : null;
    launchCache = { state, key: poolKey };
    return launchCache;
  }
  const poolKey = async () => {
    const k = (await loadLaunch()).key;
    if (!k) throw new Error("token has no pool");
    return k;
  };

  async function sign(to: Address, data: Hex, value: bigint): Promise<SignedTx> {
    const [nonce, fees] = await Promise.all([
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]);
    // Estimating also proves the call succeeds right now (e.g. the swap meets its minimum); if not, nothing is signed.
    const gas = await client.estimateGas({ account: account.address, to, data, value });
    const raw = await needSigner().signer.signTransaction({
      chainId: activeChain().id,
      type: "eip1559",
      to,
      data,
      value,
      nonce,
      gas: (gas * 12n) / 10n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    return { hash: keccak256(raw), raw, nonce };
  }

  function tokensTo(receipt: TransactionReceipt, to: Address): bigint {
    let total = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (ev.eventName === "Transfer" && ev.args.to.toLowerCase() === to.toLowerCase()) total += ev.args.value;
      } catch {
        // not a Transfer
      }
    }
    return total;
  }

  function claimFrom(receipt: TransactionReceipt, asset: "eth" | "token"): ClaimEvent | null {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== c.ponsFeeEscrow.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: ponsEscrowAbi, data: log.data, topics: log.topics });
        if (ev.args.recipient.toLowerCase() !== account.address.toLowerCase()) continue;
        if (asset === "eth" && ev.eventName === "Claimed") {
          return { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber, asset, amount: ev.args.amount };
        }
        if (asset === "token" && ev.eventName === "ClaimedToken" && ev.args.token.toLowerCase() === token.toLowerCase()) {
          return { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber, asset, amount: ev.args.amount };
        }
      } catch {
        // other escrow event
      }
    }
    return null;
  }

  return {
    wallet: account.address,

    blockNumber: () => client.getBlockNumber(),

    launch: async () => (await loadLaunch()).state,

    claimableEth: () =>
      client.readContract({ address: c.ponsFeeEscrow, abi: ponsEscrowAbi, functionName: "balanceOf", args: [account.address] }),

    claimableToken: () =>
      client.readContract({
        address: c.ponsFeeEscrow,
        abi: ponsEscrowAbi,
        functionName: "balanceOfToken",
        args: [account.address, token],
      }),

    ethBalance: () => client.getBalance({ address: account.address }),

    async ethUsd() {
      const [decimals, round] = await Promise.all([
        client.readContract({ address: c.chainlinkEthUsd, abi: chainlinkAbi, functionName: "decimals" }),
        client.readContract({ address: c.chainlinkEthUsd, abi: chainlinkAbi, functionName: "latestRoundData" }),
      ]);
      const [, answer, , updatedAt] = round;
      const age = BigInt(Math.floor(Date.now() / 1000)) - updatedAt;
      if (answer <= 0n || age > BigInt(BOT.maxPriceAgeSeconds)) return null;
      // Normalise to 8 decimals.
      return decimals === 8 ? answer : decimals > 8 ? answer / 10n ** BigInt(decimals - 8) : answer * 10n ** BigInt(8 - decimals);
    },

    gasPrice: () => client.getGasPrice(),

    estimateClaimGas: (asset) =>
      client.estimateGas({
        account: account.address,
        to: c.ponsFeeEscrow,
        data:
          asset === "eth"
            ? encodeFunctionData({ abi: ponsEscrowAbi, functionName: "claim", args: [] })
            : encodeFunctionData({ abi: ponsEscrowAbi, functionName: "claimToken", args: [token] }),
      }),

    async quoteEthForToken(amountIn) {
      const k = await poolKey();
      if (k.currency0 !== zeroAddress) throw new Error("pool is not ETH-paired");
      const { result } = await client.simulateContract({
        address: c.uniswapV4Quoter,
        abi: v4QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey: k, zeroForOne: true, exactAmount: amountIn, hookData: "0x" }],
      });
      return result[0];
    },

    async claimEvents(from, to) {
      const out: ClaimEvent[] = [];
      for (let start = from; start <= to; start += LOG_CHUNK) {
        const end = start + LOG_CHUNK - 1n > to ? to : start + LOG_CHUNK - 1n;
        const [eth, tok] = await Promise.all([
          client.getContractEvents({
            address: c.ponsFeeEscrow,
            abi: ponsEscrowAbi,
            eventName: "Claimed",
            args: { recipient: account.address },
            fromBlock: start,
            toBlock: end,
          }),
          client.getContractEvents({
            address: c.ponsFeeEscrow,
            abi: ponsEscrowAbi,
            eventName: "ClaimedToken",
            args: { recipient: account.address, token },
            fromBlock: start,
            toBlock: end,
          }),
        ]);
        for (const e of eth) out.push({ txHash: e.transactionHash, blockNumber: e.blockNumber, asset: "eth", amount: e.args.amount! });
        for (const e of tok) out.push({ txHash: e.transactionHash, blockNumber: e.blockNumber, asset: "token", amount: e.args.amount! });
      }
      return out.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
    },

    async claim(asset) {
      const call =
        asset === "eth"
          ? ({ address: c.ponsFeeEscrow, abi: ponsEscrowAbi, functionName: "claim", args: [] } as const)
          : ({ address: c.ponsFeeEscrow, abi: ponsEscrowAbi, functionName: "claimToken", args: [token] } as const);
      // Headroom over the estimate, like the swap and burn: a claim zeroes a balance, and the storage refund can
      // make a bare estimate too low to run.
      const gas = await client.estimateContractGas({ ...call, account: account.address } as Parameters<PublicClient["estimateContractGas"]>[0]);
      const hash = await needSigner().wallet.writeContract({ ...call, gas: (gas * 13n) / 10n } as Parameters<NonNullable<typeof wallet>["writeContract"]>[0]);
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
        if (receipt.status !== "success") throw new Error(`claim reverted: ${hash}`);
        return claimFrom(receipt, asset);
      } catch (err) {
        if (err instanceof Error && /timed out/i.test(err.message)) return null; // found from the chain next run
        throw err;
      }
    },

    async signSwap(amountIn, minOut) {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + BOT.swapDeadlineSeconds);
      return sign(c.uniswapUniversalRouter, encodeEthToTokenSwap(await poolKey(), amountIn, minOut, deadline), amountIn);
    },

    signBurn: (amount) =>
      sign(token, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [dead, amount] }), 0n),

    async broadcast(tx) {
      await client.sendRawTransaction({ serializedTransaction: tx.raw });
    },

    async txStatus(tx, kind, timeoutMs): Promise<TxStatus> {
      let receipt: TransactionReceipt | null = null;
      try {
        receipt = await client.waitForTransactionReceipt({ hash: tx.hash, timeout: timeoutMs });
      } catch {
        receipt = await client.getTransactionReceipt({ hash: tx.hash }).catch(() => null);
      }
      if (receipt) {
        if (receipt.status !== "success") return { status: "reverted" };
        if (kind === "swap") return { status: "success", tokensReceived: tokensTo(receipt, account.address) };
        return { status: "success" };
      }
      const mined = await client.getTransactionCount({ address: account.address, blockTag: "latest" });
      if (mined > tx.nonce) {
        // The nonce is used; if our hash still has no receipt, another transaction took it.
        const again = await client.getTransactionReceipt({ hash: tx.hash }).catch(() => null);
        if (!again) return { status: "dropped" };
        return again.status === "success"
          ? { status: "success", tokensReceived: kind === "swap" ? tokensTo(again, account.address) : undefined }
          : { status: "reverted" };
      }
      return { status: "pending" };
    },

    tokenBalanceOfDead: () => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [dead] }),
  };
}
