// End-to-end on a local Monad testnet fork with real AUSD: onboarding drip, then a passkey-style
// (MeraSigner) payment through payWithPermit, then withdrawals, then a second (invest) pocket
// (a custom basket priced by Chainlink + curator prices; the Smart Money update runs on anvil only). Needs anvil + a deployed Mirai:
//   anvil --network monad --fork-url https://testnet-rpc.monad.xyz
//   (cd ../evm && forge script script/DeployMirai.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
//      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
//   MIRAI=0x... node scripts/check-fork.ts
// Against live testnet instead: RPC_URL=https://testnet-rpc.monad.xyz DRIP_PRIVATE_KEY=<funded key> MIRAI=0x...
import assert from 'node:assert/strict'
import { Contract, JsonRpcProvider, Network, Signature, Wallet, getBytes } from 'ethers'
import { createSecp256k1SigningSession } from '@category-labs/mera'
import { MeraSigner } from '../src/lib/mera-signer.ts'

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
const MIRAI = process.env.MIRAI ?? ''
assert.ok(MIRAI, 'set MIRAI to the deployed address')

process.env.MONAD_RPC_URL = RPC
// anvil's default account #0 (pre-funded on the fork) unless a real drip key is given
process.env.DRIP_PRIVATE_KEY ??= '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const { POST } = await import('../api/onboard.ts')
const onboard = (body: unknown) =>
  POST(new Request('http://x/api/onboard', { method: 'POST', body: JSON.stringify(body) }))

const provider = new JsonRpcProvider(RPC, Network.from(10143), { staticNetwork: true })
provider.pollingInterval = 200
const ausd = new Contract(
  AUSD,
  [
    'function balanceOf(address) view returns (uint256)',
    'function nonces(address) view returns (uint256)',
    'function eip712Domain() view returns (bytes1,string name,string version,uint256,address,bytes32,uint256[])',
  ],
  provider,
)
const MIRAI_ABI = [
  'function accountOf(address) view returns ((uint16 splitBps,uint128 spend,uint256 savings,uint8 pocketCount))',
  'function pocketsOf(address) view returns ((uint16 shareBps,uint8 strategy,bool open,uint64 lockUntil,uint128 shares,uint256 value,bytes meta)[])',
  'function payWithPermit(address from,address to,uint256 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function withdrawSpend(address user,uint256 amount)',
  'function createPocket(address user,uint8 strategy,bytes meta) returns (uint256)',
  'function setPocketShares(address user,uint16[] bps)',
  'function setPocketMeta(address user,uint256 id,bytes meta)',
  'function withdrawPocket(address user,uint256 id,uint256 amount)',
  'function withdrawAllPocket(address user,uint256 id) returns (uint256)',
  'function closePocket(address user,uint256 id,uint256 into)',
  'function strategies() view returns (address[4] vaults,address[4] yieldSources)',
]
const BASKET_ABI = [
  'function assets() view returns ((string symbol,address feed,bool meme)[])',
  'function smartWeights() view returns (uint16[])',
  'function weightsOf(address user,uint256 pocket) view returns (uint16[])',
  'function unitsOf(address user,uint256 pocket) view returns (uint256[])',
  'function valueOf(address user,uint256 pocket) view returns (uint256)',
  'function curator() view returns (address)',
  'function setWeights(address user,uint256 pocket,uint16[] weights)',
  'function setSmartWeights(uint16[] weights)',
  'function setPrices(uint256[] ids,uint256[] newPrices)',
  'function prices() view returns (uint256[])',
  'function sync(address user,uint256 pocket)',
]

function meraAccount() {
  const key = getBytes(Wallet.createRandom().privateKey)
  return new MeraSigner(createSecp256k1SigningSession({ privateKey: key }), provider)
}

// 1. Brand-new accounts are onboarded, exactly as the app does after passkey creation.
const payer = meraAccount()
const recipient = meraAccount()
for (const who of [payer, recipient]) {
  const res = await onboard({ address: who.address })
  assert.equal(res.status, 200, `onboard ${who.address}: ${JSON.stringify(await res.json())}`)
}
console.log('payer', payer.address, 'recipient', recipient.address)
const amount = 100_000_000n // 100 AUSD

