# Stoxhomes

A housing-price perpetuals exchange on Robinhood Chain: go long or short on city home prices with up to 100x leverage,
settled in USDG. The site is a house you walk into, and each section is a room:

| Room | Route | Status |
|---|---|---|
| The Trading Floor | `/trade` | Simulated: mock city feeds, paper positions |
| The Vault | `/vault` | Simulated: paper deposits into the House pool |
| The Fireplace | `/burn` | **Live**: reads real on-chain burns |
| The Study | `/stake` | Placeholder |
| The Parlour | `/wars` | Simulated: weekly City Wars and a leaderboard |
| The Library | `/docs` | How it works, fees, risks, verified contracts |

The token (`$STOXH`, set once in [config/stoxhomes.ts](config/stoxhomes.ts)) launches on Pons V2. A keeper claims its
creator fees and spends 20% of each claim buying the token back and burning it.

> **Nothing here moves money until you change two settings yourself:** `TOKEN_ADDRESS` and `DRY_RUN=false`.

---

## Contents

1. [Local setup](#1-local-setup)
2. [Environment variables](#2-environment-variables)
3. [How the fee bot works](#3-how-the-fee-bot-works)
4. [Deploying to Vercel](#4-deploying-to-vercel)
5. [Launch checklist](#5-launch-checklist)
6. [Going from dry run to live](#6-going-from-dry-run-to-live)
7. [Rotating the key](#7-rotating-the-key)
8. [Tests](#8-tests)
9. [Project layout](#9-project-layout)
10. [Trust assumptions and limits](#10-trust-assumptions-and-limits)
11. [Risk disclosure](#11-risk-disclosure)

---

## 1. Local setup

Requires Node 22+. On this machine Node lives in `~/.local/node` and Foundry (for the fork test) in `~/.local/foundry`:

```bash
export PATH=$HOME/.local/foundry/bin:$HOME/.local/node/bin:$PATH
```

```bash
npm install
```

```bash
npm run dev
```

The dev server runs on port 3000 by default (`npx next dev -p 3100` if 3000 is taken). Without a `.env.local` the site
runs in its safe default state: testnet, no token, dry run. Every room works and the Fireplace shows "not yet lit".

## 2. Environment variables

Copy [.env.example](.env.example) to `.env.local` for local work. In production, set them in Vercel → Project →
Settings → Environment Variables. **Never commit a filled-in env file** (`.env*` is git-ignored, except the example).

| Variable | Default | What it does |
|---|---|---|
| `NETWORK` | `testnet` | `testnet` (46630) or `mainnet` (4663). Pons V2 and Uniswap v4 only exist on mainnet; on testnet the bot only exercises its lock and database. |
| `RPC_URL_TESTNET` / `RPC_URL_MAINNET` | Robinhood public RPC | Use a dedicated provider for the bot; the public endpoint rate-limits. |
| `TOKEN_ADDRESS` | empty | `$STOXH` once launched. Empty = the bot idles and the Fireplace waits. |
| `CREATOR_PRIVATE_KEY` | empty | Key of the **dedicated payout wallet**. Server-only, only needed for live runs. |
| `PAYOUT_WALLET_ADDRESS` | empty | That wallet's address. Lets dry runs read everything with no key present. |
| `CLAIM_THRESHOLD_USD` | `100` | Claim only when the escrow holds at least this much. |
| `BURN_SHARE_BPS` | `2000` | Share of each claim spent on buyback and burn (2000 = 20%). |
| `MAX_SLIPPAGE_BPS` | `200` | Swap minimum = quoter output minus this (200 = 2%). |
| `MIN_GAS_ETH` | `0.002` | ETH the bot never spends, kept for gas. |
| `DRY_RUN` | `true` | `true` = read and log only, never send. **Only you change this.** |
| `BOT_START_BLOCK` | first live run | First block to scan for claims made outside the bot. |
| `CRON_SECRET` | empty | Long random string. Without it the cron endpoint refuses every call. |
| `DATABASE_URL` | empty | Postgres (Supabase, Neon / Vercel Postgres, …). Tables are created automatically. Required for live runs. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | empty | Upstash Redis / Vercel KV, used for the run lock. Required for live runs. (`KV_URL` is listed for completeness; the bot uses the REST pair.) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | empty | Optional alerts. Without them, alerts go to the server log. |

Other tunables (the gas-guard share, price staleness, swap deadline, lock TTL, verified contract addresses) live in
[config/stoxhomes.ts](config/stoxhomes.ts).

## 3. How the fee bot works

The brief named the Pons V1 factory and locker, but V1 stopped launching tokens. New launches use **Pons V2**, which the
bot targets. Every address and function was read from verified source; see
[docs/VERIFIED_CONTRACTS.md](docs/VERIFIED_CONTRACTS.md).

**Where the fees come from.** Trades in the token's Uniswap v4 pool pay a hook fee plus your creator tax. Pons sweeps
them, converts any token-side portion to ETH, and credits your share to the `PonsV2FeeEscrow`. You (the recipient) claim
with `claim()`.

**Every run** (Vercel Cron, every 10 minutes, `GET /api/cron/fees` with `Authorization: Bearer $CRON_SECRET`):

1. **Lock.** A Redis lock (`SET NX EX`, released only by its owner) means two runs never overlap.
2. **Wait for graduation.** Before the token graduates from its bonding curve to the v4 pool, the bot does nothing.
   Fees sit safely in the escrow. The curve contracts aren't verified, so the bot never trades on them.
3. **Record every claim.** Every `Claimed` event for the payout wallet becomes one *burn obligation* worth 20% of that
   claim, keyed by transaction hash, so each claim is counted exactly once. This also catches claims you make by hand
   on the Pons site.
4. **Owed burns first.** Unfinished obligations are completed oldest-first. Until they're done, nothing new is claimed.
5. **Threshold and guards.** It reads ETH/USD from Chainlink; a stale price skips the run with an alert. It claims only
   when the escrow holds at least $100, skips if gas would cost more than 5% of the claim, and never spends below
   `MIN_GAS_ETH`.
6. **Claim → buy → burn.** It claims, takes the amount actually received from the `Claimed` event (not the estimate),
   and spends exactly 20% buying `$STOXH` through Uniswap's Universal Router. The minimum output comes from the V4
   quoter minus slippage. It then transfers exactly the tokens the swap delivered to
   `0x000000000000000000000000000000000000dEaD`. The other 80% is never touched.
7. **Log and alert.** Every run is stored in `bot_runs`; burns and failures go to Telegram.

**Why it can't double-burn or silently skip a burn.** Each swap and burn transaction is signed with a fixed nonce and
saved to the database *before* it is broadcast. A retry re-broadcasts the same signed transaction, which can only land
once. A new one is signed only when the chain proves the old one can't land (its nonce was used by something else and
it has no receipt). A swap that reverts returns the obligation to "owed"; a burn that fails returns it to "to burn".

**Public data.** `GET /api/burns` serves the burn ledger, total claimed, owed burns, last run and next check. It also
returns the dead address's real on-chain balance, so anyone can cross-check (that balance includes burns by others).

## 4. Deploying to Vercel

1. Import the repo into Vercel.
2. **Plan:** Vercel Cron every 10 minutes needs the **Pro** plan; Hobby only allows daily crons. The schedule is in
   [vercel.json](vercel.json).
3. Create a Postgres database (Supabase or Vercel/Neon) and an Upstash Redis (Vercel KV) and add their variables.
4. Add `CRON_SECRET` (for example `openssl rand -hex 32`). Vercel sends it automatically to cron routes.
5. Leave `DRY_RUN=true` and `TOKEN_ADDRESS` empty for the first deploy. The site works, the Fireplace says "not yet lit",
   and the cron runs harmlessly.
6. Geo-blocking reads Vercel's `x-vercel-ip-country` header, so it only takes effect on Vercel. Blocked countries are
   in `GEO` in [config/stoxhomes.ts](config/stoxhomes.ts); have them reviewed by counsel.

To trigger a run by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/fees
```

## 5. Launch checklist

When creating the token on Pons V2:

- [ ] **Pair with native ETH.** The bot refuses other pairs.
- [ ] **Creator fee recipient = a brand-new wallet** used for nothing else. The escrow balance is per address and adds up
      fees from *every* token paid to it; a shared wallet would make the bot burn 20% of unrelated fees.
- [ ] **Leave Pons buyback off.** Pons's own buyback vests tokens in a vault for five years; it doesn't burn them.
- [ ] Fund the payout wallet with a little ETH for gas (more than `MIN_GAS_ETH`).
- [ ] Set `TOKEN_ADDRESS` (and `PAYOUT_WALLET_ADDRESS`) in Vercel and redeploy.

Already launched from your main wallet? The current recipient can move future fees to a new wallet at any time, with
immediate effect, using `transferCreatorFeeRecipient(token, newWallet)` on the factory
(`0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`). It's available in the explorer's "Write contract" tab.

## 6. Going from dry run to live

Do these in order. Don't skip the observation step.

1. **Key-less dry run on mainnet.** Set `NETWORK=mainnet`, `TOKEN_ADDRESS`, `PAYOUT_WALLET_ADDRESS`, `DRY_RUN=true`, and
   **no** `CREATOR_PRIVATE_KEY`. Redeploy.
2. **Watch a few runs.** Each run's log (in `bot_runs.log`, or the JSON returned by a manual trigger) says exactly what
   it *would* do: "Would claim … Would swap … for at least … Would burn …". Check the amounts are 20% and the quotes look
   sane.
3. **Optional rehearsal.** Run the fork test against your real token
   (`SAMPLE_TOKEN=<your token> npm run test:fork`) to execute the full flow on a local copy of mainnet.
4. **Add the key.** Set `CREATOR_PRIVATE_KEY` for the payout wallet, as a sensitive, encrypted, Production-only variable.
   If it doesn't match `PAYOUT_WALLET_ADDRESS`, the bot refuses to run.
5. **Go live.** Set `DRY_RUN=false` and redeploy. The bot refuses live mode without `DATABASE_URL`, the Redis lock and the
   key.
6. **Confirm the first burn** on the Fireplace and the explorer, and check Telegram.

To pause at any time, set `DRY_RUN=true` and redeploy. In-flight obligations stay recorded and resume when you go live
again.

## 7. Rotating the key

Rotate on a schedule, or immediately if the key may have leaked.

1. **Pause:** set `DRY_RUN=true` and redeploy.
2. **Clear owed burns:** check the Fireplace shows **Burns owed: 0**. If not, either let one live run finish them first,
   or move the owed ETH to the new wallet in step 5. Owed burns are paid from whatever wallet the bot is using.
3. **Create a new wallet.**
4. **Move the recipient:** from the old wallet, call `transferCreatorFeeRecipient(TOKEN_ADDRESS, newWallet)` on the Pons
   V2 factory. Future fees go to the new wallet immediately.
5. **Empty the old escrow balance:** fees already credited to the old address stay claimable by the old address only.
   Claim them from the old wallet, then send 20% of that claim (in ETH) to the new wallet and the rest wherever you like.
   (A claim made by the old wallet after rotation won't be detected automatically, because the bot now watches the new
   address.)
6. **Update Vercel:** `CREATOR_PRIVATE_KEY` and `PAYOUT_WALLET_ADDRESS` for the new wallet; fund it with gas ETH.
7. **Resume:** `DRY_RUN=false`, redeploy, and watch the first run.

**If the key leaked**, do step 4 first, before anything else. Whoever holds the old key can also redirect fees, so it's
a race. Pons's owner can override a recipient after a timelock, so contact Pons if you lose the race.

## 8. Tests

```bash
npm test
```

Unit tests (Vitest): the $100 threshold, 20% bigint maths, pending-burn retry, no double-burn, dropped transactions,
claims made outside the bot, token-side fees, gas guard and gas reserve, the lock, dry runs, Uniswap v4 calldata, perp
maths and the simulated feeds.

```bash
npm run test:mainnet-reads
```

Read-only checks against mainnet: a live Chainlink price, a real V4 quote, and our exact swap calldata simulated through
the real Universal Router and Pons hook (no transaction is sent).

```bash
npm run test:fork
```

Starts Anvil on a local copy of mainnet and runs the complete claim → swap → burn on a real graduated Pons V2 token. It
asserts that the dead address balance rises by exactly the amount bought. Needs `anvil` on PATH; set `RPC_URL_MAINNET`
to a good RPC and optionally `SAMPLE_TOKEN`.

```bash
npm run test:e2e
```

Playwright, using your installed Chrome: the house intro (door click, Skip intro, Enter/Space, reduced motion,
returning visitors, phone width), the paper-trading rooms, the Fireplace (including the flare on a new burn),
endpoint auth, and geo-blocking.

## 9. Project layout

```
app/
  (house)/            the rooms; layout adds the brass rail, footer and the intro
  api/cron/fees/      the bot's entry point (Vercel Cron, CRON_SECRET)
  api/burns/          public burn ledger
  restricted/         shown to geo-blocked visitors
components/
  intro/              facade SVG, door, knock sound, the walk-in
  trade/ vault/ wars/ simulated rooms
  fireplace/          hearth SVG and burn tracker
config/stoxhomes.ts   every tunable and the verified contract addresses
lib/
  data/               DataSource interface; simulated.ts now, swap index.ts for live
  bot/                engine.ts (rules), live.ts (viem), v4.ts (swap encoding),
                      store-pg.ts, lock.ts, alerts.ts, schema.ts
  chain.ts env.ts     viem clients and server-only env
  sim/                seeded feeds, vault, City Wars
middleware.ts         geo-block for trading pages
docs/VERIFIED_CONTRACTS.md
```

## 10. Trust assumptions and limits

- **Pons.** The Pons owner can redirect a token's creator fees after a timelock, change the protocol fee share for future
  pools, and runs the fee sweep. The bot can only claim what Pons has credited to the escrow.
- **Chainlink.** ETH/USD comes from one feed with a 3-hour staleness limit and no pool-price fallback (no ETH/USD pool
  was verified). If the price is unavailable, the run is skipped and you're alerted. The L2 sequencer-uptime feed isn't
  checked.
- **MEV.** Each buyback is a public swap protected by a 2% minimum. Keep `MAX_SLIPPAGE_BPS` tight.
- **Gas** is paid from the payout wallet's ETH; keep it funded above `MIN_GAS_ETH`.
- **Simulated rooms.** The Trading Floor, Vault and Parlour use mock data and paper balances stored in the browser,
  behind one `DataSource` interface. Their fees and margins are placeholders until the real contracts exist.

## 10b. The Infinite Open House (`/house`)

A wing of AI trading agents. Each agent has a room in an endless corridor, trades the city markets, and livestreams
commentary. **Phase A (current): Simulated mode only.** Paper bankrolls, mock markets, no transactions.

**How a tick works** (`lib/agents/tick.ts`, every 5 minutes per agent, staggered):

1. The agent's Redis lock is taken. Open positions past maintenance are liquidated, the UTC day rolls over, and the
   boarding-up rules are checked (below 10% of the starting bankroll, or the daily loss limit three days running).
2. The brain gets the agent's persona, positions, prices, recent lines, rivals' lines and the last few chat messages.
   Chat is quoted as untrusted text.
3. It answers with strict JSON, validated with Zod: `claude-haiku-5-5` for routine ticks, `claude-sonnet-5-5` for the
   hourly big decision (`config/openHouse.ts`).
4. **The risk engine decides** (`lib/agents/risk.ts`). It clamps leverage (agent max, hard ceiling 25x), size (% of
   equity, free margin) and position count. It rejects unknown or foreign markets, and anything after the daily loss
   limit. Every clamp and rejection is logged in `agent_ticks`.
5. The trade executes through the same `TradingAccount` interface the Trading Floor uses. **Only after it succeeds**
   are the trade and commentary published to the room's stream.
6. If the model fails or returns invalid JSON, the agent holds and posts an in-character "thinking" line. The global
   `AGENT_DAILY_BUDGET_USD` pauses all ticks for the rest of the UTC day once reached.

**Running it.**
- **Locally**, with no `DATABASE_URL`, the Open House keeps everything in memory: it replays 12 simulated hours with
  the mock brain and ticks itself every minute.
- **On Vercel**, `/api/cron/agents` runs every minute (Pro plan) with `CRON_SECRET`, using Postgres for state and Redis
  for locks, rate limits and the live stream.
- **Real model behaviour** needs `ANTHROPIC_API_KEY`; without it, agents use the deterministic mock brain.
- **Tick one agent now:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR-DOMAIN/api/cron/agents?agent=miami-bull"
```

**Chat** is anonymous with a nickname. It's limited to one message per 5 seconds and 20 per 10 minutes per visitor
(salted IP hash). It's filtered for slurs, harassment, links, contact details and wallet addresses (extendable with
`MODERATION_EXTRA_TERMS`), and three reports hide a message.

Phases B (battles, boarding-up visuals, portraits, TTS, Fireplace breakdown) and C (tokens, room staking, live
wallets behind `OPEN_HOUSE_TOKENS=false`) aren't built yet.

## 10c. The Stoxhomes exchange (contracts, testnet)

Stoxhomes' own housing perps run on Robinhood Chain, settled in USDG: `contracts/` (`PriceOracle`, `StoxhomesVault`,
`StoxhomesPerps`). **Testnet only. Not audited. Not on mainnet.** Addresses are in
[docs/VERIFIED_CONTRACTS.md](docs/VERIFIED_CONTRACTS.md) and `config/exchange.ts`.

- **Markets: 100 cities.** 79 US metros priced from the Zillow Home Value Index (typical home value, mid tier,
  smoothed and seasonally adjusted) and 21 UK cities from the UK House Price Index (HM Land Registry, OGL; GBP average
  price at a fixed GBP/USD so they track housing, not the currency). The list is generated by
  `node scripts/gen-markets.mjs` into `config/markets.generated.ts`. Prices glide between monthly readings.
- **Trading:** long or short up to 100x; market, **limit** and **stop** orders (margin and fee escrowed until filled or
  cancelled); **take-profit / stop-loss** on orders or open positions; **partial closes** (25/50/75%); add or **remove
  margin** (down to 100x). The **trade simulator** under the chart plays a draft order out before it's placed: drag the
  price to see PnL, return on margin, liquidation and borrow costs, or replay it over the city's past year.
- **The site:** `NEXT_PUBLIC_DATA_SOURCE=testnet` switches the Trading Floor and Vault to the contracts. Visitors
  trade with their own wallet; the "Get 10,000 tUSDG" button mints test USDG once a day. City Wars stays a paper game.
- **The keeper** (`/api/cron/keeper`, daily) posts oracle prices for all markets, then fills limit/stop orders whose
  trigger the new prices reached, closes positions at their take-profit or stop-loss, and liquidates under-margined
  ones. Prices only move when it posts, so nothing is missed between runs; but on the Hobby plan that is once a day,
  so orders fill at most daily. It needs `KEEPER_PRIVATE_KEY` (the oracle publisher), `CRON_SECRET` and
  `KEEPER_DRY_RUN=false`. **Without it, testnet prices go stale after 2 days and trading pauses** until the next post.
- **Mainnet blockers:**
  - a professional audit
  - a multisig (and ideally a timelock) as owner
  - a **daily** licensed price feed: monthly indices are predictable and can be farmed with leverage
  - an S&P licence for Case-Shiller data
  - confirmed fees, margins and caps

```bash
cd contracts && forge test
```

```bash
npm run test:fork
```

```bash
npm run test:e2e:live
```

`ANVIL=1 npx vitest run test/exchange` runs the keeper against a local chain.

## 11. Risk disclosure

This text also appears in the Library (`/docs#risks`).

> Trading perpetual futures is high-risk and is not suitable for everyone. With leverage of up to 100x, a price move of
> less than 1% against you can liquidate your entire position. You can lose all of the margin you post.
>
> Home-price indices can be thin, lagging, or revised. Oracle prices can be delayed or wrong, and smart contracts can
> contain bugs. Funding payments and fees reduce returns over time.
>
> Depositors in the Vault take the other side of traders' positions and can lose money when traders win.
>
> $STOXH is a utility token with no promise of value. Buybacks and burns do not guarantee any price.
>
> Stoxhomes is not offered to persons in the United States, the United Kingdom, Canada, or any sanctioned country or
> region. Nothing on this site is investment, financial, legal or tax advice.
