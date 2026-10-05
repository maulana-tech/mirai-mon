// MeraSigner must produce byte-identical signatures to ethers.Wallet for the same key.
// Run: node scripts/check-mera-signer.ts
import assert from 'node:assert/strict'
import { JsonRpcProvider, Network, Transaction, Wallet, getBytes, parseUnits } from 'ethers'
import { createSecp256k1SigningSession } from '@category-labs/mera'
import { MeraSigner } from '../src/lib/mera-signer.ts'

const key = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
const provider = new JsonRpcProvider('http://127.0.0.1:1', Network.from(10143), { staticNetwork: true })
const wallet = new Wallet(key)
const mera = new MeraSigner(createSecp256k1SigningSession({ privateKey: getBytes(key) }), provider)

assert.equal(mera.address, wallet.address)

const tx = {
  type: 2,
  chainId: 10143,
  nonce: 7,
  to: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
  data: '0xa9059cbb',
  value: 0n,
  gasLimit: 120_000n,
  maxFeePerGas: parseUnits('102', 'gwei'),
  maxPriorityFeePerGas: parseUnits('2', 'gwei'),
}
assert.equal(await mera.signTransaction({ ...tx, from: wallet.address }), await wallet.signTransaction(tx))
// AbstractSigner.sendTransaction hands signTransaction a Transaction instance, not a plain object.
assert.equal(await mera.signTransaction(Transaction.from(tx)), await wallet.signTransaction(tx))
assert.equal(await mera.signMessage('Mirai'), await wallet.signMessage('Mirai'))

const domain = { name: 'Agora Dollar', version: '1', chainId: 10143, verifyingContract: tx.to }
const types = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
const permit = { owner: wallet.address, spender: tx.to, value: 5_000_000n, nonce: 0n, deadline: 1n << 40n }
assert.equal(await mera.signTypedData(domain, types, permit), await wallet.signTypedData(domain, types, permit))

mera.end()
await assert.rejects(mera.signMessage('after end'), /session/i)
console.log('mera-signer ok')
