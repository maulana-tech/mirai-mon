// Vercel function for the invest strategy (BasketVault). One GET does three jobs:
//   1. Pushes fresh prices for the coins Chainlink doesn't cover (MON, Monad memecoins) from DexScreener.
//   2. Once a day, reads Nansen smart money on Monad (holdings + last-24h DEX trades) and turns it into
//      the "Follow Smart Money" weights, re-weighting followers on-chain when they drift.
//   3. Returns the holdings, today's biggest buys and how each weight was decided, for the UI.
// Nansen's `smart-money/netflow` returns nothing for Monad yet, so net flow is computed here from
// `smart-money/dex-trades`: USD bought minus USD sold, per token.
// Server-only env: NANSEN_API_KEY, DRIP_PRIVATE_KEY (the basket's curator).
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Contract, JsonRpcProvider, Network, Wallet, parseUnits } from 'ethers'

const RPC_URL = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'
const BASKET_VAULT = process.env.BASKET_VAULT_ADDRESS ?? '0x4D7470dd92E1b58e48ccD4902B596A810F9189f6'
const NANSEN = 'https://api.nansen.ai/api/v1'

export type AssetKind = 'stable' | 'blue' | 'meme'

/**
 * Basket assets in BasketVault order (script/DeployMirai.s.sol, web/src/lib/basket.ts). `aliases` are
 * the Monad token symbols Nansen reports for each; `priceAddress` is the Monad mainnet token the
 * curator price comes from (assets without it are priced by Chainlink on-chain).
 */
export const ASSETS: { symbol: string; kind: AssetKind; aliases: string[]; priceAddress?: string }[] = [
  { symbol: 'USDC', kind: 'stable', aliases: ['USDC', 'USDT', 'AUSD', 'USDC.E', 'USDT0'] },
  { symbol: 'BTC', kind: 'blue', aliases: ['BTC', 'WBTC', 'CBBTC', 'BTC.B', 'LBTC'] },
  { symbol: 'ETH', kind: 'blue', aliases: ['ETH', 'WETH', 'WSTETH', 'WEETH'] },
  { symbol: 'LINK', kind: 'blue', aliases: ['LINK'] },
  { symbol: 'MON', kind: 'blue', aliases: ['MON', 'WMON'], priceAddress: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a' },
  { symbol: 'CHOG', kind: 'meme', aliases: ['CHOG'], priceAddress: '0x350035555e10d9afaf1566aaebfced5ba6c27777' },
  { symbol: 'NADS', kind: 'meme', aliases: ['NADS'], priceAddress: '0x39b9e06f226ff6d7500c870b82333aacbd2f7777' },
  { symbol: 'MONCAT', kind: 'meme', aliases: ['MONCAT'], priceAddress: '0x0158abff6d8344b35b5afffe7dbefc431b731a70' },
  { symbol: 'EMO', kind: 'meme', aliases: ['EMO'], priceAddress: '0x81a224f8a62f52bde942dbf23a56df77a10b7777' },
]

const BPS = 10_000
// "Follow Smart Money" is the default for people who won't tune a mix, so it keeps guard rails a
// custom mix doesn't have: some stable, no single coin above half, memecoins capped.
const STABLE_MIN_BPS = 1_000
const SINGLE_MAX_BPS = 5_000
const MEME_EACH_MAX_BPS = 1_000
const MEME_TOTAL_MAX_BPS = 2_000
const NANSEN_TTL_MS = 24 * 3600_000 // free plan: 10 credits a day = one holdings + one dex-trades call
const PRICE_MAX_AGE_S = 15 * 60
const REWEIGHT_MIN_DRIFT_BPS = 300

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
  /** Smart-money net DEX buying (+) or selling (−) over the last 24 hours, USD. */
  flow24hUsd?: number
}
/** A token smart money bought or sold on DEXes in the last 24 hours (net, USD). */
export type Flow = { symbol: string; address: string; logo?: string; flow24hUsd: number; trades: number }
/** How one basket asset's Smart Money weight was decided. */
export type AssetSignal = { symbol: string; kind: AssetKind; heldUsd: number; flow24hUsd: number; bps: number }
export type MarketInfo = {
  weights: { symbol: string; bps: number }[]
  /** Per basket asset: what smart money holds, bought, and the weight that came out. */
  signals: AssetSignal[]
  /** Top smart-money holdings on Monad (any token), newest Nansen snapshot. */
  holdings: Holding[]
  /** Tokens smart money net-bought most over the last 24 hours. */
  movers: Flow[]
  source: 'nansen' | 'default'
  fetchedAt: number
}

