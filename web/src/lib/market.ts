import { useEffect, useState } from 'react'
import { mirai } from '@/lib/mirai'
import type { BasketState } from '@/lib/types'
import { useWallet } from '@/lib/wallet'

/** `/api/market` (Nansen smart-money holdings and 24h DEX flows on Monad). Mirrors `MarketInfo` in `api/market.ts`. */
export type Holding = {
  symbol: string
  address: string
  /** DexScreener logo, for tokens without a bundled icon. */
  logo?: string
  valueUsd: number
  change24hPct: number
  holders: number
  sharePct: number
  /** Smart-money net DEX buying (+) or selling (−) over the last 24 hours, USD. */
  flow24hUsd?: number
}
export type Flow = { symbol: string; address: string; logo?: string; flow24hUsd: number; trades: number }
/** How one basket asset's Smart Money weight was decided (mirrors `AssetSignal` in api/market.ts). */
export type AssetSignal = {
  symbol: string
  kind: 'stable' | 'blue' | 'meme'
  heldUsd: number
  flow24hUsd: number
  bps: number
}
export type MarketInfo = {
  weights: { symbol: string; bps: number }[]
  signals?: AssetSignal[]
  holdings: Holding[]
  /** Tokens smart money net-bought most over the last 24 hours (from Nansen DEX trades). */
  movers?: Flow[]
  source: 'nansen' | 'default'
  fetchedAt: number
}

/** Retries a read a few times: the public RPC rate-limits bursts like a page's first load. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 600 * 2 ** i))
    }
  }
}

async function fetchMarketInfo(): Promise<MarketInfo | null> {
  const res = await fetch('/api/market').catch(() => null)
  return res?.ok ? ((await res.json()) as MarketInfo) : null
}

/** One pocket's on-chain basket plus the Nansen snapshot behind Smart Money. Either can be null while loading. */
export function useMarket(pocket = 0) {
  const { address } = useWallet()
  const [basket, setBasket] = useState<BasketState | null>(null)
  const [info, setInfo] = useState<MarketInfo | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    // Nansen first: a fresh snapshot can re-weight Smart Money and push prices, so the basket read follows it.
    void fetchMarketInfo().then((i) => {
      if (live) setInfo(i)
      return withRetry(() => mirai.getBasket(address ?? undefined, pocket)).then(
        (b) => live && setBasket(b),
        () => {},
      )
    })
    return () => {
      live = false
    }
  }, [address, pocket, version])

  return { basket, info, reload: () => setVersion((v) => v + 1) }
}
