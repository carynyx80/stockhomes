# Fee bot audit: buyback & burn for $STOXH

Date: 2026-10-21. Scope: `lib/bot/*`, `app/api/cron/fees`, `app/api/burns`, `lib/chain.ts`, `lib/env.ts`, the bot's
config in `config/stoxhomes.ts`, and the live $STOXH launch on Robinhood Chain mainnet. An internal code review plus
tests on a mainnet fork, **not a professional third-party audit**.

## What the bot does

Once a run finds at least $100 of creator fees in the Pons fee escrow, it claims them, spends **exactly 20%** of the
ETH that actually arrived buying $STOXH through Uniswap, and sends **exactly the tokens bought** to
`0x000000000000000000000000000000000000dEaD`. The other 80% is never touched. It only acts after the token graduates
from its bonding curve to its Uniswap v4 pool.

## Live state of $STOXH (read from mainnet)

| | |
|---|---|
| Token | `0x5DF76B1eEb1F83dF875d4798284feE41E49801C4`: "Stoxhome" / STOXH, 18 decimals, 1,000,000,000 supply |
| Launch | Pons V2 factory, paired with native ETH, creator tax 2%, Pons creator buyback **off** |
| Phase | **Bonding curve.** Graduates at 4.2 ETH. Until then the bot waits and does nothing |
| Creator fee recipient | `0x3a0fCB37F3AA5907E913cc106924c19913E02d25` (the deployer). A plain wallet, no delegated code |
| Fees waiting in escrow | 0.0608 ETH (~$148) |
| Recipient's ETH for gas | 0.00015 ETH (the bot keeps a 0.002 ETH reserve, so it would refuse to act until topped up) |

## Tests run

- **Unit tests** (`lib/bot`): 30 pass. They cover the 20% maths in integers, the threshold, the gas cap, slippage,
  obligations surviving every failure, and no double burns.
- **Mainnet fork, full cycle** (`test/fork`), on a real graduated Pons V2 token, nothing sent to the real chain:
  - claimed 0.2 ETH;
  - swapped exactly 0.04 ETH (20%);
  - the dead address went up by exactly the 29,177,186 tokens bought;
  - nothing was left owed;
  - the wallet kept 0.15977 of the 0.16 ETH. The difference is gas for the three transactions.
- **Key-less dry run on real mainnet** with the real token and recipient: "Token phase is curve; the bot only acts
  after graduation." Nothing was sent.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | ETH/USD freshness limit was 3h, but Robinhood Chain's Chainlink feed has a 24h heartbeat (observed gaps of 4-10h). The bot would have skipped almost every run ("no fresh price"). | **Fixed:** 25h. The price only gates the $100 threshold and the gas check; the swap is protected by a live Uniswap quote. |
| 2 | High | The fee bot read the same `NETWORK` setting as the testnet exchange keeper. With production on `testnet`, the bot could never reach the mainnet token; switching to `mainnet` would have frozen the testnet prices. | **Fixed:** new `TOKEN_NETWORK` (default `mainnet`) for the bot and burn ledger. |
| 3 | Medium | The claim transaction used a bare gas estimate. A claim zeroes a balance, and the storage refund can make that estimate too low (the same class of bug was seen on the exchange). | **Fixed:** +30% headroom, like the swap and burn. |
| 4 | Test only | The fork test used Anvil's public dev key. On Robinhood Chain mainnet that address has an EIP-7702 sweeper that forwards any ETH it receives, which hid the claimed ETH. | **Fixed:** a fresh key per run. Lesson: never send real funds to any well-known test key. |

## What can it cost? (worst case, per claim)

- **The 20% buyback.** This is spent by design; it's what buys the tokens to burn.
- **Slippage beyond the quote.** Capped at **2% of the 20%**, so at most **0.4% of a claim**. The swap reverts rather
  than accept less, and a reverted swap spends no ETH beyond gas. On Robinhood Chain (first-come-first-served
  sequencer, no public mempool) sandwiching is impractical.
- **Creator tax on the bot's own buy (2%).** It goes back into your creator escrow, so it isn't lost.
- **Gas.** Three transactions. It's capped by the bot at 5% of a claim (it waits otherwise). It was a fraction of a
  dollar on the fork, and cents or less at Robinhood Chain's usual 0.01 gwei.
- **The 80%.** Never spent or moved by the bot. The only outgoing ETH is the 20% swap amount and gas.

## Risks no code change removes

1. **Key custody.** Live mode needs the fee recipient's private key in Vercel (`CREATOR_PRIVATE_KEY`). That makes it a
   hot wallet, and the 80% accumulates there. Recommended:
   - make a **new dedicated payout wallet**;
   - move the creator fee recipient to it on Pons (`transferCreatorFeeRecipient`);
   - keep only gas in it, and sweep the 80% to your main wallet regularly.
2. **Manual claims count too.** If you claim on the Pons site, the bot records it and owes a 20% burn from that
   wallet's ETH.
3. **Third-party contracts.** Pons (escrow, hook, factory) and Uniswap are external. Their source is verified, but
   they weren't audited here.
4. **The $STOXH pool doesn't exist yet**, so the swap couldn't be tested on $STOXH itself. The same code path passed on
   another graduated Pons V2 token. Run a dry run after graduation before going live.
5. **Not a professional audit.** For larger amounts, get one.

## Go-live checklist (all yours to do; nothing here has been switched on)

- [ ] Token graduated to its Uniswap v4 pool.
- [ ] Dedicated payout wallet set as creator fee recipient; ≥0.003 ETH in it for gas.
- [ ] Vercel: `DATABASE_URL` (Postgres) and Upstash Redis connected. Live mode refuses to run without them.
- [ ] Vercel: `TOKEN_ADDRESS`, `TOKEN_NETWORK=mainnet`, `RPC_URL_MAINNET` (a dedicated RPC), `CREATOR_PRIVATE_KEY`,
      optionally Telegram alerts.
- [ ] First with `DRY_RUN=true`: read the run log (what it would claim, swap and burn).
- [ ] Then `DRY_RUN=false`.
