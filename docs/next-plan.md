# Next plan: from testnet demo to mainnet with real money

Mirai today is a working **Monad testnet** product. Several pieces are deliberately testnet stand-ins: fake yield, a synthetic coin basket, free test funds. This plan lists what has to change before anyone deposits real AUSD on **Monad mainnet**, in the order it should happen.

Nothing here is started. Facts marked *(verify)* come from third-party pages and must be checked against the official source before use.

## 1. What is testnet-only today

| Piece | Testnet behaviour (now) | Mainnet replacement |
|---|---|---|
| Yield strategies 0–2 (`MiraiVault` + `YieldStreamer`) | Fixed 4 / 8 / 12% APR **paid from a reserve we top up**. Not real yield. | Real AUSD yield vaults (ERC-4626 lending or vault markets). Variable APY, shown live. |
| Invest basket (`BasketVault`) | Deposits "buy" **synthetic units** at a price; withdrawals are paid from the vault's AUSD and a reserve. No coin is actually bought. | Real swaps on deposit and withdraw (Kuru Flow or the 0x Swap API), holding real tokens. |
| Curator prices (`setPrices`) | The server pushes MON/memecoin prices from DexScreener. | **Must go.** Whoever sets the price sets the payout, so a curator key could drain the vault. Use only Chainlink feeds or on-chain DEX TWAPs. |
| Curator / drip key | One EOA is deployer, curator and server key (`DRIP_PRIVATE_KEY`). | Separate keys; curator powers behind a multisig and timelock; the server holds no key with power over funds. |
| Onboarding (`/api/onboard`) | Sends free test AUSD + MON from a drip wallet and Agora's faucet. | No free money. New users still need MON for gas: see §4. |
| Chain config | `CHAIN_ID = 10143`, testnet RPC/explorer hardcoded in `web/src/lib/config.ts`, `web/api/*.ts`, `indexer/config.yaml`. | Chain chosen by env; mainnet chain ID **143**. |
| Price staleness | No max age on oracle prices (`BasketVault._price`, a `ponytail:` note). | Revert or pause on stale Chainlink data. |
| Nansen | Free plan, ~10 credits/day, snapshot cached in `/tmp`. | Paid plan; snapshot stored in durable storage, not per-instance `/tmp`. |
| Landing copy | "4%, 8% or 12% a year… the balance only goes up", "Get test funds". | Live APY, real risk wording, no faucet. |

## 2. Blockers before real money (must-have)

### 2.1 Real yield instead of the streamer
- Replace the three `MiraiVault` + `YieldStreamer` pairs with existing audited AUSD vaults. Candidates on Monad *(verify each: TVL, audit, withdrawal liquidity)*:
  - **Morpho**: Steakhouse AUSD vaults (ERC-4626).
  - **Upshift `earnAUSD`**: a multi-strategy AUSD vault; its share token appreciates.
  - **Curvance**: cAUSD lending market.
- Map strategies to risk honestly: conservative = a plain lending market, balanced/growth = multi-strategy vaults. Show each vault's live APY and name in the UI, and link to it.
- `Mirai` already talks to strategies through ERC-4626 (`deposit` / `redeem` / `convertToAssets`). The work is mostly removing `drip()` calls and adding a per-strategy deposit cap. Re-run the share-price and rounding tests against a real vault on a mainnet fork.
- Remove "the balance only goes up": real vaults can lose value (bad debt, depeg).

### 2.2 A real basket, or no basket at launch
- Option A (launch without Invest): ship yield pockets only, and add Invest once 2.2B is audited. Lowest risk.
- Option B (real basket): on deposit, swap AUSD into each coin through **Kuru Flow** (`ws.kuru.io`, JWT auth) or the **0x Swap API** (aggregates Kuru, Uniswap, Clober and more on chain 143). Hold the real tokens per (user, pocket); on withdraw, swap back.
  - Needs: slippage limits (`minOut`) per swap, MEV-aware routing, a per-trade size limit, and a liquidity floor (drop a coin when its pool is too thin).
  - **Memecoins**: consider leaving them out of mainnet v1, or behind a strong acknowledgement and a small cap. Thin liquidity means a big pocket cannot exit at the quoted price.
  - Smart Money weights become a *target*: rebalancing costs swap fees, so rebalance only past a drift threshold.
- Either way, delete curator-pushed prices.

### 2.3 Remove trusted power over funds
- The curator should only be able to set Smart Money weights. Put that behind a **Safe multisig + timelock**, with bounds (max weight per asset, max change per update).
- Decide upgradeability now. Recommendation: immutable contracts, plus a guardian that can **pause new deposits but never block withdrawals**.
- Add global and per-user deposit caps for the beta.
- Rotate every key that has ever been in a testnet `.env` or a terminal. Never reuse a testnet key on mainnet.

### 2.4 Security
- Invariant and fuzz tests (Foundry) for Mirai's split math, pocket shares (must sum to 10,000), withdraw-all, and close-pocket; mainnet-fork tests against the real vaults and DEX.
- An external audit of `Mirai.sol` and the new basket before the cap is raised. Then a public bug bounty.
- Monitoring: alerts on large withdrawals, vault share-price drops, oracle staleness, and failed curator updates.

## 3. Accounts and passkeys (permanent decisions)

