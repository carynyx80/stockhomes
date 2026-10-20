import { DECIMALS, SIMULATED } from "@/config/stoxhomes";
import {
  feeOf,
  isLiquidatable,
  liquidationPrice,
  notionalOf,
  pnlOf,
} from "@/lib/perp/math";
import { DAY, HOUR, MINUTE, priceAt, series } from "@/lib/sim/feeds";
import { MARKETS } from "@/lib/sim/markets";
import { apr7dAt, longSkewAt, sharePriceAt, tvlAt, utilizationAt } from "@/lib/sim/vault";
import { changeBps, pairings, rivalStandings, roundAt, roundBounds, seasonOf } from "@/lib/sim/wars";
import type {
  Account,
  ClosedTrade,
  DataSource,
  HistoryRange,
  LeaderRow,
  OpenPositionRequest,
  Position,
  PricePoint,
  Quote,
  Snapshot,
  VaultHolding,
  WarEntry,
  WarMatch,
  WarSide,
} from "./types";

const USDG = 10n ** BigInt(DECIMALS.usdg);
const PRICE_ONE = 10n ** BigInt(DECIMALS.price);
const STORAGE_KEY = "stoxhomes:paper:v1";
const HISTORY_CAP = 50;

export const toUsdg = (n: number) => BigInt(Math.round(n * Number(USDG)));
export const toPrice = (n: number) => BigInt(Math.round(n * Number(PRICE_ONE)));

const RANGES: Record<HistoryRange, { span: number; step: number }> = {
  "1D": { span: DAY, step: 5 * MINUTE },
  "1W": { span: 7 * DAY, step: HOUR },
  "1M": { span: 30 * DAY, step: 4 * HOUR },
  "6M": { span: 182 * DAY, step: DAY },
  "1Y": { span: 365 * DAY, step: DAY },
};

type PaperState = {
  account: Account;
  vault: VaultHolding;
  wars: WarEntry[];
};

function freshState(): PaperState {
  return {
    account: { balance: toUsdg(SIMULATED.startingBalanceUsdg), positions: [], history: [] },
    vault: { shares: 0n, costBasis: 0n },
    wars: [],
  };
}

// JSON with bigints tagged as {"$n":"123"}.
const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? { $n: v.toString() } : v);
const reviver = (_: string, v: unknown) =>
  v && typeof v === "object" && "$n" in v && typeof (v as { $n: unknown }).$n === "string"
    ? BigInt((v as { $n: string }).$n)
    : v;

function load(): PaperState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw, reviver) as PaperState;
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  return freshState();
}

