# Stoxhomes contracts

Housing-price perpetuals on Robinhood Chain, settled in USDG.

- `PriceOracle`: push oracle for the city indices (approved publishers, staleness and deviation limits).
- `StoxhomesVault`: ERC-4626 House pool; the counterparty to every trade.
- `StoxhomesPerps`: positions, fees, borrow fee, liquidations, open-interest caps.

**Testnet only until audited.** Nothing here has been deployed to mainnet.

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.5.0 --no-git
forge test
```