// 2. The permit src/lib/ausd.ts signs, then payWithPermit through MeraSigner.
const { name, version } = await ausd.eip712Domain()
const asPayer = new Contract(MIRAI, MIRAI_ABI, payer)
async function pay(to: string, value: bigint) {
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 1200n
  const sig = Signature.from(
    await payer.signTypedData(
      { name, version, chainId: 10143, verifyingContract: AUSD },
      {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { owner: payer.address, spender: MIRAI, value, nonce: await ausd.nonces(payer.address), deadline },
    ),
  )
  const tx = await asPayer.payWithPermit(payer.address, to, value, deadline, sig.v, sig.r, sig.s)
  const receipt = await tx.wait()
  assert.equal(receipt?.status, 1)
  return { tx, receipt }
}
const { tx, receipt } = await pay(recipient.address, amount)
console.log('pay tx', tx.hash)
console.log('pay gas used / limit:', receipt?.gasUsed, '/', tx.gasLimit)

const acc = await new Contract(MIRAI, MIRAI_ABI, provider).accountOf(recipient.address)
assert.equal(acc.spend, 80_000_000n)
// ERC-4626 rounds against the depositor: a vault that already earned yield can show 1 unit less.
assert.ok(acc.savings >= 19_999_999n && acc.savings <= 20_000_000n, `savings ${acc.savings}`)

// 3. Recipient withdraws spending and its (default) savings pocket with its own MeraSigner.
const asRecipient = new Contract(MIRAI, MIRAI_ABI, recipient)
const reader = new Contract(MIRAI, MIRAI_ABI, provider)
const before: bigint = await ausd.balanceOf(recipient.address)
await (await asRecipient.withdrawSpend(recipient.address, acc.spend)).wait()
await (await asRecipient.withdrawPocket(recipient.address, 0, acc.savings)).wait()
assert.equal((await ausd.balanceOf(recipient.address)) - before, acc.spend + acc.savings)

// 4. A second pocket (invest) with an encrypted label (opaque bytes round-trip byte for byte), 60/40 split.
const label = '0x01' + 'ab'.repeat(40)
await (await asRecipient.createPocket(recipient.address, 3, label)).wait()
await (await asRecipient.setPocketShares(recipient.address, [6000, 4000])).wait()
let pockets = await reader.pocketsOf(recipient.address)
assert.equal(pockets.length, 2)
assert.equal(pockets[1].meta, label)
assert.equal(pockets[1].strategy, 3n)

// 5. Invest: pocket 1's savings go into its own basket at live prices, and come back out.
const { vaults } = await reader.strategies()
const basket = new Contract(vaults[3], BASKET_ABI, provider)
const assets: { symbol: string; meme: boolean }[] = await basket.assets()
const idx = (symbol: string) => assets.findIndex((a) => a.symbol === symbol)
const local = RPC.includes('127.0.0.1') || RPC.includes('localhost')
async function asCurator() {
  const curator: string = await basket.curator()
  await provider.send('anvil_impersonateAccount', [curator])
  await provider.send('anvil_setBalance', [curator, '0xde0b6b3a7640000'])
  return new Contract(vaults[3], BASKET_ABI, await provider.getSigner(curator))
}
// A basket deployed for this fork has no curator prices yet (live, /api/market pushes them).
if (local && (await basket.prices())[idx('CHOG')] === 0n)
  await (await (await asCurator()).setPrices([idx('CHOG')], [2_000_000_000_000_000n])).wait() // $0.002
// the example mix: BTC 70%, a memecoin 20%, stable 10% (no cap: the app shows the risk instead)
const mix = assets.map((a) => (a.symbol === 'BTC' ? 7000 : a.symbol === 'CHOG' ? 2000 : a.symbol === 'USDC' ? 1000 : 0))
await (await new Contract(vaults[3], BASKET_ABI, recipient).setWeights(recipient.address, 1, mix)).wait()
assert.deepEqual([...(await basket.weightsOf(recipient.address, 1))].map(Number), mix)
await pay(recipient.address, 50_000_000n) // 10 AUSD saved: 6 to pocket 0, 4 to the basket
pockets = await reader.pocketsOf(recipient.address)
assert.ok(pockets[0].value >= 5_999_999n && pockets[0].value <= 6_000_000n, `pocket 0 ${pockets[0].value}`)
let invested: bigint = pockets[1].value
assert.ok(invested >= 3_999_990n && invested <= 4_000_000n, `basket ${invested}`)
const units: bigint[] = await basket.unitsOf(recipient.address, 1)
assert.ok(units[idx('BTC')] > 0n && units[idx('CHOG')] > 0n && units[idx('ETH')] === 0n, 'units follow the mix')

// 6. New Smart Money weights move followers, never a custom mix (anvil only: impersonates the curator).
if (local) {
  const curatorBasket = await asCurator()
  const smart = [...(await basket.smartWeights())].map(Number)
  const flipped = assets.map((a) => (a.symbol === 'USDC' ? 5000 : a.symbol === 'ETH' ? 5000 : 0))
  await (await curatorBasket.setSmartWeights(flipped)).wait()
  await (await new Contract(vaults[3], BASKET_ABI, payer).sync(recipient.address, 1)).wait()
  assert.deepEqual([...(await basket.weightsOf(recipient.address, 1))].map(Number), mix) // custom stays custom
  const after: bigint = (await reader.pocketsOf(recipient.address))[1].value
  assert.ok(after >= invested - 2n, `value moved: ${invested} -> ${after}`)
  invested = after
  await (await curatorBasket.setSmartWeights(smart)).wait()
}

// "Withdraw everything" sells the whole basket, so a price move after reading the balance can't revert it.
const beforeAll: bigint = await ausd.balanceOf(recipient.address)
await (await asRecipient.withdrawAllPocket(recipient.address, 1)).wait()
const got = (await ausd.balanceOf(recipient.address)) - beforeAll
assert.ok(got >= invested - 2n && got <= invested + 2n, `withdrew ${got} of ${invested}`)
assert.equal(await basket.getFunction('valueOf')(recipient.address, 1), 0n) // `valueOf` clashes with Object's

// 7. Closing a pocket hands its share back; the slot is freed.
await (await asRecipient.closePocket(recipient.address, 1, 0)).wait()
pockets = await reader.pocketsOf(recipient.address)
assert.equal(pockets[1].open, false)
assert.equal(pockets[0].shareBps, 10_000n)
console.log('invest ok: withdrew', got, 'AUSD units from a BTC/meme/stable pocket')
console.log('fork e2e ok')
