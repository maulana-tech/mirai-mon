# Smart Contracts

Solidity contracts for Mirai on Monad.

## Contracts

| Contract | Description |
|---|---|
| `Mirai.sol` (`Mirai`) | Splits each payment into spend + savings, deposits savings into the vault, withdrawals, time lock. `payWithPermit` takes an EIP-2612 permit so paying is one transaction. |
| `MiraiVault.sol` | OpenZeppelin ERC-4626 vault over AUSD, one per yield strategy, with a 10^6 virtual-share offset against donation griefing. Yield is AUSD sent to the vault, which raises the share price. |
| `YieldStreamer.sol` | Testnet yield source: pays its vault a fixed APR from an AUSD reserve. `Mirai` calls `drip()` before deposits and withdrawals. |
| `MarketVault.sol` | Smart Money strategy (index 3): ERC-4626 vault valued as a BTC/ETH basket at Chainlink prices, re-weighted by its curator from Nansen data. Value can fall. |

## Build & Test

```bash
git submodule update --init   # forge-std + openzeppelin-contracts
forge build
forge test                                                                     # unit tests
MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork   # real AUSD + faucet
```

`foundry.toml` sets `network = "monad"` (Foundry ≥ 1.8), so local execution uses Monad's gas model and opcode pricing.

## Deploy

```bash
cp .env.example .env   # MONAD_RPC_URL, DEPLOYER_PRIVATE_KEY
source .env
forge script script/DeployMirai.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

The script deploys three yield vaults with streamers (4% / 8% / 12% APR), the Smart Money `MarketVault` and `Mirai` against AUSD. Env: `CURATOR_ADDRESS` (required: the web server's drip wallet), `AUSD_ADDRESS` (testnet default), `STREAMER_RESERVE` / `MARKET_RESERVE` (AUSD units to fund), `REUSE_YIELD_FROM=<a 3-strategy Mirai>` and `REUSE_MARKET_VAULT=<address>` to reuse existing vaults. Record the addresses in `../deployments.json`.

## Gotchas

- AUSD has **6 decimals**; the contracts are decimal-agnostic.
- Shares are vault shares, not AUSD. `accountOf` returns `savings`, their current AUSD value, and `withdrawSavings` takes an AUSD amount; `withdrawAllSavings` redeems every share (use it for "everything").
