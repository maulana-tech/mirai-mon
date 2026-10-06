# Architecture

Mirai splits every incoming AUSD payment into a spendable balance and savings held in an ERC-4626 vault, on Monad testnet. Accounts are passkeys (Mera); there is no wallet extension.

```
Browser (React)                                   Monad testnet
┌──────────────────────────────┐                  ┌────────────────────────────┐
│ passkey ──PRF──> account key │                  │ Mirai (Mirai.sol)        │
│        Mera signing session  │  payWithPermit   │  ├─ spend balance (AUSD)   │
│        MeraSigner (ethers)   │ ───────────────> │  └─ vault shares ──┐       │
│ reads: JsonRpcProvider       │                  │ 3× MiraiVault (yield)     <┤│
│                              │                  │ BasketVault (invest)      <┘│
│                              │                  │ 3× YieldStreamer (testnet)  │
│                              │                  │ Chainlink feeds + curator   │
│ history: Envio GraphQL       │ <── indexer ──── │ AUSD (Agora, permit)       │
└──────────────┬───────────────┘                  └────────────────────────────┘
               │ POST /api/onboard (new accounts)
               ▼
        Vercel function: MON for gas + test AUSD from a drip reserve

        GET /api/market: DexScreener → BasketVault.setPrices; Nansen (Monad) → setSmartWeights
```

## Contracts (`evm/src`)

### Mirai (`Mirai.sol`)

Per-user `Account { splitBps, spend, shares, lockUntil, strategy }`; `accountOf` also returns `savings`, the current AUSD value of `shares` in the account's strategy vault.

| Function | Behavior |
|---|---|
| `pay(from, to, amount)` | Requires `msg.sender == from`. Pulls `amount`, credits `amount × splitBps` to savings by depositing it into the vault, the rest to `spend`. A savings slice worth 0 shares stays spendable. |
| `payWithPermit(...)` | Same, after an EIP-2612 permit. A failed permit (e.g. front-run) is ignored and `transferFrom` decides. |
| `withdrawSpend(user, amount)` | Sends AUSD from the spend balance. Never locked. |
| `withdrawSavings(user, amount)` | Withdraws `amount` AUSD from the vault, burning `previewWithdraw(amount)` shares. Blocked while locked. |
| `withdrawAllSavings(user)` | Redeems every share at the price when it executes. The app uses it for "withdraw all", because a Smart Money balance can fall between reading it and the tx landing. Blocked while locked. |
| `setStrategy(user, strategy)` | 0–3. Redeems the saver's shares from the old vault and deposits into the new one (allowed while locked: funds stay in savings). |
| `setSplit(user, bps)` | 0–10,000 bps; default 2,000 (20%). |
| `setLock(user, until)` | Extend-only, at most 5 years ahead. |

Every function that acts for a user takes it explicitly and requires `msg.sender` to match (`Unauthorized()`).

### Strategies: `MiraiVault` + `YieldStreamer`, and `BasketVault`

Four strategies: 0 conservative, 1 balanced (default), 2 growth earn yield; 3 invests in a coin basket. The three yield strategies are each a plain OpenZeppelin ERC-4626 vault over AUSD with a 10^6 virtual-share offset, so a donation into an empty vault cannot round later deposits to zero shares. `setStrategy` redeems the saver's shares from the old vault and deposits the assets into the new one.

Yield is AUSD transferred to a vault without minting shares. On testnet a `YieldStreamer` per vault pays a fixed APR (4% / 8% / 12%, mirroring Aave V3, Curvance and Upshift earnAUSD on Monad mainnet) from an AUSD reserve, as simple interest on the vault's assets since the last drip, capped by the reserve. `Mirai` drips the strategy's streamer before every deposit and withdrawal, inside `try/catch`, so share prices are current and a failing streamer never blocks a payment. On mainnet, the constructor would take the real markets' ERC-4626 vaults and no streamers.

**Invest (`BasketVault`)** keeps a basket per saver: units of each coin, bought at the price on deposit and sold pro rata on withdrawal (`withdrawAll` sells everything). USDC, BTC, ETH and LINK are priced by Chainlink push feeds on Monad; MON and the memecoins CHOG, NADS, MONCAT, EMO by prices the `curator` pushes (`setPrices`, from DexScreener). A saver either follows the curator's Smart Money weights (`setSmartWeights`, set daily from Nansen holdings + 24h DEX net buying with guard rails; followers re-weight lazily at their next action or via `sync`) or sets their own (`setWeights`, any split that sums to 100%, memecoins included). Re-weighting keeps value. Testnet has no AUSD liquidity for these coins, so buys are bookkeeping at the price and the vault's AUSD (deposits plus an operator reserve) backs withdrawals; on mainnet they become Kuru swaps. Deposits revert while no weights are set, so money is never swallowed. `Mirai` holds no shares for this strategy: `accountOf().savings` reads `basket.valueOf(user)`.

### Custom errors → UI

`mirai.evm.ts` maps custom errors to `Error(Contract, #N)` (`ERROR_CODES`), `errors.ts` maps `#N` to an i18n key, and `i18n.tsx` holds the text in three languages. Adding a contract error means updating all three. `#9` is retired.

## Accounts: passkeys via Mera (`web/src/lib/wallet.tsx`)

- **Create:** `createPasskeyWithPrfOutput` → PRF output → BIP-39 phrase → `m/44'/60'/0'/0/0` key → `createSecp256k1SigningSession`. The key bytes and PRF output are zeroed; only the session holds the key. The standard path means the phrase also opens the account in any wallet app.
- **Sign in / recover:** `getPasskeyPrfOutput` with no credential lets the platform offer any synced passkey, so a cleared browser or a new device reconstructs the same address.
- **Session:** signing is prompt-free for 30 minutes after a ceremony, then the account locks. A locked account still shows balances (from the cached address); the next write runs one passkey prompt and checks the derived address matches.
- **MeraSigner** adapts the session to ethers: gas limit = estimate + 10% (Monad charges the limit), and the next nonce is tracked locally because Monad's RPC can report a stale pending nonce right after a receipt.

## Onboarding (`web/api/onboard.ts`)

After a passkey is created, the app POSTs the address to `/api/onboard`. A drip wallet (`DRIP_PRIVATE_KEY`) sends 0.5 MON if the balance is under 0.1 MON, and 250 AUSD from its own reserve if the account holds none. The reserve refills from Agora's faucet, which allows one 10,000 AUSD call per 60 seconds across all of testnet.

## Activity history

Monad's public RPC caps `eth_getLogs` at 100 blocks (~30s). `lib/activity.ts` queries the Envio indexer (`VITE_INDEXER_URL`) for full history and falls back to the last ~5 minutes of RPC logs. Principal and earnings need full history, so without the indexer the UI shows only the exact current value from `accountOf`.

The indexer (`indexer/`) stores an `Activity` row per event, plus running `Saver` (per account) and `Protocol` (global) totals.
