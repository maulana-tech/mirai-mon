# Smart Contracts

Solidity contracts for Mirai on Monad.

## Contracts

| Contract | Description |
|---|---|
| `Mirai.sol` (`Mirai`) | Splits each payment into spend + savings, deposits savings into the vault, withdrawals, time lock. `payWithPermit` takes an EIP-2612 permit so paying is one transaction. |
| `MiraiVault.sol` | OpenZeppelin ERC-4626 vault over AUSD, one per yield strategy, with a 10^6 virtual-share offset against donation griefing. Yield is AUSD sent to the vault, which raises the share price. |
| `YieldStreamer.sol` | Testnet yield source: pays its vault a fixed APR from an AUSD reserve. `Mirai` calls `drip()` before deposits and withdrawals. |
| `BasketVault.sol` | Invest strategy (index 3): a coin basket per saver (Chainlink + curator prices), following the curator's Smart Money weights or the saver's own mix. Value can fall. |

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

The script deploys three yield vaults with streamers (4% / 8% / 12% APR), the invest `BasketVault` (9 assets) and `Mirai` against AUSD. The deployer becomes the basket's curator, so deploy with the web server's drip wallet key. Env: `AUSD_ADDRESS` (testnet default), `STREAMER_RESERVE` / `BASKET_RESERVE` (AUSD units to fund), `REUSE_YIELD_FROM=<a 3-strategy Mirai>` to reuse existing yield vaults. Record the addresses in `../deployments.json`.

## Gotchas

- AUSD has **6 decimals**; the contracts are decimal-agnostic.
- Shares are vault shares, not AUSD. `accountOf` returns `savings`, their current AUSD value, and `withdrawSavings` takes an AUSD amount; `withdrawAllSavings` redeems every share (use it for "everything").
