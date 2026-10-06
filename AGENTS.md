# AGENTS.md

Mirai — auto-savings on every payment, on Monad testnet (Monad Metropolis hackathon, Consumer Products & Payments). Three independent workspaces: `evm/` (Foundry/Solidity), `web/` (React 19 + Vite + TS + ethers v6 + Mera passkeys), `indexer/` (Envio HyperIndex). `deployments.json` + `web/src/lib/config.ts` are the source of truth for addresses.

## Commands

- `evm/`: `forge build`, `forge test`; `MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork` runs against real AUSD. forge-std and openzeppelin-contracts are git submodules — run `git submodule update --init` after clone. `foundry.toml` sets `network = "monad"` (needs Foundry ≥ 1.8).
- `web/`: `npm install`, `npm run dev`, `npm run lint` (oxlint), `npm run build` (`tsc -b` then `vite build`). No test suite; runnable checks: `node scripts/check-mera-signer.ts`, `node scripts/check-market.ts`, `node scripts/check-pool.ts`, `node scripts/check-fork.ts` (anvil fork e2e incl. Smart Money + curator rebalance, setup in its header). The fork must be started *after* the deployment you test.
- `indexer/`: `npx envio codegen`, then `../web/node_modules/.bin/tsc -p .` typechecks handlers. `npm run dev` needs Docker + `ENVIO_API_TOKEN`. **Always set `ENVIO_PG_PORT=5455`** (in `indexer/.env`): Envio's default 5433 is this machine's Konakorp Postgres, and `envio dev` silently reuses whatever listens there.
- Deploy: `forge script script/DeployMirai.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY` (deploys 3 yield MiraiVaults + YieldStreamers, the Smart Money `MarketVault` and Mirai; needs `CURATOR_ADDRESS` (the drip wallet); `STREAMER_RESERVE` / `MARKET_RESERVE` = AUSD units to fund; `REUSE_YIELD_FROM=<a 3-strategy Mirai, e.g. 0x1078…>` / `REUSE_MARKET_VAULT=<MarketVault>` reuse existing vaults instead of deploying new ones). Envio refuses a changed address/start block: run `envio dev -r` (resets only the local indexer DB).
- Git workflow: `push.sh` (bash) commits one file per commit with conventional-commit types inferred from filename; history matches. Don't batch commits.

## Gotchas

- **AUSD decimals**: 6 (`AUSD_DECIMALS` in `web/src/lib/ausd.ts`); `formatMoney` in `i18n.tsx` assumes it.
- **Strategies**: index order 0 conservative / 1 balanced (default) / 2 growth / 3 smart money is fixed in `Mirai.sol` and `web/src/lib/strategies.ts`. `Mirai` drips the strategy's `YieldStreamer` before deposits/withdrawals; never donate AUSD into an *empty* yield vault.
- **Smart Money (`MarketVault`)**: BTC/ETH basket priced by Chainlink push feeds (no Pyth: Hermes now needs a paid key; Chainlink has no MON/USD on testnet). Coin order BTC, ETH must match `MARKET_SYMBOLS` in `mirai.evm.ts` and `COINS` in `web/api/market.ts`. Value can fall: earnings may be negative. Only the curator (drip wallet) can `rebalance`; `/api/market` does it from Nansen (`NANSEN_API_KEY`; one `smart-money/holdings` + one `smart-money/dex-trades` call per day ≈ the free plan's 10 credits; `netflow` is empty for Monad, so flows are computed from trades). Check: `node scripts/check-market.ts`.
- **RPC rate limit**: the public Monad RPC allows ~50 calls/second (batched calls count individually). `readProvider` in `config.ts` retries rate-limited batches; keep per-page reads lean (cache immutable values like vault addresses and APRs).
- **Shares vs AUSD**: `Account.shares` are shares of the account's strategy vault (12 decimals: OZ virtual-share offset). Show `savings` (AUSD value from `accountOf`); `withdrawSavings` takes an AUSD amount, `withdrawAllSavings` redeems every share. `mirai.evm.ts` uses the latter whenever the amount reaches the current savings, because a Smart Money balance can drop between reading it and the tx landing (a fixed amount would revert `InsufficientShares`).
- **Contract errors**: custom errors map to `Error(Contract, #N)` via `ERROR_CODES` in `mirai.evm.ts`, localized in `web/src/lib/errors.ts` + `i18n.tsx`. Adding an error requires all three. `#9` is retired.
- **Monad charges the gas limit**: never hardcode `gasLimit`; `MeraSigner.populateTransaction` pads `estimateGas` by 10%.
- **Stale nonces**: Monad's RPC can return a stale pending nonce right after a receipt; `MeraSigner` tracks the next nonce locally. Keep one signer per session.
- **`eth_getLogs` is capped at 100 blocks** on the public RPC. Full history comes from the Envio indexer (`VITE_INDEXER_URL`); without it `activity.ts` shows ~5 minutes and earnings are hidden.
- **AUSD faucet** (`0xd236…`) allows one call per 60s across all of testnet (`MaxFrequencyExceeded`). `api/onboard.ts` pays users from the drip wallet's reserve and only uses the faucet to refill.
- **Mock mode**: empty `VITE_MIRAI_ADDRESS` switches `mirai.ts` to `mirai.mock.ts`. Passkey sign-in still runs (works on localhost).
- Reads use the shared `readProvider` in `config.ts`; writes go through `getSigner()` in `wallet.tsx`, which re-prompts the passkey when the 30-minute session has lapsed.
- Passkeys are bound to the hostname (WebAuthn RP ID): localhost, preview and production each have separate accounts.

## Web conventions

- UI text is i18n'd via `web/src/lib/i18n.tsx` with 3 locales (en, id, zh); new user-facing strings go into all three. `zh` spreads `en`, so a missing Chinese key falls back to English silently.
- Routes: `/` landing, `/pay/:address` payment link, `/app/*` dashboard (see `src/App.tsx`). `/app/market` works signed out: Chainlink-on-Monad price board, the Smart Money card, and a client-side pool simulator (`lib/pool.ts`, Binance daily closes from `data-api.binance.vision`; check: `node scripts/check-pool.ts`). Components under `src/components/ui/` are shadcn-style; `@/` aliases `src/`.
- `api/` holds Vercel functions (server-only env like `DRIP_PRIVATE_KEY`, `NANSEN_API_KEY`, never `VITE_`-prefixed). `npm run dev` serves `/api/onboard` and `/api/market` through the `mirai-dev-api` plugin in `vite.config.ts`, reading server env from `web/.env`.