type NansenRow = {
  token_address: string
  token_symbol: string
  value_usd: number
  balance_24h_percent_change: number
  holders_count: number
  share_of_holdings_percent: number
}
type NansenTradeRow = {
  token_bought_address: string
  token_bought_symbol: string
  token_sold_address: string
  token_sold_symbol: string
  trade_value_usd: number
}

// The free Nansen plan allows one snapshot a day, so the snapshot outlives the process: kept in memory
// and in a temp file, so dev reloads and warm restarts don't spend credits again.
// ponytail: the temp file is per machine/instance; use Vercel Runtime Cache or Blob if cold starts in
// production keep re-fetching.
const CACHE_FILE = join(tmpdir(), 'mirai-market-snapshot.json')
let cache: MarketInfo | null = (() => {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as MarketInfo
  } catch {
    return null
  }
})()
const saveCache = (info: MarketInfo) => {
  cache = info
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(info))
  } catch {
    // read-only filesystem: memory only
  }
}

const matches = (asset: (typeof ASSETS)[number], symbol: string) => asset.aliases.includes(symbol.toUpperCase())

/** Smart-money USD held and 24h net bought per basket asset. */
export function signalsFrom(
  holdings: Pick<Holding, 'symbol' | 'valueUsd'>[],
  flows: Pick<Flow, 'symbol' | 'flow24hUsd'>[],
): Omit<AssetSignal, 'bps'>[] {
  return ASSETS.map((a) => ({
    symbol: a.symbol,
    kind: a.kind,
    heldUsd: holdings.filter((h) => matches(a, h.symbol)).reduce((s, h) => s + h.valueUsd, 0),
    flow24hUsd: flows.filter((f) => matches(a, f.symbol)).reduce((s, f) => s + f.flow24hUsd, 0),
  }))
}

/**
 * "Follow Smart Money" weights in bps, one per asset: conviction (USD held + 24h net buying, never
 * below zero; stablecoins carry none) shares out 90%, clipped per coin (50%, memecoins 10% each and
 * 20% together); whatever the caps cut goes to the stablecoin, which also keeps at least 10%.
 * No signal at all falls back to a plain BTC/ETH mix.
 */
