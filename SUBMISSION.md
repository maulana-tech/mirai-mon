# Mirai: Monad Metropolis submission

> Get paid in digital dollars, and a slice of every payment saves itself, split across pockets that earn yield or follow smart money. On Monad, with a passkey instead of a seed phrase.

| | |
|---|---|
| **Track** | Consumer Products & Payments |
| **Bounties** | Mera UX · Mera One Passkey Many Keys · Agora (AUSD) · Nansen · Envio |
| **Network** | Monad testnet (chain 10143) |
| **Source** | https://github.com/maulana-tech/mirai-mon |
| **Live demo** | _to be added_ |
| **Demo video** | [docs/demo.md](docs/demo.md): 3-minute cut + seven chapters with timelines (upload pending) |
| **Main contract** | `Mirai` [`0xEAFFa1705b5cf69B291aa88484F9655Fe8341b83`](https://testnet.monadscan.com/address/0xEAFFa1705b5cf69B291aa88484F9655Fe8341b83) (verified on Sourcify) |

## The product in one paragraph

Freelancers and anyone with irregular income know they should save, but every payment lands in one balance and gets spent. Mirai moves saving into the payment itself: you share a link, the payer pays in AUSD with one passkey tap, and the `Mirai` contract splits the payment in the same transaction: part spendable, part saved across **up to ten pockets** (laptop, trip, rainy day), each with its own target, lock and strategy (three ERC-4626 yield vaults, or a coin basket that follows **Nansen** smart money, priced by **Chainlink**). Accounts are **Mera** passkeys: no seed phrase, no extension, gas and test funds arrive on signup.

## Track: Consumer Products & Payments

| What a consumer payments product needs | Mirai |
|---|---|
| A real everyday job | Saving from your own income, at the moment money arrives |
| Getting paid is easy | A shareable link and QR (`/pay/:address`), optional name and amount |
| Paying is easy | One passkey tap; EIP-2612 permit + `payWithPermit` in **one transaction**, no approve step |
| Crypto is invisible | Passkey sign-in, automatic gas, local-currency display, three languages (EN / ID / 中文) |
| Trust | Only the user can move their money (`msg.sender == user`); withdrawing savings, closing a pocket and locking need the passkey again |

Where to look: [`evm/src/Mirai.sol`](evm/src/Mirai.sol) (`pay`, `payWithPermit`, pockets), [`web/src/pages/pay.tsx`](web/src/pages/pay.tsx), [`web/src/pages/payment-link.tsx`](web/src/pages/payment-link.tsx), [`web/src/pages/pockets.tsx`](web/src/pages/pockets.tsx).

## Bounty: Mera, One Passkey Many Keys

**One passkey, two unrelated keys, two jobs.**

| Key | Derived from | Used for |
|---|---|---|
| Account key | PRF output under Mera's default salt → BIP-39 → secp256k1 | Signing every transaction |
| Pocket key | PRF output under a **second salt** (`sha256("mirai.pockets.v1")`) → HKDF-SHA-256 → non-extractable AES-256-GCM `CryptoKey` | Encrypting each pocket's name, icon and savings target |

- Only `version ‖ nonce(12) ‖ ciphertext` goes on-chain (`Mirai.setPocketMeta` / `createPocket`). The chain never sees a pocket name or target.
- The pocket key is derived once per session (one extra prompt, not one per pocket), held only in memory, and dropped on lock.
- On a new device the same synced passkey re-derives both keys: same address, same readable pocket names. Nothing secret is stored anywhere.

Where to look: [`web/src/lib/pocket-meta.ts`](web/src/lib/pocket-meta.ts) (`encryptMeta`, `decryptMeta`, `usePocketMetas`), [`web/src/lib/wallet.tsx`](web/src/lib/wallet.tsx).

How to verify: create a pocket named e.g. "Laptop", then read `pocketsOf(you)` on the explorer. The `meta` field is ciphertext. Sign in on another device with the synced passkey and tap "Show names": the name comes back.

## Bounty: Mera UX

| Moment | What happens |
|---|---|
| First visit | One passkey ceremony creates the account; `/api/onboard` sends gas + test AUSD in the background, so the first payment needs no faucet |
| Everyday use | A 30-minute signing session: paying, withdrawing spending money, changing the split, creating pockets need no prompt. The header shows the countdown and a lock button |
| Sensitive actions | Withdrawing savings, closing a pocket and setting a lock always ask for the passkey again (`getSigner({ stepUp: true })`), even inside a session |
| Session end | The key is zeroed; balances stay visible; the next action runs one prompt that must derive the same address |
| Lost device / cleared storage | "I already have an account" re-derives the same account from the synced passkey |
| Payer side | Payers sign in with a passkey too, on the payment page itself |

Where to look: [`web/src/lib/wallet.tsx`](web/src/lib/wallet.tsx), [`web/src/lib/mera-signer.ts`](web/src/lib/mera-signer.ts) (local nonce tracking, `estimateGas` + 10% because Monad charges the gas limit), [`web/src/components/passkey-dialog.tsx`](web/src/components/passkey-dialog.tsx), [`web/api/onboard.ts`](web/api/onboard.ts).

## Bounty: Agora (AUSD)

- **AUSD is the app's money.** Every balance, payment, pocket and vault is AUSD (6 decimals).
- **Permit payments.** AUSD's EIP-2612 permit lets the payer approve and pay in one transaction (`payWithPermit`); a fork test runs it against the real testnet AUSD (`MiraiFork.t.sol`).
- **The cross-border story.** A freelancer in Indonesia is paid by a client abroad in digital dollars that land in seconds; the app shows the balance in their local currency with AUSD underneath, and saves a slice before it can be spent.
- **AUSD earns.** Savings sit in ERC-4626 AUSD vaults; on mainnet these point at real AUSD markets (see [docs/next-plan.md](docs/next-plan.md)).

Where to look: [`evm/src/Mirai.sol`](evm/src/Mirai.sol) (`payWithPermit`), [`evm/test/MiraiFork.t.sol`](evm/test/MiraiFork.t.sol), [`web/src/lib/ausd.ts`](web/src/lib/ausd.ts).

## Bounty: Nansen

**Nansen data moves money, it isn't only displayed.** The default invest option, "Follow Smart Money", is weighted daily from two Nansen endpoints on Monad:

| Endpoint | Used for |
|---|---|
| `POST /api/v1/smart-money/holdings` | USD smart money holds per token |
| `POST /api/v1/smart-money/dex-trades` | 24h net buying per token (Monad has no `netflow` rows yet, so the flow is computed from trades) |

Conviction = USD held + net buying, floored at 0; 90% is shared by conviction under caps (≤ 50% per coin, memecoins ≤ 10% each and 20% together, ≥ 10% stable). When the weights drift > 3% from the on-chain ones, the server calls `BasketVault.setSmartWeights`, and every follower's basket moves to them on its next action. The Invest page shows per coin what smart money holds, what it bought today and the resulting weight, with "Powered by Nansen" and the update time.

Where to look: [`web/api/market.ts`](web/api/market.ts), [`evm/src/BasketVault.sol`](evm/src/BasketVault.sol) (`setSmartWeights`, `sync`), [`web/src/pages/market.tsx`](web/src/pages/market.tsx). Check: `node web/scripts/check-market.ts`.

Note: on the free plan the two calls use the daily ≈10 credits. If credits run out, the app shows "Nansen offline" and the basket keeps its last on-chain weights; nothing breaks.

## Bounty: Envio

The public Monad RPC caps `eth_getLogs` at 100 blocks, so without an indexer the app could only show ~5 minutes of history. Envio HyperIndex makes the history and the earnings possible:

| Entity | Used for |
|---|---|
| `Activity` | The activity feed: payments, pocket changes, basket weights, withdrawals |
| `PocketFlow` | Net deposits per pocket, so each pocket shows what it **earned** (value − deposits) |
| `Saver` | Per-user totals: received, saved, withdrawn, payments |
| `Protocol` | Totals on the landing page: volume, saved, savers |

The `PocketFunded` event was added to `Mirai` specifically so the indexer can attribute every payment to pockets.

Where to look: [`indexer/config.yaml`](indexer/config.yaml), [`indexer/schema.graphql`](indexer/schema.graphql), [`indexer/src/EventHandlers.ts`](indexer/src/EventHandlers.ts), [`web/src/lib/activity.ts`](web/src/lib/activity.ts).

## Demo script (≈3 minutes)

1. **Landing (15s)**: what Mirai is; the stack and the "one payment, step by step" section
2. **Sign in (20s)**: Face ID → account created → test funds arrive by themselves
3. **Get paid (20s)**: copy the payment link / QR
4. **Pay (30s)**: second account opens the link → one passkey tap → paid
5. **The split (30s)**: dashboard shows spendable vs saved; pockets filled by their shares
6. **Pockets (30s)**: create "Laptop" with a target (name encrypted; show ciphertext on the explorer), set strategy, lock
7. **Invest (20s)**: Follow Smart Money, per-coin Nansen data, Chainlink prices
8. **History (15s)**: activity feed and per-pocket earnings from Envio

## Testing

- **Contracts**: 41 Foundry tests, including a fork test that pays with a permit against the real testnet AUSD: `cd evm && forge test`
- **End to end**: `node web/scripts/check-fork.ts` on an anvil fork: pay → split → pockets → strategy switch → invest → withdraw → close
- **Web**: `npm run lint && npm run build`; `check-pockets`, `check-market`, `check-pool`, `check-mera-signer`

## Honest limitations

- Testnet has no AUSD lending market or coin liquidity: yield vaults pay a **simulated** APR from a reserve, and the basket books units at oracle prices instead of swapping. The app labels both.
- The curator wallet pushes memecoin prices and Smart Money weights. Fine for a testnet demo; the mainnet plan removes curator prices and puts weights behind a multisig.

What it takes to run Mirai with real money on Monad mainnet: [docs/next-plan.md](docs/next-plan.md).
