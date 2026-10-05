# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) holds the commands, gotchas, and web conventions. This file adds testing commands and the cross-file architecture. `docs/architecture.md` has the long form.

## Testing

- `cd evm && forge test`. Single test: `forge test --match-test <name>`, single file: `forge test --match-path test/Mirai.t.sol`, `-vvvv` for traces. `test/MiraiFork.t.sol` is skipped unless `MONAD_RPC_URL` is set.
- Web: `npm run lint && npm run build`, plus `node scripts/check-mera-signer.ts` after touching `mera-signer.ts` and `node scripts/check-fork.ts` for anything on the payment path.

## Architecture

**Contracts (`evm/src/`)**
- `Mirai.sol` (`Mirai`) holds spend balances in AUSD and savings as shares of the saver's strategy vault (three yield `MiraiVault`s, OZ ERC-4626 with a 10^6 virtual-share offset, plus the Smart Money `MarketVault`, a BTC/ETH basket priced by Chainlink and weighted from Nansen via `web/api/market.ts`). `YieldStreamer` pays each vault a fixed APR on testnet; `Mirai` drips it before every deposit/withdrawal. `setStrategy` migrates savings between vaults. `withdrawAllSavings` redeems every share (used for "withdraw all"). `pay`/`payWithPermit(from, to, amount, …)` pull AUSD from the payer, deposit `amount × splitBps` into the vault for the recipient and credit the rest to `spend`, all in one transaction.
- Every user-scoped function takes the user explicitly and requires `msg.sender == user`.
- `lockUntil` blocks savings withdrawals only.

**Web (`web/src/`)**
- `lib/mirai.ts` exports one `MiraiService` (`lib/types.ts`): `mirai.evm.ts` or `mirai.mock.ts`, chosen by `CONTRACT_ID` in `lib/config.ts`. Pages call `mirai`, never ethers directly.
- `lib/wallet.tsx` is a module-level store (`useSyncExternalStore`): passkey → Mera PRF → BIP-39 → key → `MeraSigner` (`lib/mera-signer.ts`). `getSigner()` is the only write entry point. `PasskeyDialog` is the sign-in UI and triggers `/api/onboard` for new accounts.
- `lib/app-state.tsx` (`AppStateProvider`/`useAppState`) shares account, activity and FX rates across `/app/*`. `lib/settings.tsx` holds locale and display currency; `lib/i18n.tsx` holds the strings.
- Yield numbers are live: `useVaultStats` reads vault TVL and share price; `lib/yield.ts` replays activity for principal/earnings only when `HISTORY_COMPLETE` (indexer configured).
