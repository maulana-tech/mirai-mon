// End-to-end on a local Monad testnet fork with real AUSD: onboarding drip, then a passkey-style
// (MeraSigner) payment through payWithPermit, then withdrawals, then the Smart Money strategy
// (market basket priced by the real Chainlink feeds; the curator rebalance runs on anvil only). Needs anvil + a deployed Mirai:
//   anvil --network monad --fork-url https://testnet-rpc.monad.xyz
//   (cd ../evm && forge script script/DeployMirai.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
//      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
//   MIRAI=0x... node scripts/check-fork.ts
// Against live testnet instead: RPC_URL=https://testnet-rpc.monad.xyz DRIP_PRIVATE_KEY=<funded key> MIRAI=0x...
import assert from 'node:assert/strict'
import { Contract, JsonRpcProvider, Network, Signature, Wallet, getBytes, toUtf8Bytes, toUtf8String } from 'ethers'
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
  'function accountOf(address) view returns ((uint16 splitBps,uint128 spend,uint128 shares,uint256 savings,uint64 lockUntil,uint8 strategy))',
  'function payWithPermit(address from,address to,uint256 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function withdrawSpend(address user,uint256 amount)',
  'function withdrawSavings(address user,uint256 amount)',
  'function setGoal(address user,bytes encrypted)',
  'function goalOf(address user) view returns (bytes)',
  'function setStrategy(address user,uint8 strategy)',
  'function withdrawAllSavings(address user) returns (uint256)',
  'function strategies() view returns (address[4] vaults,address[4] yieldSources)',
]
const MARKET_ABI = [
  'function basket() view returns (address[] feeds,uint16[] weights,uint256[] units,uint256[] prices)',
  'function basketValue() view returns (uint256)',
  'function curator() view returns (address)',
  'function rebalance(uint16[] weights)',
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

// 3. Recipient withdraws both pockets with its own MeraSigner.
const asRecipient = new Contract(MIRAI, MIRAI_ABI, recipient)
const before: bigint = await ausd.balanceOf(recipient.address)
await (await asRecipient.withdrawSpend(recipient.address, acc.spend)).wait()
await (await asRecipient.withdrawSavings(recipient.address, acc.savings)).wait()
assert.equal((await ausd.balanceOf(recipient.address)) - before, acc.spend + acc.savings)
// 4. An encrypted goal (opaque vault JSON) round-trips through the contract byte for byte.
const vault = JSON.stringify({ version: 1, prfSalt: 'c2FsdA', nonce: 'bm9uY2U', ciphertext: 'Y2lwaGVy' })
await (await asRecipient.setGoal(recipient.address, toUtf8Bytes(vault))).wait()
assert.equal(toUtf8String(await asRecipient.goalOf(recipient.address)), vault)

// 5. Smart Money: savings go into the BTC/ETH basket at live Chainlink prices, and come back out.
const reader = new Contract(MIRAI, MIRAI_ABI, provider)
const { vaults } = await reader.strategies()
const market = new Contract(vaults[3], MARKET_ABI, provider)
await (await asRecipient.setStrategy(recipient.address, 3)).wait()
const valueBefore: bigint = await market.basketValue()
await pay(recipient.address, 50_000_000n) // 10 AUSD saved into the basket
let inBasket = await reader.accountOf(recipient.address)
assert.equal(inBasket.strategy, 3n)
assert.ok(inBasket.savings >= 9_999_990n && inBasket.savings <= 10_000_000n, `basket savings ${inBasket.savings}`)
const added = (await market.basketValue()) - valueBefore
assert.ok(added >= 9_999_990n && added <= 10_000_000n, `basket value added ${added}`)

// 6. The curator re-weights at current prices without changing anyone's value (anvil only).
if (RPC.includes('127.0.0.1') || RPC.includes('localhost')) {
  const curator: string = await market.curator()
  await provider.send('anvil_impersonateAccount', [curator])
  await provider.send('anvil_setBalance', [curator, '0xde0b6b3a7640000'])
  const { weights } = await market.basket()
  const flipped = [...weights].reverse().map(Number)
  const asCurator = new Contract(vaults[3], MARKET_ABI, await provider.getSigner(curator))
  await (await asCurator.rebalance(flipped)).wait()
  assert.deepEqual([...(await market.basket()).weights].map(Number), flipped)
  const after = await reader.accountOf(recipient.address)
  assert.ok(after.savings >= inBasket.savings - 2n, `rebalance moved value: ${inBasket.savings} -> ${after.savings}`)
  inBasket = after
  await (await asCurator.rebalance([...weights].map(Number))).wait()
}

// "Withdraw everything" redeems every share, so a price move after reading the balance can't revert it.
const beforeAll: bigint = await ausd.balanceOf(recipient.address)
await (await asRecipient.withdrawAllSavings(recipient.address)).wait()
const got = (await ausd.balanceOf(recipient.address)) - beforeAll
assert.ok(got >= inBasket.savings - 2n && got <= inBasket.savings + 2n, `withdrew ${got} of ${inBasket.savings}`)
await (await asRecipient.setStrategy(recipient.address, 1)).wait()
const done = await reader.accountOf(recipient.address)
assert.equal(done.strategy, 1n)
assert.equal(done.shares, 0n)
console.log('smart money ok: withdrew', got, 'AUSD units from the basket')
console.log('fork e2e ok')
