# Indexer

[Envio HyperIndex](https://docs.envio.dev) indexer for Mirai on Monad testnet. The public RPC caps `eth_getLogs` at 100 blocks, so the app's full Activity history, principal/earnings and landing-page totals come from here.

| File | What it holds |
|---|---|
| `config.yaml` | Mirai address + start block (from `../deployments.json`) and the six events: `PaymentRouted`, `SpendWithdrawn`, `SavingsWithdrawn`, `SplitSet`, `LockSet`, `StrategySet` |
| `schema.graphql` | `Activity` (one row per event, keyed to the account it belongs to: a payment writes a `pay` row for the recipient, with sender and saved slice, and a `sent` row for the payer), `Saver` (running per-account totals and current split, lock and strategy), `Protocol` (volume, saved, payments, savers) |
| `src/EventHandlers.ts` | Handlers that write the activity row and update the aggregates |

The web app reads it through `VITE_INDEXER_URL` (`web/src/lib/activity.ts` for the feed, `fetchProtocolStats` for the landing page). Without it the app falls back to the last ~5 minutes of RPC logs and hides earnings rather than showing a wrong number.

## Run

```bash
npm install
cp .env.example .env          # ENVIO_API_TOKEN (envio.dev/app/api-tokens), ENVIO_PG_PORT=5455
npx envio codegen
npm run dev                   # Docker; GraphQL at http://localhost:8080/v1/graphql
../web/node_modules/.bin/tsc -p .   # typecheck handlers
```

After a redeploy (new address or start block) Envio refuses to resume: `npx envio dev -r` resets the local index. For production, deploy this folder to Envio Cloud and use its GraphQL URL as `VITE_INDEXER_URL`.
