# Deployment

Network: **Monad testnet**, chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadscan.com`. Addresses live in `deployments.json`.

## 1. Contracts

```bash
cd evm
cp .env.example .env            # MONAD_RPC_URL, DEPLOYER_PRIVATE_KEY (fund it at faucet.monad.xyz)
source .env
forge script script/DeployMirai.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Add `STREAMER_RESERVE=<AUSD base units>` to fund each strategy's yield streamer in the same run. Copy the printed addresses and the deploy block into `deployments.json`.

## 2. Indexer (Envio)

```bash
cd indexer
npm install
cp .env.example .env            # ENVIO_API_TOKEN from envio.dev/app/api-tokens
```

Set `chains[0].start_block` and the Mirai `address` in `config.yaml` from `deployments.json` (after a redeploy, `envio dev -r` resets the local index), then run `npm run dev` locally (needs Docker) or deploy the folder to Envio Cloud. The GraphQL endpoint becomes the app's `VITE_INDEXER_URL`.

## 3. App (Vercel)

Project root `web/`. Environment variables:

| Variable | Scope | Value |
|---|---|---|
| `VITE_MIRAI_ADDRESS` | client | Mirai address |
| `VITE_INDEXER_URL` | client | Envio GraphQL endpoint (optional) |
| `VITE_MONAD_RPC_URL` | client | optional RPC override |
| `DRIP_PRIVATE_KEY` | server only | testnet key holding MON (≥ a few MON) for onboarding; must be the BasketVault `curator` (the deployer) |
| `NANSEN_API_KEY` | server only | Nansen API key for `/api/market` (Smart Money weights); without it followers keep the last on-chain weights |

`vercel.json` rewrites everything except `api/`, `assets/` and `tokens/` to `index.html`. Passkeys are bound to the hostname (the WebAuthn RP ID), so accounts created on a preview URL do not carry over to the production domain.

## Invest basket reserve and prices

`BasketVault` pays gains above deposits from the AUSD it holds; top the reserve up by sending AUSD to it. Right after a deploy, request `/api/market` once: it pushes MON/memecoin prices and the first Nansen-based Smart Money weights (until then only USDC/BTC/ETH carry weight).

```bash
cast send 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC "transfer(address,uint256)" <BasketVault> 500000000 \
  --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PRIVATE_KEY   # 500 AUSD
```

## Yield on testnet

Each strategy vault earns from its `YieldStreamer`, which pays the strategy's APR out of its AUSD reserve; top a reserve up by sending AUSD to the streamer. Do not send AUSD directly to a vault that has no deposits yet. For a one-off bump on a funded vault:

```bash
cast send 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC "transfer(address,uint256)" <MiraiVault> 50000000 \
  --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PRIVATE_KEY   # 50 AUSD
```
