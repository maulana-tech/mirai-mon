<div align="center">
  <img src="web/public/favicon.svg" width="88" alt="Mirai">
  <h1>Mirai</h1>
  <p>Get paid in digital dollars. A slice of every payment saves itself, then earns yield or invests, on Monad.</p>

  <img src="https://img.shields.io/badge/network-Monad%20Testnet-836ef9.svg" alt="Monad Testnet">
  <img src="https://img.shields.io/badge/asset-AUSD-0647b3.svg" alt="AUSD">
  <img src="https://img.shields.io/badge/accounts-Mera%20passkeys-0ea5e9.svg" alt="Mera passkeys">
</div>

---

## What is Mirai?

Mirai splits every payment you receive into two pockets in the same transaction: a spendable balance, and savings that go straight into the strategy you picked: one of three ERC-4626 yield vaults, or the **Smart Money** basket (BTC/ETH weighted by what Nansen's smart money holds on Monad). Saving happens before you have a chance to spend, with no transfers to remember.

It is built for people who don't think of themselves as crypto users. You sign in with a passkey (Face ID or fingerprint), there is no seed phrase or wallet extension, and new accounts are funded with gas automatically, so the blockchain stays out of sight.

## How it works

```mermaid
flowchart LR
    P[Payer<br/>passkey account] -->|payWithPermit<br/>one transaction| C[Mirai]
    C -->|80% spend| S[Spendable balance]
    C -->|20% deposit| V[Strategy vault<br/>ERC-4626]
    V -->|yield: share price rises<br/>Smart Money: follows BTC/ETH| R[Recipient savings]
    N[Nansen smart money<br/>+ Chainlink prices] -.->|basket weights| V
```

1. **Sign in with a passkey.** [Mera](https://mera.category.xyz) derives the account key from the passkey's PRF output; a signing session keeps every later signature prompt-free. Clearing storage or switching device restores the same account from the synced passkey.
2. **Get paid.** Share `/pay/:address`. The payer signs an EIP-2612 permit locally and sends one `payWithPermit` transaction, so there is no separate approve.
3. **Auto-split.** The contract applies the recipient's split (default 20%) and deposits the savings slice into the vault in the same transaction.
4. **Earn or invest, then withdraw.** Savings are vault shares: in a yield strategy their value rises as yield arrives; in Smart Money it follows the market (and can fall). Spendable money can be withdrawn any time; savings can be time-locked toward a goal, kept encrypted to the passkey.

## Built on Monad

| | Why it matters here |
|---|---|
| **~300ms blocks, sub-second finality** | A payment is split and saved before the confirmation screen loads. The UI polls receipts every 500ms instead of ethers' 4s default. |
| **AUSD (Agora)** | A fully backed, 6-decimal USD stablecoin with EIP-2612 permit, so approve + pay is a single transaction. |
| **Mera passkey accounts** | The whole account layer: no extension, no seed phrase, no custody backend. |
| **Gas charged on the limit** | Gas limits come from `estimateGas` + 10%, never fixed padding, so users don't overpay. |
| **Chainlink push feeds on Monad** | BTC/USD and ETH/USD price the Smart Money basket and the Market page, with no keeper paying for updates. |
| **100-block `eth_getLogs` cap** | Full activity history comes from an [Envio](https://envio.dev) HyperIndex indexer (`indexer/`); the app falls back to the last ~5 minutes of RPC logs. |

## Deployed on Monad testnet

All contracts are verified on Sourcify (MonadVision). Source of truth: [`deployments.json`](deployments.json).

| Contract | Address |
|---|---|
| `Mirai` | [`0x8898BB4870e9757773E3E49E4Fe0caFAa00665b1`](https://testnet.monadscan.com/address/0x8898BB4870e9757773E3E49E4Fe0caFAa00665b1) |
| Conservative vault (4%) + streamer | [`0x6e18…e731`](https://testnet.monadscan.com/address/0x6e18fd1e7310DEBbaF42CbEDb8E67351d13ee731) · [`0xd119…B82B`](https://testnet.monadscan.com/address/0xd1195a8B1D9579CfcEDe2B3f819cbCf6B334B82B) |
| Balanced vault (8%, default) + streamer | [`0xb3d6…942e`](https://testnet.monadscan.com/address/0xb3d6Ba8127943C0F9Af129845C5EE7498c96942e) · [`0xdC6a…3D24`](https://testnet.monadscan.com/address/0xdC6aB7891A5F8E97F91Dd42B59D96D5D9f703D24) |
| Growth vault (12%) + streamer | [`0x7B0c…5394`](https://testnet.monadscan.com/address/0x7B0c991591C8dB9C983F48835aD4237068615394) · [`0x6F1C…4e`](https://testnet.monadscan.com/address/0x6F1C6f95F49196B5b8Cb769b16B9DE8C51f93a4e) |
| Smart Money `MarketVault` | [`0x1024D899fe9Bf3B1588358eC36825aF74a844ec3`](https://testnet.monadscan.com/address/0x1024D899fe9Bf3B1588358eC36825aF74a844ec3) |
| AUSD (Agora) | [`0xa901…22dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| Chainlink BTC/USD · ETH/USD | [`0x12C0…1715`](https://testnet.monadscan.com/address/0x12C0F44368a02081ce58a936d1C1F606BB301715) · [`0x5c8c…6d31`](https://testnet.monadscan.com/address/0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31) |

## Yield: strategies, honestly

Savers pick one of four strategies, each its own ERC-4626 vault: three earn yield, one invests. Switching moves existing savings in one transaction.

| Strategy | Testnet APR | Mainnet market it stands in for |
|---|---|---|
| Conservative | 4% | Aave V3 · AUSD |
| Balanced (default) | 8% | Curvance · AUSD (~8% live) |
| Growth | 12% | Upshift · earnAUSD |
| Smart Money | market price, can go down | BTC/ETH swaps through Kuru |

**How it earns:** yield is AUSD added to a vault without minting shares, so the share price and every saver's balance rise together. On testnet there is no AUSD lending market, so a `YieldStreamer` per vault pays the strategy's APR from an AUSD reserve. `Mirai` calls `drip()` before every deposit and withdrawal (wrapped in `try/catch`), so nobody buys shares at a stale price and a broken streamer can never block a payment. The app labels these rates as simulated.

**On mainnet** the streamers go away: `Mirai`'s constructor takes any ERC-4626 vaults, so it can point straight at real AUSD markets.

## Smart Money: invest, powered by Nansen

The fourth strategy puts savings into a **BTC/ETH basket** instead of a yield vault. `MarketVault` is an ERC-4626 vault whose share value is the basket's market value, read from **Chainlink push feeds** on Monad (BTC/USD, ETH/USD), so it moves with the market and can fall below what was saved. The app shows that risk on every surface.

**Nansen decides the tilt.** `web/api/market.ts` calls Nansen's `POST /api/v1/smart-money/holdings` (`chains: ["monad"]`, stablecoins excluded, native tokens included) once a day:

- Smart money's USD holdings of BTC-like (WBTC, cbBTC, …) and ETH-like (WETH, wstETH, …) tokens set the basket weights, with a 20% floor per coin.
- When the weights drift more than 3% from the on-chain ones, the server (the vault's `curator`) calls `MarketVault.rebalance`, which re-weights at current prices without changing the value.
- The Yield page shows the basket, live prices and Nansen's top smart-money holdings on Monad (value, holders, 24h change), so the saver sees *why* the basket looks the way it does.

The **Market** page (`/app/market`) puts it in context: live prices from Chainlink on Monad, the Smart Money basket with a one-tap "invest" switch, and a pool simulator for any mix of crypto, tokenized stocks, gold and AUSD (90-day backtest on Binance daily closes, plus an 80% range from volatility). Only the Smart Money basket is investable on-chain; the simulator is labelled as a simulation.

On testnet there is no AUSD liquidity for BTC/ETH, so a deposit "buys" basket units at the Chainlink price and the vault's AUSD backs withdrawals. Gains above the AUSD held are capped until the operator tops up a reserve; losses stay in the vault. On mainnet `_buy`/`_sell` become swaps through Kuru and the vault holds the coins. AUSD sent to the vault does not move its share price, because value comes from basket units.

The Yield page also has a **projection** that compares the three yield strategies against saving with no yield, for the saver's own split and a chosen monthly income and time horizon.

## Passkeys done properly (Mera)

**Mera is the whole account layer.** No seed phrase, no extension, no custody backend.

| What judges test | How Mirai handles it |
|---|---|
| Time to first transaction | One passkey ceremony creates the account; `/api/onboard` funds gas and test AUSD in the background, so the first payment needs no faucet visit. |
| Session design | A Mera signing session makes everyday actions prompt-free for 30 minutes: paying, withdrawing spending money, changing the split, saving a goal. **Withdrawing savings and setting a time lock always ask for the passkey again** (step-up), even inside a session. The header shows the session countdown and a lock-now button. |
| Session expiry | When the session ends the key is zeroed; balances stay visible, and the next action runs one passkey prompt that must derive the same address. |
| Stateless test | Clear storage or open a new device, tap *I already have an account*: the synced passkey re-derives the same account. |

**One passkey, many keys.** The account key comes from the PRF output under Mera's default salt. A **private savings goal** (name + target) is encrypted with a separate PRF namespace: Mera's secret vault draws a fresh random salt and derives an AES-256-GCM key via HKDF (`mera.v1.encrypt.secret`). Only the vault (salt, nonce, ciphertext) is stored on-chain (`Mirai.setGoal`). On another device the same synced passkey re-derives the key and opens it. Nothing secret is stored anywhere, and the goal key is unrelated to the signing key.

## Repository layout

```
├── evm/              # Contracts (Solidity 0.8.28, Foundry, OpenZeppelin v5)
│   ├── src/Mirai.sol        # Mirai: split, permit pay, withdrawals, time lock
│   ├── src/MiraiVault.sol   # ERC-4626 AUSD vault, one per yield strategy
│   ├── src/MarketVault.sol  # Smart Money: BTC/ETH basket vault priced by Chainlink
│   └── src/YieldStreamer.sol # testnet yield source: streams a fixed APR into a vault
├── web/              # App (React 19, Vite, ethers v6, Mera)
│   ├── api/onboard.ts      # Vercel function: gas + test AUSD for new accounts
│   ├── api/market.ts       # Vercel function: Nansen smart-money holdings → basket weights
│   ├── src/pages/market.tsx # Market: Chainlink price board, Smart Money, pool simulator
│   └── scripts/            # Runnable checks (signer equivalence, fork end-to-end)
├── indexer/          # Envio HyperIndex: Activity feed + per-saver and protocol totals
├── docs/             # Architecture, deployment, development
└── deployments.json  # Deployed addresses
```

## Running locally

```bash
# Contracts
cd evm && git submodule update --init
forge test                                                          # unit tests
MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork   # against real AUSD

# App
cd web && npm install
npm run dev        # http://localhost:5173 against the live testnet contract, onboarding included
```

See [docs/development.md](docs/development.md) for the full setup and [docs/deployment.md](docs/deployment.md) to deploy.

## Documentation

| Doc | Description |
|---|---|
| [Architecture](docs/architecture.md) | Contracts, passkey accounts, data flow |
| [Deployment](docs/deployment.md) | Deploying contracts, indexer and app; environment variables |
| [Development](docs/development.md) | Local setup, checks, gotchas |

## License

MIT
