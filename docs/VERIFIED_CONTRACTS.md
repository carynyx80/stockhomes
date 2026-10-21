# Verified contracts (Robinhood Chain mainnet, 4663)

Checked 2026-10-20. Every address below holds verified source on
[robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com), and every function the bot calls was read
from that source, not assumed.

| Role | Contract | Address | How it was confirmed |
|---|---|---|---|
| Launch factory | `PonsV2LaunchFactory` | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | Verified source; emitting `TokenLaunched` every few minutes |
| Fee hook | `PonsV2MemeHook` | `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044` | Verified source; equals `factory.memeHook()` |
| Fee escrow | `PonsV2FeeEscrow` | `0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e` | Verified source; equals `factory.feeEscrow()` and `hook.feeEscrow()` (read on-chain) |
| Swap router | `UniversalRouter` 2.1.2 | `0x204FAca1764B154221e35c0d20aBb3c525710498` | Uniswap v4 deployments page, "Robinhood Chain: 4663"; verified source |
| Quoter | `V4Quoter` | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | Uniswap v4 deployments page; verified source |
| ETH/USD | Chainlink standard proxy | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` | docs.chain.link price feed addresses, Robinhood Chain Mainnet; `description()` = "ETH / USD", `decimals()` = 8 |

## Not used, and why

- **Pons V1** factory `0xA5aAb3F0…51feB` and locker `0x736D7669…f7F35` (the addresses in the original brief). Verified,
  but V1 no longer launches: its last `TokenLaunched` was at block ~34.79M (chain head ~93.48M on 2026-10-20). New
  tokens launch on V2.
- **Pons bonding-curve contracts** (one per token, deployed by `0x3711ceA4…6D1A42`): source is not verified, so the
  bot never trades on the curve. It waits until the token has graduated to its Uniswap v4 pool.
- **Pons creator buyback** (`buybackEnabled`): bought tokens go to a vesting vault, not the dead address. Launch with
  it **off**.

## How V2 creator fees flow (from the verified source)

1. Every swap in the graduated pool pays a hook fee and the creator tax, taken in `PonsV2MemeHook._afterSwap` from the
   swap's output side, so in ETH or in the token depending on direction. They accrue in
   `pendingFees[poolId][currency]` and `pendingCreatorTax[poolId][currency]`.
2. `sweepPoolFees(poolId, …)` (Pons's sweep operator, or the creator when no internal swap is needed) converts the
   token-side amounts to the quote asset and credits the creator's share to `PonsV2FeeEscrow`.
3. The creator fee recipient calls `PonsV2FeeEscrow.claim()` to receive native ETH. `balanceOf(recipient)` is the
   exact claimable amount, and the `Claimed(recipient, amount)` event is the exact amount paid. `claimToken(token)`
   / `balanceOfToken(recipient, token)` are the ERC-20 equivalents.
4. The escrow balance is per recipient and **adds up every token paid to it**. Use a recipient wallet that receives
   fees for $STOXH only.

## Facts the bot relies on

- `factory.getLaunchedToken(token)` returns `pairToken`, `poolFee`, `tickSpacing`, `creatorFeeRecipient`,
  `buybackEnabled` and `phase`, where `GraduationPhase { NotGraduated, Swept, PoolCreated, Rescued }`. The bot only acts
  at `PoolCreated`.
- Pool key = `(sorted(pairToken, token), poolFee, tickSpacing, memeHook)` (`PonsV2LaunchFactory`).
- The hook has no `beforeSwap` restrictions. `V4Quoter.quoteExactInputSingle` simulates the hook, so quotes are net of
  its fee.
- Universal Router 2.1.2's `ExactInputSingleParams` is
  `(PoolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)`.
  It has one more field than older v4-periphery releases. Native ETH input is settled from `msg.value`.

## USDG (settlement asset for the Stoxhomes exchange)

| Network | Address | How it was confirmed |
|---|---|---|
| Robinhood Chain mainnet (4663) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Paxos docs "USDG on Main Networks"; on-chain `name()` = "Global Dollar", `symbol()` = USDG, `decimals()` = 6, supply ≈ 690M |
| Robinhood Chain testnet (46630) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | Paxos docs "USDG on Test Networks"; on-chain "Global Dollar" / USDG / 6 decimals |

**Beware impostors:** the mainnet explorer lists at least eight tokens named "USDG". Only the address above is Paxos's.

## Stoxhomes exchange contracts

`contracts/` (PriceOracle, StoxhomesVault, StoxhomesPerps). **Mainnet: not deployed.** They must be audited first, with the
owner role held by a multisig.

**Testnet (Robinhood Chain testnet, 46630), deployed 2026-10-20 at block 139,678,022** by `0x64D3521F1F848F2EEFe1CB12ACcD4Aa52B8e291e`
(testnet-only deployer, also owner, publisher and treasury on testnet):

| Contract | Address |
|---|---|
| TestUSDG (tUSDG, public faucet) | `0xE33f794eD0ebC1009bb7277835C2830F8C9d74A1` |
| PriceOracle | `0x7ddbbe04dD07e8765F21eE30a5281D7100aE3159` |
| StoxhomesVault | `0x73e615e2558DA1Bbd5da735Dcc07967541A965F2` |
| StoxhomesPerps | `0x69A9d5D11834c3c1417e1f1C9534Bd0dA64e0648` |

Smoke test on testnet: opened a 5x New York long (`0x953163c9…98773`) and closed it 65s later (`0x27343d7d…cbba1`);
the round trip cost exactly the fees.
