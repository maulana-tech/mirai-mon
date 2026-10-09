# Deployment

Mirai runs on **Monad testnet**: chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadscan.com`. Three pieces deploy separately:

| Piece | Where | Folder |
|---|---|---|
| Contracts (Mirai, BasketVault, yield vaults + streamers) | Monad testnet | `evm/` |
| Indexer (activity, per-pocket deposits, protocol stats) | Envio (local Docker or Envio Cloud) | `indexer/` |
| App + API (`/api/onboard`, `/api/market`) | Vercel | `web/` |

`deployments.json` and `web/src/lib/config.ts` are the source of truth for addresses.

## Current deployment

| Contract | Address |
|---|---|
| Mirai | `0xEAFFa1705b5cf69B291aa88484F9655Fe8341b83` (deploy block `68647993`) |
| BasketVault (invest) | `0x4D7470dd92E1b58e48ccD4902B596A810F9189f6` |
| Yield vaults (conservative / balanced / growth) | see `deployments.json` (reused across deploys) |
| AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| Curator / drip wallet | `0x59cC2ACdf03BD622428de6520A647afaF7382d98` |

If the current deployment is fine, skip to step 3 (indexer) and step 4 (app).

## 0. Before you start

- Foundry ≥ 1.8 (`foundry.toml` sets `network = "monad"`), Node ≥ 22, Docker (local indexer only).
- `git submodule update --init` (forge-std, openzeppelin-contracts).
- **One wallet does two jobs: the deployer and the server's drip key.** The deployer becomes the BasketVault `curator`, and `/api/market` signs `setPrices` / `setSmartWeights` with `DRIP_PRIVATE_KEY`. Both env vars must hold the same key. It needs MON for gas ([faucet.monad.xyz](https://faucet.monad.xyz)) and AUSD for the reserves and onboarding drips.
- **Rotate the key if it was ever printed or shared.** A new key means a new curator, so redeploy (step 1) and fund the new wallet first.
- Secrets live only in `evm/.env`, `web/.env` and `indexer/.env` (all gitignored) and in the Vercel and Envio dashboards. Never put them in a `VITE_` variable: those ship to the browser.

## 1. Contracts

```bash
cd evm
cp .env.example .env        # MONAD_RPC_URL, DEPLOYER_PRIVATE_KEY
set -a && . ./.env && set +a
forge test

REUSE_YIELD_FROM=0x1078928b12205ee548E84C97827F1A32A3Ff6c23 \
BASKET_RESERVE=300000000 \
forge script script/DeployMirai.s.sol --rpc-url monad_testnet --broadcast --private-key "$DEPLOYER_PRIVATE_KEY"
```

| Option | Meaning |
|---|---|
| `REUSE_YIELD_FROM=<Mirai>` | reuse that deployment's three yield vaults + streamers (they are permissionless); omit to deploy new ones |
| `STREAMER_RESERVE=<units>` | AUSD (6 decimals) sent to each *new* streamer to pay the APR |
| `BASKET_RESERVE=<units>` | AUSD sent to the new BasketVault, which pays gains above deposits (`300000000` = 300 AUSD) |

The script prints `basket` and `Mirai:`. Then:

1. Update the addresses and `deployBlock` in `deployments.json` (the first receipt's block in `broadcast/DeployMirai.s.sol/10143/run-latest.json`).
2. Update the Mirai default in `web/src/lib/config.ts`, `BASKET_VAULT` in `web/api/market.ts`, the commented address in `web/.env.example`, and both addresses plus `start_block` in `indexer/config.yaml`.
3. Optional: verify on Sourcify, e.g. `forge verify-contract <address> src/Mirai.sol:Mirai --chain 10143 --verifier sourcify`.

The old BasketVault keeps its AUSD reserve (it can only be wired to one Mirai, via `initMirai`), so keep `BASKET_RESERVE` modest on testnet.

## 2. After every contract deploy

1. **Push prices and Smart Money weights.** Request `/api/market` once from the dev server or the deployed app. It pushes MON/memecoin prices from DexScreener (whenever they are over 15 minutes old) and the first Nansen-based weights. Until then only USDC/BTC/ETH carry weight, and buying a coin with no price reverts `InvalidPrice`.
   ```bash
   curl -s https://<app>/api/market | head -c 300
   cast call <BasketVault> "prices()(uint256[])" --rpc-url https://testnet-rpc.monad.xyz   # no zeros
   ```
2. **Check the reserves.**
   ```bash
   cast call 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC "balanceOf(address)(uint256)" <wallet|streamer|BasketVault> --rpc-url https://testnet-rpc.monad.xyz
   ```
   Top up any of them by sending AUSD to it (`cast send <AUSD> "transfer(address,uint256)" <to> <units> ...`). Never send AUSD straight into a yield vault with no deposits.
3. **Run the end-to-end check on a fork.** Start the fork *after* the deployment you test:
   ```bash
   anvil --network monad --fork-url https://testnet-rpc.monad.xyz
   # in evm/: deploy to http://127.0.0.1:8545 with anvil key #0, then in web/:
   MIRAI=<fork Mirai> node scripts/check-fork.ts
   ```
   A fork deploy also writes into `evm/broadcast/.../10143/`. Delete the fork's `run-<timestamp>.json` and copy the real testnet run back over `run-latest.json`, so the record stays the testnet one.

## 3. Indexer (Envio)

```bash
cd indexer
npm install
cp .env.example .env        # ENVIO_API_TOKEN (envio.dev/app/api-tokens), ENVIO_PG_PORT=5455
npx envio codegen && ../web/node_modules/.bin/tsc -p .
```

**Local:** `set -a && . ./.env && set +a && npx envio dev` (needs Docker). GraphQL at `http://localhost:8080/v1/graphql`. Keep `ENVIO_PG_PORT=5455`: the default 5433 is another project's Postgres on this machine, and `envio dev` silently reuses whatever listens there. After a new address, start block, schema or handler change, run `npx envio dev -r` (resets only the local index).

