// Vercel function: gives a new passkey account enough MON for gas plus test AUSD, so a first-time
// user never sees a faucet. Server-only env: DRIP_PRIVATE_KEY (a funded Monad testnet key).
import {
  Contract,
  JsonRpcProvider,
  Network,
  Wallet,
  isAddress,
  parseEther,
  type TransactionResponse,
} from 'ethers'

const RPC_URL = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'
const AUSD = process.env.AUSD_ADDRESS ?? '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
// Agora's public AUSD faucet: 10,000 AUSD per call, but one call per 60s across all of testnet.
const AUSD_FAUCET = process.env.AUSD_FAUCET_ADDRESS ?? '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C'

// ~15 Mirai transactions at the base fee. Only topped up below MIN_MON, so repeat calls are no-ops.
const DRIP_MON = parseEther('0.5')
const MIN_MON = parseEther('0.1')
// Paid from the drip wallet's own AUSD reserve, so onboarding never waits on the faucet's 60s limit.
const DRIP_AUSD = 250_000_000n // 250 AUSD
const REFILL_BELOW = DRIP_AUSD * 10n

// ponytail: no per-IP rate limit; balance thresholds cap the cost per address. Add Vercel KV
// rate limiting if the drip wallet gets farmed. Concurrent requests can also race on the nonce.
export async function POST(request: Request): Promise<Response> {
  const key = process.env.DRIP_PRIVATE_KEY
  if (!key) return Response.json({ error: 'faucet_unavailable' }, { status: 503 })

  let address: unknown
  try {
    ;({ address } = (await request.json()) as { address?: unknown })
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (typeof address !== 'string' || !isAddress(address)) {
    return Response.json({ error: 'invalid_address' }, { status: 400 })
  }

  const provider = new JsonRpcProvider(RPC_URL, Network.from(10143), { staticNetwork: true })
  const drip = new Wallet(key, provider)
  const ausd = new Contract(
    AUSD,
    ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'],
    drip,
  )
  const faucet = new Contract(AUSD_FAUCET, ['function requestFunds(address to)'], drip)

  try {
    const [mon, ausdBalance, reserve] = await Promise.all([
      provider.getBalance(address),
      ausd.balanceOf(address) as Promise<bigint>,
      ausd.balanceOf(drip.address) as Promise<bigint>,
    ])

    let nonce = await provider.getTransactionCount(drip.address, 'pending')
    // Gas estimation runs before broadcast, so a reverting call never consumes a nonce.
    const send = async (fn: (nonce: number) => Promise<TransactionResponse>) => {
      const tx = await fn(nonce)
      nonce++
      return tx
    }

    const pending: TransactionResponse[] = []
    const sent = { mon: false, ausd: false }
    if (mon < MIN_MON) {
      pending.push(await send((n) => drip.sendTransaction({ to: address, value: DRIP_MON, nonce: n })))
      sent.mon = true
    }
    if (ausdBalance === 0n) {
      if (reserve < DRIP_AUSD) {
        // The reserve can't cover this user: refill and wait (fails while the faucet is throttled).
        await (await send((n) => faucet.requestFunds(drip.address, { nonce: n }))).wait()
      } else if (reserve < REFILL_BELOW) {
        // Best-effort top-up; skipped silently when another app used the faucet this minute.
        await send((n) => faucet.requestFunds(drip.address, { nonce: n })).then(
          (tx) => pending.push(tx),
          () => {},
        )
      }
      pending.push(await send((n) => ausd.transfer(address, DRIP_AUSD, { nonce: n })))
      sent.ausd = true
    }
    await Promise.all(pending.map((tx) => tx.wait()))
    return Response.json(sent)
  } catch (e) {
    console.error('onboard failed', e)
    const busy = String(e).includes('0x20e5bc67') // faucet MaxFrequencyExceeded
    return Response.json({ error: busy ? 'faucet_busy' : 'faucet_failed' }, { status: busy ? 429 : 502 })
  }
}
