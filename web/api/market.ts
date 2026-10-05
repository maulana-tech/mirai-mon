// Vercel function for the Smart Money strategy (MarketVault): basket weights derived from Nansen
// smart-money holdings on Monad, plus those holdings for the UI. Re-weights the vault on-chain when
// Nansen's picture has moved. Prices come from Chainlink push feeds, so nothing here touches prices.
// Server-only env: NANSEN_API_KEY, DRIP_PRIVATE_KEY (the vault's curator).
import { Contract, JsonRpcProvider, Network, Wallet } from 'ethers'

const RPC_URL = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'
const MARKET_VAULT = process.env.MARKET_VAULT_ADDRESS ?? '0x1024D899fe9Bf3B1588358eC36825aF74a844ec3'
const NANSEN = 'https://api.nansen.ai/api/v1'

/** Basket coins in vault order, with the Monad token symbols Nansen reports for each. */
const COINS = [
  { symbol: 'BTC', aliases: ['BTC', 'WBTC', 'CBBTC', 'BTC.B', 'LBTC'] },
  { symbol: 'ETH', aliases: ['ETH', 'WETH', 'WSTETH', 'WEETH'] },
] as const

const BPS = 10_000
const FLOOR_BPS = 2_000 // every coin keeps at least 20%: smart money sets the tilt, not an all-in bet
const NANSEN_TTL_MS = 24 * 3600_000 // free plan: 10 credits a day, so one holdings call a day
const REBALANCE_MIN_DRIFT_BPS = 300

export type Holding = { symbol: string; valueUsd: number; change24hPct: number; holders: number; sharePct: number }
export type MarketInfo = {
  weights: { symbol: string; bps: number }[]
  /** Top smart-money holdings on Monad (any token), newest Nansen snapshot. */
  holdings: Holding[]
  source: 'nansen' | 'default'
  fetchedAt: number
}

type NansenRow = {
  token_symbol: string
  value_usd: number
  balance_24h_percent_change: number
  holders_count: number
  share_of_holdings_percent: number
}

// ponytail: per-instance memory cache (Fluid Compute reuses instances) plus the CDN cache header below.
// Move to Vercel Runtime Cache / KV if credit use climbs.
let cache: MarketInfo | null = null

/** Splits 10,000 bps over the coins: FLOOR_BPS each, the rest by smart-money USD held. */
export function weightsFrom(holdings: Holding[]): number[] {
  const value = COINS.map((c) =>
    holdings
      .filter((h) => (c.aliases as readonly string[]).includes(h.symbol.toUpperCase()))
      .reduce((s, h) => s + h.valueUsd, 0),
  )
  const total = value.reduce((s, v) => s + v, 0)
  const free = BPS - FLOOR_BPS * COINS.length
  const w = value.map((v) => FLOOR_BPS + Math.floor(total > 0 ? (free * v) / total : free / COINS.length))
  w[0] += BPS - w.reduce((s, x) => s + x, 0) // rounding dust to the first coin
  return w
}

async function fetchHoldings(key: string): Promise<Holding[]> {
  const res = await fetch(`${NANSEN}/smart-money/holdings`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      chains: ['monad'],
      filters: { include_stablecoins: false, include_native_tokens: true },
      order_by: [{ field: 'value_usd', direction: 'DESC' }],
      pagination: { page: 1, per_page: 25 },
    }),
  })
  if (!res.ok) throw new Error(`nansen ${res.status}`)
  console.info('nansen holdings credits', res.headers.get('x-nansen-credits-used'))
  const { data } = (await res.json()) as { data: NansenRow[] }
  return data.map((r) => ({
    symbol: r.token_symbol,
    valueUsd: Number(r.value_usd) || 0,
    change24hPct: Number(r.balance_24h_percent_change) || 0,
    holders: Number(r.holders_count) || 0,
    sharePct: Number(r.share_of_holdings_percent) || 0,
  }))
}

/** Re-weights the vault when Nansen's weights drifted from the on-chain ones. */
async function maybeRebalance(target: number[]) {
  const key = process.env.DRIP_PRIVATE_KEY
  if (!key) return
  const provider = new JsonRpcProvider(RPC_URL, Network.from(10143), { staticNetwork: true })
  const vault = new Contract(
    MARKET_VAULT,
    [
      'function basket() view returns (address[] feeds,uint16[] weights,uint256[] units,uint256[] prices)',
      'function rebalance(uint16[] weights)',
    ],
    new Wallet(key, provider),
  )
  const { weights } = (await vault.basket()) as { weights: bigint[] }
  const drift = Math.max(...weights.map((w, i) => Math.abs(Number(w) - target[i])))
  if (drift >= REBALANCE_MIN_DRIFT_BPS) await (await vault.rebalance(target)).wait()
}

// ponytail: shares the drip wallet's nonce with /api/onboard; a collision fails this rebalance and the
// next fresh Nansen snapshot retries it.
export async function GET(): Promise<Response> {
  if (!cache || Date.now() - cache.fetchedAt > NANSEN_TTL_MS) {
    const key = process.env.NANSEN_API_KEY
    let holdings: Holding[] | null = null
    if (key) holdings = await fetchHoldings(key).catch((e) => (console.error('nansen holdings failed', e), null))
    if (!holdings) {
      // No Nansen: keep the on-chain basket as is and retry Nansen on the next request.
      if (cache) return Response.json(cache)
      return Response.json({ weights: [], holdings: [], source: 'default', fetchedAt: Date.now() } satisfies MarketInfo)
    }
    const w = weightsFrom(holdings)
    cache = {
      weights: COINS.map((coin, i) => ({ symbol: coin.symbol, bps: w[i] })),
      holdings: holdings.slice(0, 8),
      source: 'nansen',
      fetchedAt: Date.now(),
    }
    await maybeRebalance(w).catch((e) => console.error('rebalance failed', e))
  }
  return Response.json(cache, { headers: { 'cache-control': 's-maxage=3600, stale-while-revalidate=86400' } })
}