**Envio Cloud (hosted):** create an indexer at [envio.dev/app](https://envio.dev/app) from this GitHub repo with `indexer/` as the root directory, on the branch you deploy. Each push redeploys it. Its GraphQL URL becomes `VITE_INDEXER_URL`.

Sanity check:
```bash
curl -s <graphql> -H 'content-type: application/json' \
  -d '{"query":"{ Activity(limit:3, order_by:{timestamp:desc}){ kind user pocket } }"}'
```

Without an indexer the app still works, but activity shows only about the last 5 minutes (the public RPC caps `eth_getLogs` at 100 blocks) and earnings are hidden.

## 4. App (Vercel)

Import the repo with **Root Directory `web/`**. Vercel detects Vite: build `npm run build`, output `dist`. `api/*.ts` become serverless functions, and `vercel.json` sends every non-`/api/` path without a file extension to `index.html`.

| Variable | Scope | Value |
|---|---|---|
| `VITE_MIRAI_ADDRESS` | client | Mirai address (empty runs the in-memory mock) |
| `VITE_INDEXER_URL` | client | Envio GraphQL endpoint (optional, see above) |
| `VITE_MONAD_RPC_URL` | client | optional RPC override (default public RPC) |
| `VITE_MONAD_EXPLORER_URL` | client | optional, default `https://testnet.monadscan.com` |
| `DRIP_PRIVATE_KEY` | server only | the deployer/curator key: onboarding drips + curator calls |
| `NANSEN_API_KEY` | server only | Smart Money weights; without it followers keep the last on-chain weights |
| `MONAD_RPC_URL` | server only | optional RPC override for the API functions |

Client variables are baked in at build time, so redeploy after changing them. Locally, `npm run dev` serves the same `/api/*` routes through the `mirai-dev-api` plugin, reading `web/.env`.

Before shipping: `npm run lint && npm run build`, plus `node scripts/check-pockets.ts`, `check-market.ts` and `check-pool.ts`.

## 5. Smoke test on the deployed URL

1. Create an account with a passkey. Passkeys are bound to the hostname, so accounts from localhost or a preview URL don't exist on the production domain. Onboarding drips test AUSD + MON.
2. Open **Get paid** and pay your link from a second account: the split lands in spending and savings.
3. **Pockets:** create a pocket. The passkey prompts once to encrypt the name, then once more to sign if the session lapsed. Set the split, open it, switch strategy, lock it, withdraw.
4. **Invest:** in an invest pocket choose Follow Smart Money or a custom mix (above 20% memecoins asks for an acknowledgement). The Invest page shows "Powered by Nansen" with today's update time.
5. **Activity** shows the history (the indexer is working).

## Nansen credits

The free plan gives about 10 credits a day. `/api/market` spends 10 per refresh (`smart-money/holdings` + `smart-money/dex-trades`, 5 each) and refreshes at most once a day. The snapshot is cached in memory and in `/tmp`. On Vercel `/tmp` is per instance and gets wiped, so a cold start can refetch and hit `403` for the rest of the day. The app then shows "Nansen offline" and the basket keeps its last weights; nothing breaks. Credits reset at 00:00 UTC.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error(Contract, #15)` / `InvalidPrice` when investing | a coin has no curator price yet: request `/api/market` (step 2) |
| `nansen ... 403` in logs | out of Nansen credits; wait for 00:00 UTC |
| Onboarding fails / no test funds | drip wallet out of AUSD or MON. The AUSD faucet allows one call per 60 s across all of testnet |
| Envio refuses to start after a redeploy | changed address or start block: `envio dev -r` |
| Indexer shows another project's data | `ENVIO_PG_PORT` not set to 5455 |
| Passkey account "missing" on the live site | expected: passkeys are per hostname |
| A tx fails right after another lands | the RPC can lag a block. `MeraSigner` tracks nonces locally; retry once |
