/**
 * Open House schema. Idempotent; applied on first use (like the fee bot's). Amounts are numeric(78,0) in
 * USDG / price fixed point. agent_battles and agent_fee_runs are created now and used from phases B and C.
 */
export const OPEN_HOUSE_SCHEMA_SQL = /* sql */ `
create table if not exists agents (
  id                    serial primary key,
  slug                  text not null unique,
  name                  text not null,
  persona               text not null,
  strategy              text not null,
  strategy_kind         text not null,
  cities                text[] not null,
  max_leverage          integer not null default 10,
  max_position_pct      integer not null default 20,
  max_open_positions    integer not null default 3,
  daily_loss_limit_pct  integer not null default 15,
  starting_bankroll     numeric(78, 0) not null,
  cash                  numeric(78, 0) not null,
  status                text not null default 'active' check (status in ('active', 'paused', 'boarded_up')),
  wallet_address        text,
  token_address         text,
  visual_seed           text not null,
  followers             integer not null default 0,
  views                 integer not null default 0,
  day_start_equity      numeric(78, 0) not null,
  day_key               text not null,
  loss_limit_streak     integer not null default 0,
  loss_limit_hit_today  boolean not null default false,
  next_tick_at          timestamptz not null,
  last_tick_at          timestamptz,
  last_big_at           timestamptz,
  boarded_at            timestamptz,
  thinking_lines        text[] not null default '{}',
  farewell              text not null default '',
  created_at            timestamptz not null default now()
);
create index if not exists agents_due on agents (next_tick_at) where status = 'active';

create table if not exists agent_trades (
  id                 text primary key,
  agent_id           integer not null references agents(id),
  market             text not null,
  side               text not null check (side in ('long', 'short')),
  leverage           integer not null,
  collateral         numeric(78, 0) not null,
  notional           numeric(78, 0) not null,
  entry_price        numeric(78, 0) not null,
  liquidation_price  numeric(78, 0) not null,
  open_fee           numeric(78, 0) not null,
  equity_at_open     numeric(78, 0) not null,
  status             text not null check (status in ('open', 'closed', 'liquidated')),
  exit_price         numeric(78, 0),
  close_fee          numeric(78, 0),
  realised_pnl       numeric(78, 0),
  reason             text not null default '',
  tx_hash            text,
  opened_at          timestamptz not null,
  closed_at          timestamptz
);
create index if not exists agent_trades_agent on agent_trades (agent_id, opened_at desc);
create index if not exists agent_trades_open on agent_trades (agent_id) where status = 'open';

create table if not exists agent_ticks (
  id             bigserial primary key,
  agent_id       integer not null references agents(id),
  at             timestamptz not null,
  model          text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_micros    bigint not null default 0,
  decision       jsonb,
  outcome        text not null,
  notes          jsonb not null default '[]',
  equity         numeric(78, 0) not null
);
create index if not exists agent_ticks_agent on agent_ticks (agent_id, at desc);
create index if not exists agent_ticks_at on agent_ticks (at);

create table if not exists agent_commentary (
  id          bigserial primary key,
  agent_id    integer not null references agents(id),
  agent_slug  text not null,
  kind        text not null,
  text        text not null,
  trade_id    text,
  battle_id   integer,
  created_at  timestamptz not null default now()
);
create index if not exists agent_commentary_agent on agent_commentary (agent_id, id desc);

create table if not exists agent_battles (
  id          serial primary key,
  agent_a     integer not null references agents(id),
  agent_b     integer not null references agents(id),
  market      text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'scheduled',
  result      text,
  created_at  timestamptz not null default now()
);

create table if not exists chat_messages (
  id          bigserial primary key,
  agent_id    integer not null references agents(id),
  nickname    text not null,
  text        text not null,
  ip_hash     text not null,
  hidden      boolean not null default false,
  reports     integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_agent on chat_messages (agent_id, id desc) where not hidden;

create table if not exists agent_follows (
  agent_id      integer not null references agents(id),
  follower_key  text not null,
  created_at    timestamptz not null default now(),
  primary key (agent_id, follower_key)
);

create table if not exists agent_fee_runs (
  id           serial primary key,
  agent_id     integer not null references agents(id),
  started_at   timestamptz not null,
  outcome      text not null,
  claimed_wei  numeric(78, 0),
  bankroll_wei numeric(78, 0),
  burn_wei     numeric(78, 0),
  dev_wei      numeric(78, 0),
  details      jsonb not null default '{}'
);
`;
