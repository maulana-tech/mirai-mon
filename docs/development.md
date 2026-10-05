# Development

## Prerequisites

- Node.js ≥ 22 (the checks use Node's built-in TypeScript stripping; 24 recommended)
- Foundry ≥ 1.8 (`network = "monad"` support)
- A browser with passkey PRF support (current Chrome or Safari)

## Contracts

```bash
cd evm && git submodule update --init
forge test
MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork   # real AUSD + faucet
```

## App

```bash
cd web && npm install
npm run dev     # live testnet contract; /api/onboard is served by a Vite dev plugin (DRIP_PRIVATE_KEY in web/.env)
npm run lint && npm run build
```

### Checks

- `node scripts/check-mera-signer.ts`: MeraSigner produces byte-identical transactions, messages and permits to `ethers.Wallet`.
- `node scripts/check-fork.ts`: onboarding → permit payment through MeraSigner → withdrawals on an anvil Monad fork. Setup steps are in the file header.

## Gotchas

- **AUSD is 6 decimals** (`AUSD_DECIMALS` in `lib/ausd.ts`), and the i18n money formatter assumes it.
- **Shares vs AUSD:** `shares` are vault shares; show `savings` (AUSD value) to users and pass AUSD amounts to `withdrawSavings`.
- **Gas:** Monad charges the gas limit. Never hardcode `gasLimit`; `MeraSigner` pads estimates by 10%.
- **Logs:** `eth_getLogs` is capped at 100 blocks. Use the indexer for history.
- **Passkeys are per hostname:** `localhost`, preview and production domains each have their own accounts.
- **i18n:** new strings go into all three locales (`en`, `id`, `zh`) in `lib/i18n.tsx`. `zh` spreads `en`, so a missing Chinese key silently falls back to English.
