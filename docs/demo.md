# Demo

Every flow in Mirai, recorded on Monad testnet against the live contracts. No mock data: balances, pockets and history are read from the chain and the Envio indexer.

Passkey prompts are covered with a "Passkey confirmed" card in the videos: the operating system's dialog shows the account e-mail and the computer's user name.

## The 3-minute demo

https://github.com/user-attachments/assets/e83bf82d-50dd-4fcd-82e0-fb9743062acd

| Time | What happens |
|---|---|
| 0:00 | Mirai in one line: get paid in digital dollars, a slice of every payment saves itself |
| 0:04 | **The problem**: saving is a decision you make again for every payment |
| 0:11 | **The solution**: a 100 AUSD payment splits on arrival into 80 spendable and 20 across three pockets |
| 0:20 | **Six habits**: passkeys, payment link, auto-split, pockets, yield, smart money |
| 0:28 | The landing page in one scroll |
| 0:38 | Sign in with a passkey (Mera) |
| 0:52 | Gas and test AUSD arrive by themselves |
| 0:58 | Share one payment link |
| 1:07 | The payer: one passkey tap, one transaction (EIP-2612 permit + `payWithPermit`), receipt on the explorer |
| 1:32 | A live receipt on the receiver's side, split on arrival |
| 1:44 | Pick your split once |
| 1:53 | A pocket for every goal: name and target encrypted with a second passkey key |
| 2:13 | Grow it: yield vaults, the Invest page, Smart Money from Nansen, Chainlink prices |
| 2:34 | Withdraw savings with a passkey step-up |
| 2:51 | Every move in the activity feed, indexed by Envio |
| 3:01 | **Built on**: what Monad, Mera, AUSD, Nansen, Envio and Chainlink each do in Mirai |

## Step by step

Seven short chapters, each with a timeline. Together they are the full 6:44 walkthrough.

| # | Chapter | Length |
|---|---|---|
| 1 | [The landing page](#1-the-landing-page) | 0:29 |
| 2 | [Sign in, get funds, share your link](#2-sign-in-get-funds-share-your-link) | 0:43 |
| 3 | [Pay a link](#3-pay-a-link) | 0:38 |
| 4 | [Split and pockets](#4-split-and-pockets) | 0:54 |
| 5 | [Yield and invest](#5-yield-and-invest) | 1:17 |
| 6 | [A live receipt](#6-a-live-receipt) | 0:41 |
| 7 | [Send and withdraw](#7-send-and-withdraw) | 1:16 |

### 1. The landing page

https://github.com/user-attachments/assets/9653aa87-9e6a-4962-92c8-647ce2bf245a

| Time | What happens |
|---|---|
| 0:03 | The hero, then "From one payment to every pocket, in one transaction" |
| | The stack: on-chain, identity, data, app, with every sponsor's logo |
| | The six habits as interactive cards, the system architecture, "one payment, step by step" |
| | The live vault: total saved, yield range and savers, read from the chain on page load |

### 2. Sign in, get funds, share your link

https://github.com/user-attachments/assets/8acd6687-8f00-4b5a-bf1f-869d84d045f5

| Time | What happens |
|---|---|
| 0:03 | **Sign in with a passkey.** Mera derives the Monad account from the passkey's PRF output. No seed phrase, no extension |
| 0:19 | **Funds arrive by themselves.** `/api/onboard` sends 0.5 MON for gas and 250 test AUSD. The app is then switched from Bahasa Indonesia to English in Settings |
| 0:30 | **Share one payment link.** A display name ("salary"), an optional preset amount, a QR code and a copy button |

What to look for: the first transaction needs no faucet visit (**Mera UX**).

### 3. Pay a link

https://github.com/user-attachments/assets/58f3da97-5d59-46c7-b4d2-324305bf6acf

| Time | What happens |
|---|---|
| 0:03 | **The payer opens the link** in another browser, as a second account. The page shows how much of the payment goes to the receiver's savings |
| 0:17 | **One tap, one transaction.** The payer signs an AUSD permit with their passkey; `payWithPermit` pulls and splits the payment in a single transaction. The receipt opens on the Monad explorer |
| 0:30 | **Back on the payer side**: the payer's balance is 25 AUSD lower |

What to look for: no approve step; one transaction from tap to settled (**AUSD**, **Monad**).

### 4. Split and pockets

https://github.com/user-attachments/assets/4acb475b-da10-4a81-b140-e75563660abb

| Time | What happens |
|---|---|
| 0:03 | **Pick your split once.** The savings split moves from 20% to 15% and is saved on-chain |
| 0:20 | **Pockets.** The main pocket's strategies: Conservative, Balanced, Growth (yield vaults) and Invest (coin basket) |
| 0:28 | **A new pocket, privately named.** Icon, name and target are encrypted with a key from a second passkey PRF salt before `createPocket`. Then its share, strategy and an extend-only lock |

What to look for: the pocket's `meta` on-chain is ciphertext; the same passkey opens it on another device (**Mera One Passkey Many Keys**).

### 5. Yield and invest

https://github.com/user-attachments/assets/44a38a9b-94ac-4bb6-acde-2cb88dde5882

| Time | What happens |
|---|---|
| 0:03 | **Yield and the Invest page.** Live vault numbers and a savings projection; Chainlink prices on Monad; how Smart Money decides, per coin; a pool simulator |
| 0:20 | **An invest pocket** named "Fund" with a savings target |
| 0:41 | **Follow Smart Money, or build your own.** Nansen weights by default; a custom mix with sliders, and a warning above 20% memecoins |

What to look for: "Powered by Nansen" with today's update time; the weights come from Nansen smart-money holdings and DEX trades and are set on-chain (**Nansen**).

### 6. A live receipt

https://github.com/user-attachments/assets/9c2b76a8-2269-4579-95c2-f7dd503adb59

| Time | What happens |
|---|---|
| 0:03 | **Someone pays your link**: 50 AUSD from the second account, confirmed with their passkey |
| 0:21 | **It lands, already split.** A "Received …, saved …" toast pops up on the receiver's open dashboard and every pocket fills by its share, without a reload |

### 7. Send and withdraw

https://github.com/user-attachments/assets/db618e84-2390-4e3f-af84-b3e625297d5b

| Time | What happens |
|---|---|
| 0:03 | **Send and withdraw spendable money.** 10 AUSD back to the account, receipt on the explorer |
| 0:42 | **Withdraw savings with a step-up.** Taking 5 AUSD out of a pocket asks for the passkey again, even inside the 30-minute session |
| 1:06 | **Every move, indexed by Envio.** The activity feed: payments, pocket changes and withdrawals |

What to look for: full history beyond the public RPC's 100-block log window (**Envio**).

## How these videos were made

Screen recordings of the app on `localhost` against the Monad testnet deployment, edited with [Remotion](https://www.remotion.dev): the explainer scenes, captions and passkey cards are React components, and each chapter is rendered from the same timeline as the 3-minute cut.