- **The domain is forever.** Passkeys are bound to the WebAuthn RP ID (hostname). Moving domains later makes every account unreachable from the new domain. Pick the production domain once, before launch.
- **Recovery.** Mera accounts are EOAs derived from the passkey (BIP-44), so a user who loses every synced copy of their passkey loses the account. Ship an "export recovery phrase" flow with clear warnings, and explain that iCloud Keychain, Google Password Manager or 1Password sync the passkey across devices.
- **Browser support.** Desktop Chrome returns PRF only for passkeys saved in Google Password Manager; otherwise Mera throws `PRF_UNAVAILABLE`. Detect it and show a fix-it message, and test the combinations on Mera's authenticator support list.
- Pocket names stay encrypted with the second PRF salt. This doesn't change, but recovery must cover it (the same passkey restores the names).

## 4. Gas on mainnet

On testnet we hand out MON. On mainnet a new user has none, yet withdrawing and changing pockets cost gas.
- Receiving a payment needs no gas from the receiver (the payer's `payWithPermit` does it). Good.
- For the receiver's own actions, choose one:
  1. **Sponsored transactions** (a relayer or paymaster pays gas; EIP-7702 lets an EOA delegate to a smart account). Best UX, needs a sponsor budget and abuse limits.
  2. **A small MON top-up** on first withdrawal, deducted from the withdrawn AUSD via a swap.
  3. Ask the user to get MON from an exchange (worst UX; not recommended).
- Delete `/api/onboard`'s faucet logic and `DRIP_PRIVATE_KEY` from production.

## 5. Infrastructure changes

- **Config by environment**: chain ID (143), RPC (`https://rpc.monad.xyz` plus a paid provider for production load), explorer (monadvision.com *(verify)*). Remove hardcoded `10143` from `web/src/lib/config.ts`, `web/api/onboard.ts` and `web/api/market.ts`.
- **AUSD on Monad mainnet**: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, 6 decimals, a LayerZero OFT *(verify on Agora's contract-deployments page and the explorer)*. It supports EIP-2612 permit on testnet; confirm the mainnet token's permit domain before relying on `payWithPermit`.
- **Chainlink**: Data Feeds are live on Monad mainnet (since Nov 2025). Take feed addresses from Chainlink's Monad mainnet price-feed page; check that each basket coin has one.
- **Envio**: HyperIndex supports Monad mainnet (chain 143, HyperSync `https://143.hypersync.xyz`). Add a mainnet network to `indexer/config.yaml` with the new addresses and start block, and deploy it on Envio Cloud.
- **Nansen**: paid plan; keep the daily snapshot in durable storage (Vercel KV or Blob, or on-chain) so a cold start doesn't spend credits; alert on 403.
- **Separate deployments**: a testnet preview and production mainnet, with different env and different passkey domains.

## 6. Product, legal and money in/out

- **Risk disclosures** on every strategy: what the vault does, that APY varies, that value can fall. Invest is not financial advice; Smart Money is a signal, not a guarantee.
- **Terms of service and privacy policy**; check where the app may be offered (stablecoin, yield and investment rules differ by country, including Indonesia).
- **Fiat on/off-ramp**: the freelancer story needs "client pays in USD → I get AUSD → I cash out to my bank". Look at Agora's ramp partners and local off-ramps.
- **Fees**: decide whether Mirai takes a fee (e.g. a small cut of yield), and show it plainly. Today there is none.
- **Support**: a way to report problems; a status page for Nansen, oracles and the indexer.

## 7. Phases

| Phase | Goal | Exit criteria |
|---|---|---|
| **0. Hackathon (now)** | Testnet demo, submission, video | Live testnet URL, Envio Cloud, SUBMISSION.md |
| **1. Mainnet design** | Pick vaults, basket option A/B, gas option, domain, key setup | Decisions in §8 recorded |
| **2. Build on a mainnet fork** | Real vault adapters, real swaps (if B), caps, pause, env config, recovery export | Invariant/fork tests green; internal review |
| **3. Audit** | External audit, fixes | Audit report published |
| **4. Guarded beta** | Mainnet with low caps, allowlisted users, monitoring | 2–4 weeks without incidents |
| **5. Public launch** | Raise caps, bug bounty, ramps | — |

## 8. Decisions needed

1. Launch with Invest (option B) or yield-only (option A)?
2. Which AUSD vaults back conservative / balanced / growth?
3. Gas: sponsored transactions, MON top-up, or neither?
4. Production domain (permanent for passkeys).
5. Immutable contracts + pause guardian, or upgradeable?
6. Fee model, if any.

## Sources

- Monad network information (mainnet chain ID 143, RPC): https://docs.monad.xyz/getting-started/network-information
- AUSD on Monad (address, OFT), Aave governance assessment: https://governance.aave.com/t/agora-usd-ausd-on-aave-monad-assessments/25251
- Chainlink Data Feeds on Monad mainnet: https://dev.chain.link/changelog/data-feeds-expands-to-monad-mainnet
- Monad oracles: https://docs.monad.xyz/tooling-and-infra/oracles
- Envio supported networks (Monad 143): https://docs.envio.dev/docs/HyperIndex/supported-networks
- Mera on Monad: https://docs.monad.xyz/guides/mera
- earnAUSD (Upshift): https://www.upshift.finance/blog/earning-stablecoin-yield-on-monad-with-earnausd
- Monad vaults overview: https://tradingstrategy.ai/trading-view/monad/vaults
- Kuru Flow: https://docs.monad.xyz/guides/kuru-flow
- 0x Swap API on Monad: https://0x.org/docs/introduction/build-on-monad
