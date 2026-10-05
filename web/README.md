# Frontend

React 19 + Vite + TypeScript + Tailwind CSS v4 app for Mirai on Monad.

## Stack

- **ethers v6** for contract calls, with a read-only `JsonRpcProvider` for every read
- **Mera** (`@category-labs/mera`) passkey accounts; `MeraSigner` adapts a Mera signing session to an ethers signer
- **Vercel function** `api/onboard.ts` funds new accounts with MON for gas and test AUSD
- **shadcn-style** UI components

## Commands

```bash
npm install
npm run dev          # http://localhost:5173, including /api/onboard (DRIP_PRIVATE_KEY in .env)
npm run build        # type-check + production build
npm run lint         # oxlint
node scripts/check-mera-signer.ts   # MeraSigner signs byte-identically to ethers.Wallet
node scripts/check-fork.ts          # end-to-end on an anvil Monad fork (see header for setup)
```

## Environment

See `.env.example`. Leave `VITE_MIRAI_ADDRESS` empty for the in-memory mock. `DRIP_PRIVATE_KEY` is a server-only Vercel variable for `/api/onboard`.

## Key Files

| File | Purpose |
|---|---|
| `lib/config.ts` | Chain, addresses, shared read provider |
| `lib/wallet.tsx` | Passkey account store: create, sign in, lock after 30 min, re-unlock on demand |
| `lib/mera-signer.ts` | ethers signer over a Mera session (gas buffer, local nonce tracking) |
| `lib/mirai.evm.ts` | Contract calls; maps custom errors to `Error(Contract, #N)` |
| `lib/ausd.ts` | AUSD balance and EIP-2612 permit signing |
| `lib/activity.ts` | Envio GraphQL feed, with a recent-RPC-logs fallback |
| `lib/i18n.tsx` | Translations (EN, ID, ZH) |
