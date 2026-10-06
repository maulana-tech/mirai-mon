import { useState } from 'react'
import { TokenIcon } from '@/components/brand/token-icon'
import { cn } from '@/lib/utils'

// Coin logos from Cryptofonts/cryptoicons (GPL-3.0, public/coins/); stock logos built from
// Simple Icons (CC0, public/stocks/). Falls back to a ticker badge when there's no file.

// Wrapped / bridged tickers (as Nansen reports them on Monad) share their underlying coin's logo.
const ALIAS: Record<string, string> = {
  WMON: 'mon',
  WBTC: 'btc',
  CBBTC: 'btc',
  LBTC: 'btc',
  'BTC.B': 'btc',
  WETH: 'eth',
  WSTETH: 'eth',
  WEETH: 'eth',
  'USDC.E': 'usdc',
  'USDT0': 'usdt',
}
export function CoinIcon({
  symbol,
  size = 32,
  kind = 'coin',
  className,
}: {
  symbol: string
  size?: number
  kind?: 'coin' | 'stock'
  className?: string
}) {
  const [missing, setMissing] = useState(false)
  if (symbol === 'AUSD') return <TokenIcon token="ausd" size={size} className={className} />
  if (missing)
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary-ink ring-1 ring-primary/20',
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(7, size * (size < 24 ? 0.55 : 0.3)) }}
        aria-hidden="true"
      >
        {size < 24 ? symbol[0] : symbol.slice(0, 4)}
      </span>
    )
  return (
    <img
      src={`/${kind === 'stock' ? 'stocks' : 'coins'}/${ALIAS[symbol.toUpperCase()] ?? symbol.toLowerCase()}.svg`}
      alt=""
      width={size}
      height={size}
      onError={() => setMissing(true)}
      className={cn('shrink-0 rounded-full', className)}
    />
  )
}
