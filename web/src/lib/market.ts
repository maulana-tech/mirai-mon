import { useEffect, useState } from 'react'
import { mirai } from '@/lib/mirai'
import type { MarketBasket } from '@/lib/types'

/** `/api/market` (Nansen smart-money holdings on Monad). Mirrors `MarketInfo` in `api/market.ts`. */
export type Holding = { symbol: string; valueUsd: number; change24hPct: number; holders: number; sharePct: number }
export type MarketInfo = {
  weights: { symbol: string; bps: number }[]
  holdings: Holding[]
  source: 'nansen' | 'default'
  fetchedAt: number
}

async function fetchMarketInfo(): Promise<MarketInfo | null> {
  const res = await fetch('/api/market').catch(() => null)
  return res?.ok ? ((await res.json()) as MarketInfo) : null
}

/** On-chain basket plus the Nansen snapshot behind its weights. Either can be null while loading or offline. */
export function useMarket() {
  const [basket, setBasket] = useState<MarketBasket | null>(null)
  const [info, setInfo] = useState<MarketInfo | null>(null)

  useEffect(() => {
    let live = true
    // Nansen first: a fresh snapshot can re-weight the vault, so the basket read follows it.
    void fetchMarketInfo().then((i) => {
      if (live) setInfo(i)
      return mirai.getBasket().then(
        (b) => live && setBasket(b),
        () => {},
      )
    })
    return () => {
      live = false
    }
  }, [])

  return { basket, info }
}
