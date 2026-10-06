# Frontend

React 19 + Vite + TypeScript + Tailwind CSS v4 app for Mirai on Monad.

## Stack

- **ethers v6** for contract calls, with a read-only `JsonRpcProvider` for every read
- **Mera** (`@category-labs/mera`) passkey accounts; `MeraSigner` adapts a Mera signing session to an ethers signer
- **Vercel functions**: `api/onboard.ts` funds new accounts with MON for gas and test AUSD; `api/market.ts` pushes MON/memecoin prices from DexScreener and turns Nansen smart-money data into Smart Money weights on the basket
- **Chainlink** price feeds on Monad (read straight from chain) and Binance daily closes for the Market page
- **shadcn-style** UI components

## Commands

```bash
npm install
npm run dev          # http://localhost:5173, including /api/onboard and /api/market (server env in .env)
npm run build        # type-check + production build
npm run lint         # oxlint
node scripts/check-mera-signer.ts   # MeraSigner signs byte-identically to ethers.Wallet
node scripts/check-market.ts        # Nansen holdings → basket weights
node scripts/check-pool.ts          # pool simulator math (backtest, range)
node scripts/check-fork.ts          # end-to-end on an anvil Monad fork, incl. a custom invest basket (see header)
```

## Environment

See `.env.example`. Leave `VITE_MIRAI_ADDRESS` empty for the in-memory mock. Server-only Vercel variables: `DRIP_PRIVATE_KEY` (onboarding drip, and the BasketVault curator: pushes prices and Smart Money weights) and `NANSEN_API_KEY` (Smart Money weights; optional, followers keep the last on-chain weights without it). Optional `BASKET_VAULT_ADDRESS` overrides the deployed basket.

## Key Files

| File | Purpose |
|---|---|
| `lib/config.ts` | Chain, addresses, shared read provider |
| `lib/wallet.tsx` | Passkey account store: create, sign in, lock after 30 min, re-unlock on demand |
| `lib/mera-signer.ts` | ethers signer over a Mera session (gas buffer, local nonce tracking) |
| `lib/mirai.evm.ts` | Contract calls; maps custom errors to `Error(Contract, #N)` |
| `lib/ausd.ts` | AUSD balance and EIP-2612 permit signing |
| `lib/activity.ts` | Envio GraphQL feed, with a recent-RPC-logs fallback |
| `lib/strategies.ts` | Strategy list (3 yield + invest), order matches `Mirai.sol` |
| `lib/basket.ts` | Basket presets (Follow Smart Money, Blue chip, Careful) and memecoin-risk threshold |
| `lib/market.ts` | `/api/market` (Nansen signals) + the saver's on-chain basket |
| `lib/market-data.ts` | Chainlink prices on Monad + Binance history for the Market page |
| `lib/pool.ts` | Pool simulator: backtest and 80% range |
| `lib/i18n.tsx` | Translations (EN, ID, ZH) |