export function smartWeights(signals: Pick<AssetSignal, 'kind' | 'heldUsd' | 'flow24hUsd'>[]): number[] {
  const conviction = signals.map((s) => (s.kind === 'stable' ? 0 : Math.max(0, s.heldUsd + s.flow24hUsd)))
  const stable = signals.findIndex((s) => s.kind === 'stable')
  const w = signals.map(() => 0)
  if (conviction.every((c) => c === 0)) {
    const btc = ASSETS.findIndex((a) => a.symbol === 'BTC')
    const eth = ASSETS.findIndex((a) => a.symbol === 'ETH')
    ;[w[stable], w[btc], w[eth]] = [STABLE_MIN_BPS, 4_000, 5_000]
    return w
  }
  const isMeme = (i: number) => signals[i].kind === 'meme'
  // One pass: share 90% by conviction and clip at the caps. What the caps cut goes to the stablecoin,
  // not to coins smart money barely holds.
  const total = conviction.reduce((a, b) => a + b, 0)
  conviction.forEach((c, i) => {
    w[i] = Math.min(((BPS - STABLE_MIN_BPS) * c) / total, isMeme(i) ? MEME_EACH_MAX_BPS : SINGLE_MAX_BPS)
  })
  const memeTotal = w.reduce((s, x, i) => (isMeme(i) ? s + x : s), 0)
  if (memeTotal > MEME_TOTAL_MAX_BPS) w.forEach((x, i) => isMeme(i) && (w[i] = (x * MEME_TOTAL_MAX_BPS) / memeTotal))
  const ints = w.map((x) => Math.floor(x))
  ints[stable] = BPS - ints.reduce((s, x, i) => (i === stable ? s : s + x), 0)
  return ints
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

async function nansen<T>(key: string, path: string, body: unknown): Promise<T[]> {
  const res = await fetch(`${NANSEN}/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`nansen ${path} ${res.status}`)
  console.info(`nansen ${path} credits`, res.headers.get('x-nansen-credits-used'))
  return ((await res.json()) as { data: T[] }).data
}

async function fetchHoldings(key: string): Promise<Holding[]> {
  const rows = await nansen<NansenRow>(key, 'smart-money/holdings', {
    chains: ['monad'],
    filters: { include_stablecoins: false, include_native_tokens: true },
    order_by: [{ field: 'value_usd', direction: 'DESC' }],
    pagination: { page: 1, per_page: 25 },
  })
  return rows.map((r) => ({
    symbol: r.token_symbol,
    address: String(r.token_address ?? '').toLowerCase(),
    valueUsd: Number(r.value_usd) || 0,
    change24hPct: Number(r.balance_24h_percent_change) || 0,
    holders: Number(r.holders_count) || 0,
    sharePct: Number(r.share_of_holdings_percent) || 0,
  }))
}

async function fetchFlows(key: string): Promise<Flow[]> {
  const rows = await nansen<NansenTradeRow>(key, 'smart-money/dex-trades', {
    chains: ['monad'],
    order_by: [{ field: 'trade_value_usd', direction: 'DESC' }],
    pagination: { page: 1, per_page: 1000 },
  })
  return flowsFromTrades(rows)
}

type DexPair = {
  baseToken: { address: string }
  priceUsd?: string
  liquidity?: { usd?: number }
  info?: { imageUrl?: string }
}

/** DexScreener pairs for up to 30 Monad tokens, grouped by base token (lowercase address). */
async function dexPairs(addresses: string[]): Promise<Map<string, DexPair[]>> {
  const out = new Map<string, DexPair[]>()
  const list = [...new Set(addresses.filter((a) => /^0x[0-9a-f]{40}$/.test(a)))].slice(0, 30)
  if (list.length === 0) return out
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/monad/${list.join(',')}`).catch(() => null)
  if (!res?.ok) return out
  for (const p of (await res.json()) as DexPair[]) {
    const key = p.baseToken.address.toLowerCase()
    out.set(key, [...(out.get(key) ?? []), p])
  }
  return out
}

/** Token logos by address (icon-sized), for tokens Cryptofonts doesn't cover. */
async function fetchLogos(addresses: string[]): Promise<Map<string, string>> {
  const logos = new Map<string, string>()
  for (const [address, pairs] of await dexPairs(addresses)) {
    const url = pairs.find((p) => p.info?.imageUrl)?.info?.imageUrl
    // the CDN resizes on the fly: ask for an icon-sized image instead of the 800px default
    if (url) logos.set(address, url.replace(/width=\d+&height=\d+/, 'width=64&height=64'))
  }
  return logos
}

function curatorBasket(): Contract | null {
  const key = process.env.DRIP_PRIVATE_KEY
  if (!key || /^0x0+$/.test(BASKET_VAULT)) return null
  const provider = new JsonRpcProvider(RPC_URL, Network.from(10143), { staticNetwork: true })
  return new Contract(
    BASKET_VAULT,
    [
      'function pricesUpdatedAt() view returns (uint64)',
      'function prices() view returns (uint256[])',
      'function smartWeights() view returns (uint16[])',
      'function setPrices(uint256[] ids, uint256[] newPrices)',
      'function setSmartWeights(uint16[] weights)',
    ],
    new Wallet(key, provider),
  )
}

/** Pushes DexScreener prices (deepest pool per token) for curator-priced coins when they are stale. */
async function refreshPrices(basket: Contract) {
  const [updatedAt, current] = (await Promise.all([basket.pricesUpdatedAt(), basket.prices()])) as [bigint, bigint[]]
  const missing = ASSETS.some((a, i) => a.priceAddress && current[i] === 0n)
  if (!missing && Number(updatedAt) > Date.now() / 1000 - PRICE_MAX_AGE_S) return
  const priced = ASSETS.flatMap((a, id) => (a.priceAddress ? [{ id, address: a.priceAddress }] : []))
  const pairs = await dexPairs(priced.map((p) => p.address))
  const ids: number[] = []
  const prices: bigint[] = []
  for (const { id, address } of priced) {
    const best = (pairs.get(address) ?? [])
      .filter((p) => p.priceUsd && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
    if (!best) continue
    ids.push(id)
    prices.push(parseUnits(Number(best.priceUsd).toFixed(18), 18))
  }
  if (ids.length > 0) await (await basket.setPrices(ids, prices)).wait()
}

/** Re-weights Smart Money followers when the new weights drifted from the on-chain ones. */
async function maybeReweight(basket: Contract, target: number[]) {
  const onChain = ((await basket.smartWeights()) as bigint[]).map(Number)
  const drift = Math.max(...target.map((t, i) => Math.abs(t - (onChain[i] ?? 0))))
  if (drift >= REWEIGHT_MIN_DRIFT_BPS) await (await basket.setSmartWeights(target)).wait()
}

// ponytail: shares the drip wallet's nonce with /api/onboard; a collision fails this update and the next
// request retries it. No per-IP limit: price pushes are capped by PRICE_MAX_AGE_S, Nansen by the TTL.
export async function GET(): Promise<Response> {
  const basket = curatorBasket()
  if (basket) await refreshPrices(basket).catch((e) => console.error('price refresh failed', e))

  if (!cache || Date.now() - cache.fetchedAt > NANSEN_TTL_MS) {
    const key = process.env.NANSEN_API_KEY
    const [holdings, flows] = key
      ? await Promise.all([
          fetchHoldings(key).catch((e) => (console.error('nansen holdings failed', e), null)),
          fetchFlows(key).catch((e) => (console.error('nansen dex-trades failed', e), [] as Flow[])),
        ])
      : [null, [] as Flow[]]
    if (!holdings) {
      // No Nansen (no key, out of credits, down): keep serving the last snapshot and the on-chain
      // weights as they are; retry Nansen on the next request.
      if (cache) return Response.json(cache)
      const info: MarketInfo = {
        weights: [],
        signals: [],
        holdings: [],
        movers: [],
        source: 'default',
        fetchedAt: Date.now(),
      }
      return Response.json(info)
    }
    const raw = signalsFrom(holdings, flows)
    const w = smartWeights(raw)
    const flowOf = new Map(flows.map((f) => [f.address, f.flow24hUsd]))
    const top = holdings.slice(0, 8).map((h) => ({ ...h, flow24hUsd: flowOf.get(h.address) }))
    // stablecoins are what smart money pays with, not a signal
    const movers = flows.filter((f) => f.flow24hUsd >= 1 && !/^(USD|AUSD|DAI)/i.test(f.symbol)).slice(0, 3)
    const logos = await fetchLogos([...top, ...movers].map((t) => t.address)).catch(() => new Map<string, string>())
    saveCache({
      weights: ASSETS.map((a, i) => ({ symbol: a.symbol, bps: w[i] })),
      signals: raw.map((s, i) => ({ ...s, bps: w[i] })),
      holdings: top.map((h) => ({ ...h, logo: logos.get(h.address) })),
      movers: movers.map((m) => ({ ...m, logo: logos.get(m.address) })),
      source: 'nansen',
      fetchedAt: Date.now(),
    })
  }
  // Every request (not only fresh Nansen snapshots) keeps the on-chain weights in line, so a new basket
  // or a failed earlier update heals itself without spending Nansen credits.
  const info = cache as MarketInfo | null
  if (basket && info?.source === 'nansen') {
    const target = info.weights.map((x) => x.bps)
    await maybeReweight(basket, target).catch((e) => console.error('smart weights update failed', e))
  }
  return Response.json(info, { headers: { 'cache-control': 's-maxage=3600, stale-while-revalidate=86400' } })
}