function save(state: PaperState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state, replacer));
  } catch {
    // Paper state just won't survive a reload.
  }
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function createSimulatedSource(): DataSource {
  let state: PaperState | null = null;
  let snapshot: Snapshot | null = null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const paper = () => (state ??= load());

  const commit = () => {
    save(paper());
    rebuild();
  };

  function quoteAt(marketId: string, now: number): Quote {
    const p = priceAt(marketId, now);
    const prev = priceAt(marketId, now - DAY);
    return { marketId, price: toPrice(p), change24hBps: Math.round((p / prev - 1) * 10_000), at: now };
  }

  /** Liquidate underwater positions and settle finished War rounds. Returns true if anything changed. */
  function housekeeping(now: number, quotes: Record<string, Quote>): boolean {
    const s = paper();
    let changed = false;

    const survivors: Position[] = [];
    for (const pos of s.account.positions) {
      const mark = quotes[pos.marketId].price;
      if (isLiquidatable(pos.side, pos.entryPrice, pos.collateral, pos.notional, mark, SIMULATED.maintenanceMarginBps)) {
        s.account.history.unshift({
          id: pos.id,
          marketId: pos.marketId,
          side: pos.side,
          leverage: pos.leverage,
          collateral: pos.collateral,
          notional: pos.notional,
          entryPrice: pos.entryPrice,
          exitPrice: mark,
          realisedPnl: -(pos.collateral + pos.openFee),
          closedAt: now,
          reason: "liquidated",
        });
        changed = true;
      } else {
        survivors.push(pos);
      }
    }
    s.account.positions = survivors;
    s.account.history = s.account.history.slice(0, HISTORY_CAP);

    for (const entry of s.wars) {
      if (entry.settlement) continue;
      const { endsAt } = roundBounds(entry.round);
      if (now < endsAt) continue;
      const match = pairings(entry.round).find((m) => m.id === entry.matchId);
      if (!match) continue;
      const a = changeBps(match.a, entry.round, endsAt);
      const b = changeBps(match.b, entry.round, endsAt);
      const result: WarSide | "push" = a === b ? "push" : a > b ? "a" : "b";
      const payout =
        result === "push"
          ? entry.stake
          : result === entry.pick
            ? (entry.stake * BigInt(Math.round(SIMULATED.wars.payoutMultiplier * 100))) / 100n
            : 0n;
      entry.settlement = { result, payout };
      s.account.balance += payout;
      changed = true;
    }
    return changed;
  }

  function matchesFor(round: number, now: number): WarMatch[] {
    const { startsAt, endsAt } = roundBounds(round);
    return pairings(round).map(({ id, a, b }) => {
      const changeABps = changeBps(a, round, now);
      const changeBBps = changeBps(b, round, now);
      const ended = now >= endsAt;
      return {
        id,
        round,
        a,
        b,
        startsAt,
        endsAt,
        changeABps,
        changeBBps,
        result: ended ? (changeABps === changeBBps ? "push" : changeABps > changeBBps ? "a" : "b") : undefined,
      };
    });
  }

  function leaderboard(round: number, now: number, entries: WarEntry[]): LeaderRow[] {
    const season = seasonOf(round);
    const rows: LeaderRow[] = rivalStandings(round, now).map((r) => ({
      handle: r.handle,
      pnl: toUsdg(r.pnl),
      wins: r.wins,
      played: r.played,
    }));
    const mine = entries.filter((e) => seasonOf(e.round) === season && e.settlement);
    rows.push({
      handle: "you",
      isYou: true,
      pnl: mine.reduce((sum, e) => sum + e.settlement!.payout - e.stake, 0n),
      wins: mine.filter((e) => e.settlement!.result === e.pick).length,
      played: mine.length,
    });
    return rows.sort((x, y) => (y.pnl > x.pnl ? 1 : y.pnl < x.pnl ? -1 : 0));
  }

  function rebuild(notify = true) {
    const now = Date.now();
    const quotes: Record<string, Quote> = {};
    for (const m of MARKETS) quotes[m.id] = quoteAt(m.id, now);
    if (housekeeping(now, quotes)) save(paper());

    const s = paper();
    const round = roundAt(now);
    const tvl = tvlAt(now);
    const oi = tvl * utilizationAt(now);
    snapshot = {
      now,
      quotes,
      account: { ...s.account, positions: [...s.account.positions], history: [...s.account.history] },
      vault: {
        tvl: toUsdg(tvl),
        sharePrice: toPrice(sharePriceAt(now)),
        apr7dBps: Math.round(apr7dAt(now) * 10_000),
        utilizationBps: Math.round(utilizationAt(now) * 10_000),
        openInterestLong: toUsdg(oi * longSkewAt(now)),
        openInterestShort: toUsdg(oi * (1 - longSkewAt(now))),
      },
      vaultHolding: { ...s.vault },
      wars: {
        round,
        season: seasonOf(round),
        roundEndsAt: roundBounds(round).endsAt,
        current: matchesFor(round, now),
        previous: matchesFor(round - 1, now),
        entries: s.wars.map((e) => ({ ...e })),
        leaderboard: leaderboard(round, now, s.wars),
      },
    };
    if (notify) for (const l of listeners) l();
  }

  const markOf = (marketId: string) => toPrice(priceAt(marketId, Date.now()));

  return {
    mode: "simulated",
    markets: MARKETS,

    subscribe(listener) {
      listeners.add(listener);
      if (!timer) timer = setInterval(() => rebuild(), SIMULATED.tickMs);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },

    getSnapshot() {
      // Called during render: build quietly, never notify from here.
      if (!snapshot) rebuild(false);
      return snapshot!;
    },

    async getHistory(marketId, range) {
      const { span, step } = RANGES[range];
      const now = Date.now();
      return series(marketId, now - span, now, step).map((p) => ({ t: p.t, price: toPrice(p.price) }));
    },

    async getVaultHistory(range) {
      const { span, step } = RANGES[range];
      const now = Date.now();
      const out: PricePoint[] = [];
      for (let t = Math.max(SIMULATED.genesis, now - span); t < now; t += step) {
        out.push({ t, price: toPrice(sharePriceAt(t)) });
      }
      out.push({ t: now, price: toPrice(sharePriceAt(now)) });
      return out;
    },

    async openPosition({ marketId, side, collateral, leverage }: OpenPositionRequest) {
      const s = paper();
      if (!MARKETS.some((m) => m.id === marketId)) throw new Error("Unknown market.");
      if (leverage < 1 || leverage > 100 || !Number.isInteger(leverage)) throw new Error("Leverage must be 1–100x.");
      if (collateral < toUsdg(SIMULATED.minCollateralUsdg)) {
        throw new Error(`Minimum collateral is ${SIMULATED.minCollateralUsdg} USDG.`);
      }
      const notional = notionalOf(collateral, leverage);
      const openFee = feeOf(notional, SIMULATED.openFeeBps);
      if (collateral + openFee > s.account.balance) throw new Error("Not enough paper USDG for collateral plus fee.");
      const entryPrice = markOf(marketId);
      const position: Position = {
        id: newId("pos"),
        marketId,
        side,
        leverage,
        collateral,
        notional,
        entryPrice,
        liquidationPrice: liquidationPrice(side, entryPrice, collateral, notional, SIMULATED.maintenanceMarginBps),
        openFee,
        openedAt: Date.now(),
      };
      s.account.balance -= collateral + openFee;
      s.account.positions.unshift(position);
      commit();
      return position;
    },

    async closePosition(positionId) {
      const s = paper();
      const pos = s.account.positions.find((p) => p.id === positionId);
      if (!pos) throw new Error("Position not found. It may have been liquidated.");
      const exitPrice = markOf(pos.marketId);
      const pnl = pnlOf(pos.side, pos.notional, pos.entryPrice, exitPrice);
      const closeFee = feeOf(pos.notional, SIMULATED.closeFeeBps);
      const gross = pos.collateral + pnl - closeFee;
      const returned = gross > 0n ? gross : 0n;
      const trade: ClosedTrade = {
        id: pos.id,
        marketId: pos.marketId,
        side: pos.side,
        leverage: pos.leverage,
        collateral: pos.collateral,
        notional: pos.notional,
        entryPrice: pos.entryPrice,
        exitPrice,
        realisedPnl: returned - pos.collateral - pos.openFee,
        closedAt: Date.now(),
        reason: "closed",
      };
      s.account.balance += returned;
      s.account.positions = s.account.positions.filter((p) => p.id !== positionId);
      s.account.history = [trade, ...s.account.history].slice(0, HISTORY_CAP);
      commit();
      return trade;
    },

    async deposit(amount) {
      const s = paper();
      if (amount <= 0n) throw new Error("Enter an amount.");
      if (amount > s.account.balance) throw new Error("Not enough paper USDG.");
      const price = toPrice(sharePriceAt(Date.now()));
      s.vault.shares += (amount * PRICE_ONE) / price;
      s.vault.costBasis += amount;
      s.account.balance -= amount;
      commit();
    },

    async withdraw(shares) {
      const s = paper();
      if (shares <= 0n) throw new Error("Enter an amount.");
      if (shares > s.vault.shares) throw new Error("You don't hold that many shares.");
      const price = toPrice(sharePriceAt(Date.now()));
      const amount = (shares * price) / PRICE_ONE;
      s.vault.costBasis -= (s.vault.costBasis * shares) / s.vault.shares;
      s.vault.shares -= shares;
      s.account.balance += amount;
      commit();
    },

    async enterWar(matchId, pick, stake) {
      const s = paper();
      const now = Date.now();
      const round = roundAt(now);
      if (!pairings(round).some((m) => m.id === matchId)) throw new Error("That match isn't open.");
      if (s.wars.some((e) => e.matchId === matchId)) throw new Error("You've already picked a side in this match.");
      if (stake < toUsdg(SIMULATED.wars.minStakeUsdg)) {
        throw new Error(`Minimum stake is ${SIMULATED.wars.minStakeUsdg} USDG.`);
      }
      if (stake > s.account.balance) throw new Error("Not enough paper USDG.");
      s.account.balance -= stake;
      s.wars.unshift({ matchId, round, pick, stake, enteredAt: now });
      commit();
    },

    async resetPaper() {
      state = freshState();
      commit();
    },
  };
}
