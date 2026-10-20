import "server-only";
import postgres from "postgres";
import type { Hex } from "viem";
import { SCHEMA_SQL } from "./schema";
import type { Obligation, ObligationState, RunRecord, StorePort } from "./types";

let sql: postgres.Sql | null = null;
let migrated: Promise<void> | null = null;

export function db(url: string): postgres.Sql {
  sql ??= postgres(url, { max: 1, idle_timeout: 20, prepare: false });
  migrated ??= sql.unsafe(SCHEMA_SQL).then(() => undefined);
  return sql;
}

async function ready(url: string) {
  const s = db(url);
  await migrated;
  return s;
}

type Row = Record<string, unknown>;
const big = (v: unknown) => (v == null ? undefined : BigInt(String(v)));

function toObligation(r: Row): Obligation {
  return {
    id: Number(r.id),
    sourceTx: r.source_tx as Hex,
    asset: r.asset as "eth" | "token",
    claimedAmount: BigInt(String(r.claimed_amount)),
    owedAmount: BigInt(String(r.owed_amount)),
    state: r.state as ObligationState,
    swap: r.swap_hash ? { hash: r.swap_hash as Hex, raw: r.swap_raw as Hex, nonce: Number(r.swap_nonce) } : undefined,
    tokensBought: big(r.tokens_bought),
    burn: r.burn_hash ? { hash: r.burn_hash as Hex, raw: r.burn_raw as Hex, nonce: Number(r.burn_nonce) } : undefined,
    burnedAmount: big(r.burned_amount),
    attempts: Number(r.attempts),
    lastError: (r.last_error as string) ?? undefined,
    createdAt: new Date(r.created_at as string),
    burnedAt: r.burned_at ? new Date(r.burned_at as string) : undefined,
  };
}

export function pgStore(url: string): StorePort {
  return {
    async addObligation(o) {
      const s = await ready(url);
      const rows = await s`
        insert into burn_obligations (source_tx, asset, claimed_amount, owed_amount, state, tokens_bought)
        values (${o.sourceTx}, ${o.asset}, ${o.claimedAmount.toString()}, ${o.owedAmount.toString()}, ${o.state},
                ${o.tokensBought != null ? o.tokensBought.toString() : null})
        on conflict (source_tx) do nothing
        returning id`;
      return rows.length === 1;
    },

    async openObligations() {
      const s = await ready(url);
      const rows = await s`select * from burn_obligations where state <> 'burned' order by id`;
      return rows.map(toObligation);
    },

    async transition(id, from, patch) {
      const s = await ready(url);
      const set: Row = { state: patch.state, updated_at: new Date() };
      if ("swap" in patch) {
        set.swap_hash = patch.swap?.hash ?? null;
        set.swap_raw = patch.swap?.raw ?? null;
        set.swap_nonce = patch.swap?.nonce ?? null;
      }
      if ("burn" in patch) {
        set.burn_hash = patch.burn?.hash ?? null;
        set.burn_raw = patch.burn?.raw ?? null;
        set.burn_nonce = patch.burn?.nonce ?? null;
      }
      if (patch.tokensBought != null) set.tokens_bought = patch.tokensBought.toString();
      if (patch.burnedAmount != null) set.burned_amount = patch.burnedAmount.toString();
      if (patch.burnedAt) set.burned_at = patch.burnedAt;
      if (patch.attempts != null) set.attempts = patch.attempts;
      const rows = await s`
        update burn_obligations set ${s(set)}
        where id = ${id} and state = ${from}
        returning id`;
      return rows.length === 1;
    },

    async noteError(id, error) {
      const s = await ready(url);
      await s`update burn_obligations set last_error = ${error}, updated_at = now() where id = ${id}`;
    },

    async getCursor() {
      const s = await ready(url);
      const rows = await s`select value from bot_state where key = 'scan_cursor'`;
      return rows.length ? BigInt(rows[0].value as string) : null;
    },

    async setCursor(block) {
      const s = await ready(url);
      await s`
        insert into bot_state (key, value) values ('scan_cursor', ${block.toString()})
        on conflict (key) do update set value = excluded.value`;
    },

    async recordRun(r: RunRecord) {
      const s = await ready(url);
      await s`
        insert into bot_runs (network, dry_run, started_at, finished_at, outcome, message,
                              claimable_wei, claimable_usd, eth_usd, claim_tx, log)
        values (${r.network}, ${r.dryRun}, ${r.startedAt}, ${r.finishedAt}, ${r.outcome}, ${r.message},
                ${r.claimableWei?.toString() ?? null}, ${r.claimableUsd?.toString() ?? null},
                ${r.ethUsd?.toString() ?? null}, ${r.claimTx ?? null}, ${s.json(r.log)})`;
    },
  };
}

export type BurnsSummary = {
  totalBurned: bigint;
  totalClaimedWei: bigint;
  burns: { id: number; amount: bigint; txHash: string; at: string; sourceTx: string }[];
  owed: number;
  lastRun: { at: string; outcome: string; dryRun: boolean } | null;
};

/** Read model for the public /api/burns endpoint. */
export async function burnsSummary(url: string, limit = 25): Promise<BurnsSummary> {
  const s = await ready(url);
  const [totals] = await s`
    select coalesce(sum(burned_amount) filter (where state = 'burned'), 0)::text as burned,
           coalesce(sum(claimed_amount) filter (where asset = 'eth'), 0)::text as claimed,
           count(*) filter (where state <> 'burned')::int as owed
    from burn_obligations`;
  const burns = await s`
    select id, burned_amount::text as amount, burn_hash, burned_at, source_tx
    from burn_obligations where state = 'burned' and burned_amount > 0
    order by burned_at desc limit ${limit}`;
  const [last] = await s`
    select finished_at, outcome, dry_run from bot_runs order by started_at desc limit 1`;
  return {
    totalBurned: BigInt(totals.burned as string),
    totalClaimedWei: BigInt(totals.claimed as string),
    owed: totals.owed as number,
    burns: burns.map((b) => ({
      id: Number(b.id),
      amount: BigInt(b.amount as string),
      txHash: b.burn_hash as string,
      at: new Date(b.burned_at as string).toISOString(),
      sourceTx: b.source_tx as string,
    })),
    lastRun: last
      ? { at: new Date(last.finished_at as string).toISOString(), outcome: last.outcome as string, dryRun: Boolean(last.dry_run) }
      : null,
  };
}
