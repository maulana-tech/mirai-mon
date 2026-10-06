// Vercel function for the Smart Money strategy (MarketVault): basket weights derived from Nansen
// smart-money holdings plus their last-24h DEX net buying on Monad, and both for the UI.
// Nansen's `smart-money/netflow` returns nothing for Monad yet, so net flow is computed here from
// `smart-money/dex-trades` (trailing 24h): USD bought minus USD sold, per token. Re-weights the vault on-chain when
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
const NANSEN_TTL_MS = 24 * 3600_000 // free plan: 10 credits a day = one holdings + one dex-trades call a day
const REBALANCE_MIN_DRIFT_BPS = 300

export type Holding = {
  symbol: string
  /** Token contract on Monad (lowercase). */
  address: string
  /** Logo from DexScreener for tokens Cryptofonts doesn't cover (Monad memecoins), when it has one. */
  logo?: string
  valueUsd: number
  change24hPct: number
  holders: number
  sharePct: number
  /** Smart-money net buying (+) or selling (−) on DEXes over the last 24 hours, USD. */
  flow24hUsd?: number
}
/** A token smart money bought or sold on DEXes in the last 24 hours (net, USD). */
export type Flow = { symbol: string; address: string; logo?: string; flow24hUsd: number; trades: number }
export type MarketInfo = {
  weights: { symbol: string; bps: number }[]
  /** Top smart-money holdings on Monad (any token), newest Nansen snapshot. */
  holdings: Holding[]
  /** Tokens smart money net-bought most over the last 24 hours. */
  movers: Flow[]
  source: 'nansen' | 'default'
  fetchedAt: number
}

type NansenTradeRow = {
  token_bought_address: string
  token_bought_symbol: string
  token_sold_address: string
  token_sold_symbol: string
  trade_value_usd: number
}

type NansenRow = {
  token_address: string
  token_symbol: string
  value_usd: number
  balance_24h_percent_change: number
  holders_count: number
  share_of_holdings_percent: number
}

// ponytail: per-instance memory cache (Fluid Compute reuses instances) plus the CDN cache header below.
// Move to Vercel Runtime Cache / KV if credit use climbs.
let cache: MarketInfo | null = null

/**
 * Splits 10,000 bps over the coins: FLOOR_BPS each, the rest by smart-money conviction = USD held plus
 * the last 24h net DEX buying (selling subtracts, never below zero). Holdings say where smart money
 * is; net flow says where it is heading.
 */
export function weightsFrom(holdings: Holding[], flows: Pick<Flow, 'symbol' | 'flow24hUsd'>[] = []): number[] {
  const sum = <T extends { symbol: string }>(rows: T[], c: (typeof COINS)[number], f: (r: T) => number) =>
    rows.filter((r) => (c.aliases as readonly string[]).includes(r.symbol.toUpperCase())).reduce((s, r) => s + f(r), 0)
  const value = COINS.map((c) => Math.max(0, sum(holdings, c, (h) => h.valueUsd) + sum(flows, c, (f) => f.flow24hUsd)))
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
    address: String(r.token_address ?? '').toLowerCase(),
    valueUsd: Number(r.value_usd) || 0,
    change24hPct: Number(r.balance_24h_percent_change) || 0,
    holders: Number(r.holders_count) || 0,
    sharePct: Number(r.share_of_holdings_percent) || 0,
  }))
}

/** Net DEX flow per token from smart money's trades in the last 24h, largest net buy first. */
export function flowsFromTrades(trades: NansenTradeRow[]): Flow[] {
  const byToken = new Map<string, Flow>()
  const add = (address: string, symbol: string, usd: number) => {
    const key = String(address ?? '').toLowerCase()
    const row = byToken.get(key) ?? { symbol, address: key, flow24hUsd: 0, trades: 0 }
    row.flow24hUsd += usd
    row.trades += 1
    byToken.set(key, row)
  }
  for (const t of trades) {
    const usd = Number(t.trade_value_usd) || 0
    add(t.token_bought_address, t.token_bought_symbol, usd)
    add(t.token_sold_address, t.token_sold_symbol, -usd)
  }
  return [...byToken.values()].sort((a, b) => b.flow24hUsd - a.flow24hUsd)
}

async function fetchFlows(key: string): Promise<Flow[]> {
  const res = await fetch(`${NANSEN}/smart-money/dex-trades`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      chains: ['monad'],
      order_by: [{ field: 'trade_value_usd', direction: 'DESC' }],
      pagination: { page: 1, per_page: 1000 },
    }),
  })
  if (!res.ok) throw new Error(`nansen dex-trades ${res.status}`)
  console.info('nansen dex-trades credits', res.headers.get('x-nansen-credits-used'))
  const { data } = (await res.json()) as { data: NansenTradeRow[] }
  return flowsFromTrades(data)
}

/** Token logos by address from DexScreener's public API (one call, up to 30 tokens); empty on failure. */
async function fetchLogos(addresses: string[]): Promise<Map<string, string>> {
  const logos = new Map<string, string>()
  const list = addresses.filter((a) => /^0x[0-9a-f]{40}$/.test(a)).slice(0, 30)
  if (list.length === 0) return logos
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/monad/${list.join(',')}`).catch(() => null)
  if (!res?.ok) return logos
  const pairs = (await res.json()) as { baseToken: { address: string }; info?: { imageUrl?: string } }[]
  for (const p of pairs) {
    const address = p.baseToken.address.toLowerCase()
    const url = p.info?.imageUrl
    // the CDN resizes on the fly: ask for an icon-sized image instead of the 800px default
    if (url && !logos.has(address)) logos.set(address, url.replace(/width=\d+&height=\d+/, 'width=64&height=64'))
  }
  return logos
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
    let flows: Flow[] = []
    if (key) {
      const [h, f] = await Promise.all([
        fetchHoldings(key).catch((e) => (console.error('nansen holdings failed', e), null)),
        fetchFlows(key).catch((e) => (console.error('nansen dex-trades failed', e), [] as Flow[])),
      ])
      holdings = h
      flows = f
    }
    if (!holdings) {
      // No Nansen: keep the on-chain basket as is and retry Nansen on the next request.
      if (cache) return Response.json(cache)
      return Response.json({
        weights: [],
        holdings: [],
        movers: [],
        source: 'default',
        fetchedAt: Date.now(),
      } satisfies MarketInfo)
    }
    const w = weightsFrom(holdings, flows)
    const flowOf = new Map(flows.map((f) => [f.address, f.flow24hUsd]))
    const top = holdings.slice(0, 8).map((h) => ({ ...h, flow24hUsd: flowOf.get(h.address) }))
    // stablecoins are what smart money pays with, not a signal
    const movers = flows.filter((f) => f.flow24hUsd >= 1 && !/^(USD|AUSD|DAI)/i.test(f.symbol)).slice(0, 3)
    const logos = await fetchLogos([...top, ...movers].map((t) => t.address)).catch(() => new Map<string, string>())
    cache = {
      weights: COINS.map((coin, i) => ({ symbol: coin.symbol, bps: w[i] })),
      holdings: top.map((h) => ({ ...h, logo: logos.get(h.address) })),
      movers: movers.map((m) => ({ ...m, logo: logos.get(m.address) })),
      source: 'nansen',
      fetchedAt: Date.now(),
    }
    await maybeRebalance(w).catch((e) => console.error('rebalance failed', e))
  }
  return Response.json(cache, { headers: { 'cache-control': 's-maxage=3600, stale-while-revalidate=86400' } })
}
