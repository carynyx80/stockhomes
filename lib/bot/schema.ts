/** Fee bot schema. Applied automatically (idempotent) on first use. Amounts are numeric(78,0): exact wei / base units. */
export const SCHEMA_SQL = /* sql */ `

create table if not exists bot_state (
  key   text primary key,
  value text not null
);

create table if not exists burn_obligations (
  id              serial primary key,
  source_tx       text not null unique,          -- the claim transaction; one obligation per claim, ever
  asset           text not null check (asset in ('eth', 'token')),
  claimed_amount  numeric(78, 0) not null,
  owed_amount     numeric(78, 0) not null,       -- ETH to spend (asset=eth) or tokens to burn (asset=token)
  state           text not null check (state in ('owed', 'swap_sent', 'to_burn', 'burn_sent', 'burned')),
  swap_hash       text,
  swap_raw        text,                          -- signed transaction, re-broadcast verbatim on retry
  swap_nonce      integer,
  tokens_bought   numeric(78, 0),
  burn_hash       text,
  burn_raw        text,
  burn_nonce      integer,
  burned_amount   numeric(78, 0),
  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  burned_at       timestamptz
);

create index if not exists burn_obligations_open on burn_obligations (id) where state <> 'burned';

create table if not exists bot_runs (
  id             serial primary key,
  network        text not null,
  dry_run        boolean not null,
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  outcome        text not null,
  message        text not null,
  claimable_wei  numeric(78, 0),
  claimable_usd  numeric(78, 0),                 -- 8 decimals
  eth_usd        numeric(78, 0),                 -- 8 decimals
  claim_tx       text,
  log            jsonb not null default '[]'
);

create index if not exists bot_runs_started on bot_runs (started_at desc);
`;
