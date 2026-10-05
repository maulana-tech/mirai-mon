import { useCallback, useEffect, useState } from 'react'
import { Contract } from 'ethers'
import { readProvider } from '@/lib/config'

// Spot prices from Chainlink push feeds on Monad testnet (BTC and ETH are the feeds MarketVault
// prices its basket with); trend and volatility from Binance daily candles via the public
// market-data mirror (CORS-open, not geo-blocked).
const COINS = [
  { symbol: 'BTC', name: 'Bitcoin', pair: 'BTCUSDT', feed: '0x12C0F44368a02081ce58a936d1C1F606BB301715' },
  { symbol: 'ETH', name: 'Ethereum', pair: 'ETHUSDT', feed: '0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31' },
  { symbol: 'LINK', name: 'Chainlink', pair: 'LINKUSDT', feed: '0x2A9FBFbf392594c4Dd7593C8a91cdEbc02e5b884' },
] as const

const CANDLES_URL = 'https://data-api.binance.vision/api/v3/klines'
const FEED_ABI = ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']

export type CoinMarket = {
  symbol: string
  name: string
  price: number // oracle price, or the latest candle close if the oracle read fails
  priceSource: 'chainlink' | 'binance'
  change24h: number // percent
  change7d: number
  change30d: number
  volatility30d: number // annualized, percent
  closes: number[] // last 31 daily closes, oldest first
}

export type MarketSnapshot = { at: Date; coins: CoinMarket[] }

const pct = (from: number, to: number) => (from ? ((to - from) / from) * 100 : 0)

/** Annualized volatility (percent) from daily closes, using log returns. */
function annualizedVolatility(closes: number[]): number {
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]))
  if (r.length < 2) return 0
  const mean = r.reduce((a, b) => a + b, 0) / r.length
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)
  return Math.sqrt(variance) * Math.sqrt(365) * 100
}

async function dailyCloses(pair: string, limit = 31): Promise<number[]> {
  const res = await fetch(`${CANDLES_URL}?symbol=${pair}&interval=1d&limit=${limit}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`candles ${pair}: ${res.status}`)
  const rows = (await res.json()) as [number, string, string, string, string][]
  return rows.map((row) => Number(row[4]))
}

async function oraclePrice(feed: string): Promise<number | null> {
  try {
    const [, answer] = (await new Contract(feed, FEED_ABI, readProvider).latestRoundData()) as bigint[]
    return Number(answer) / 1e8
  } catch {
    return null
  }
}

async function fetchMarket(): Promise<MarketSnapshot> {
  const coins = await Promise.all(
    COINS.map(async (c): Promise<CoinMarket> => {
      const [closes, oracle] = await Promise.all([dailyCloses(c.pair), oraclePrice(c.feed)])
      const last = closes[closes.length - 1] ?? 0
      const price = oracle ?? last
      const at = (daysAgo: number) => closes[Math.max(0, closes.length - 1 - daysAgo)] ?? last
      return {
        symbol: c.symbol,
        name: c.name,
        price,
        priceSource: oracle ? 'chainlink' : 'binance',
        change24h: pct(at(1), price),
        change7d: pct(at(7), price),
        change30d: pct(at(30), price),
        volatility30d: annualizedVolatility(closes),
        closes,
      }
    }),
  )
  return { at: new Date(), coins }
}

/** Daily closes (oldest first) for several Binance pairs; a pair that fails is skipped. */
export async function fetchHistory(pairs: string[], days = 90): Promise<Record<string, number[]>> {
  const rows = await Promise.allSettled(pairs.map(async (p) => [p, await dailyCloses(p, days + 1)] as const))
  return Object.fromEntries(rows.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))
}

export function useMarketBoard() {
  const [market, setMarket] = useState<MarketSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setMarket(await fetchMarket())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { market, loading, error, refresh }
}
