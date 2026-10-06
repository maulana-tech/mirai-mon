import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightIcon } from 'lucide-react'
import { CoinIcon } from '@/components/brand/coin-icon'
import { MarketBoard } from '@/components/market-board'
import { PageHeader } from '@/components/page-header'
import { SmartMoneyCard } from '@/components/smart-money-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AUSD_SCALE } from '@/lib/ausd'
import { useAppState } from '@/lib/app-state'
import { intlLocale, useT, type MessageKey } from '@/lib/i18n'
import { useMarket } from '@/lib/market'
import { fetchHistory, useMarketBoard } from '@/lib/market-data'
import {
  POOL_ASSETS,
  backtest,
  normalizeWeights,
  projectRange,
  type AssetCategory,
  type History,
  type PoolSymbol,
  type Weights,
} from '@/lib/pool'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

const PRESETS: { label: MessageKey; weights: Weights }[] = [
  { label: 'pool.presetCrypto', weights: { BTC: 40, ETH: 30, SOL: 10, AUSD: 20 } },
  { label: 'pool.presetStocks', weights: { BTC: 25, SPY: 25, NVDA: 15, ETH: 15, PAXG: 10, AUSD: 10 } },
  { label: 'pool.presetCautious', weights: { BTC: 15, ETH: 10, PAXG: 15, AUSD: 60 } },
]
// Builder tabs; gold and the stablecoin share the "safer" tab.
const TABS: { key: 'crypto' | 'stock' | 'safe'; label: MessageKey; categories: AssetCategory[] }[] = [
  { key: 'crypto', label: 'pool.tabCrypto', categories: ['crypto'] },
  { key: 'stock', label: 'pool.tabStocks', categories: ['etf', 'stock'] },
  { key: 'safe', label: 'pool.tabSafe', categories: ['gold', 'stable'] },
]
const CATEGORY_COLOR: Record<AssetCategory, string> = {
  crypto: 'bg-primary',
  stock: 'bg-gold',
  etf: 'bg-gold/60',
  gold: 'bg-gold-ink',
  stable: 'bg-muted-foreground/40',
}
const categoryOf = (s: string) => POOL_ASSETS.find((a) => a.symbol === s)?.category ?? 'stable'
const iconKind = (s: string) => (['stock', 'etf'].includes(categoryOf(s)) ? 'stock' : 'coin')

// Backtest chart with a hover/touch tooltip: date, pool value for the simulated amount, change.
// The last point is today's daily close, so point i is (n-1-i) days ago.
function Chart({ values, amount, locale }: { values: number[]; amount: number; locale: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (values.length < 2) return null
  const n = values.length
  const min = Math.min(...values, 1)
  const span = Math.max(...values, 1) - min || 1
  const y = (v: number) => 38 - ((v - min) / span) * 36
  const x = (i: number) => (i / (n - 1)) * 100
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const up = values[n - 1] >= 1

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)))
  }
  const fmt = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 })
  const tip =
    hover === null
      ? null
      : {
          date: new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short' }).format(
            Date.now() - (n - 1 - hover) * 86_400_000,
          ),
          value: `${fmt.format(amount * values[hover])} AUSD`,
          change: (values[hover] - 1) * 100,
        }

  return (
    <div
      className="relative touch-none select-none"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-32 w-full" aria-hidden="true">
        <line
          x1="0"
          y1={y(1)}
          x2="100"
          y2={y(1)}
          strokeDasharray="3 3"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="stroke-muted-foreground/40"
        />
        <polyline
          points={points}
          fill="none"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className={up ? 'stroke-primary' : 'stroke-destructive'}
        />
        {hover !== null && (
          <line
            x1={x(hover)}
            y1="0"
            x2={x(hover)}
            y2="40"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="stroke-foreground/30"
          />
        )}
      </svg>
      {hover !== null && tip && (
        <>
          <span
            className={cn(
              'pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card',
              up ? 'bg-primary' : 'bg-destructive',
            )}
            style={{ left: `${x(hover)}%`, top: `${(y(values[hover]) / 40) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border bg-card px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
            // beside the guide line, flipping to the left near the right edge
            style={{
              left: `${x(hover)}%`,
              transform: x(hover) > 60 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <p className="text-muted-foreground">{tip.date}</p>
            <p className="font-semibold tabular-nums">{tip.value}</p>
            <p className={cn('tabular-nums', tip.change >= 0 ? 'text-primary-ink' : 'text-destructive')}>
              {tip.change >= 0 ? '+' : ''}
              {fmt.format(tip.change)}%
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          tone === 'up' && 'text-primary-ink',
          tone === 'down' && 'text-destructive',
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function MarketPage() {
  const t = useT()
  const { locale } = useSettings()
  const { account } = useAppState()
  const board = useMarketBoard()
  const { info } = useMarket()
  const [picked, setWeights] = useState<Weights | null>(null)
  const [amount, setAmount] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('crypto')
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<History | null>(null)
  const [historyError, setHistoryError] = useState(false)

  useEffect(() => {
    const pairs = POOL_ASSETS.flatMap((a) => (a.pair ? [a.pair] : []))
    fetchHistory(pairs, 90)
      .then((raw) => {
        if (!Object.keys(raw).length) return setHistoryError(true)
        setHistory(
          Object.fromEntries(POOL_ASSETS.filter((a) => a.pair && raw[a.pair]).map((a) => [a.symbol, raw[a.pair!]])),
        )
      })
      .catch(() => setHistoryError(true))
  }, [])

  const weights = picked ?? PRESETS[0].weights
  // Simulate the saver's own savings by default, until they type an amount.
  const savingsUnits = account && account.savings > 0n ? Number(account.savings) / Number(AUSD_SCALE) : 100
  const amountText = amount ?? String(Math.round(savingsUnits * 100) / 100)

  const { weights: clean, valid } = normalizeWeights(weights)
  const total = Object.values(clean).reduce((a, b) => a + (b ?? 0), 0)
  const stats = history && valid ? backtest(clean, history) : null // 90 points: cheap enough per render
  const money = Number(amountText.replace(',', '.')) || 0
  const ranges = stats ? projectRange(money, stats.volatility) : []
  const nf = (x: number, d: number) => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: d }).format(x)
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${nf(x, 1)}%`
  const ausd = (x: number) => `${nf(x, 2)} AUSD`

  const change90 = (s: PoolSymbol) => {
    const c = history?.[s]
    return c && c.length > 1 ? (c[c.length - 1] / c[0] - 1) * 100 : null
  }
  const held = Object.entries(clean) as [PoolSymbol, number][]
  const q = query.trim().toLowerCase()
  const tabAssets = POOL_ASSETS.filter(
    (a) =>
      TABS.find((x) => x.key === tab)!.categories.includes(a.category) &&
      (!q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)),
  )
  const setWeight = (s: PoolSymbol, v: number) =>
    setWeights({ ...weights, [s]: Math.max(0, Math.min(100, Math.round(v))) })

  return (
    <section className="space-y-5">
      <PageHeader title={t('nav.market')} caption={t('page.marketCaption')} />
      <MarketBoard {...board} onRefresh={() => void board.refresh()} />

      <SmartMoneyCard info={info} />
      <Link
        to="/app/pockets"
        className="flex items-center justify-between gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/50"
      >
        <span>
          <span className="block font-semibold">{t('pockets.investCta')}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{t('pockets.investCtaCaption')}</span>
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Builder */}
        <Card className="rounded-2xl shadow-none">
          <CardHeader>
            <CardTitle>{t('pool.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('pool.caption')}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setWeights(p.weights)}
                >
                  {t(p.label)}
                </Button>
              ))}
            </div>
            {/* Composition across all tabs */}
            <div className="space-y-2">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                {held.map(([sym, w]) => (
                  <div
                    key={sym}
                    className={cn('h-full border-r border-card last:border-r-0', CATEGORY_COLOR[categoryOf(sym)])}
                    style={{ width: `${Math.min(w, 100)}%` }}
                    title={`${sym} ${w}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {held.map(([sym, w]) => (
                  <span
                    key={sym}
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums"
                  >
                    <CoinIcon symbol={sym} size={14} kind={iconKind(sym)} />
                    {sym} {w}%
                  </span>
                ))}
              </div>
            </div>

            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as typeof tab)
                setQuery('')
              }}
            >
              <TabsList className="rounded-full">
                {TABS.map((x) => (
                  <TabsTrigger key={x.key} value={x.key} className="rounded-full px-4">
                    {t(x.label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {tab === 'stock' && (
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pool.searchStocks')}
                aria-label={t('pool.searchStocks')}
              />
            )}
            <div className={cn('space-y-3', tab === 'stock' && 'max-h-[26rem] overflow-y-auto pr-1')}>
              {tabAssets.map((a) => {
                const c90 = change90(a.symbol)
                return (
                  <div key={a.symbol} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3">
                    <span className="flex items-center gap-2.5 text-sm">
                      <CoinIcon symbol={a.symbol} size={28} kind={iconKind(a.symbol)} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 font-medium">
                          {a.symbol}
                          {a.category === 'etf' && (
                            <span className="rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
                              ETF
                            </span>
                          )}
                          {'onchain' in a && (
                            <span className="rounded bg-primary/10 px-1 text-[9px] font-semibold text-primary-ink">
                              {t('pool.onchain')}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {a.category === 'stable' ? t('pool.stable') : a.name}
                          {c90 !== null && (
                            <span
                              className={cn('ml-1 tabular-nums', c90 >= 0 ? 'text-primary-ink' : 'text-destructive')}
                            >
                              {pct(c90)}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <Slider
                      value={[weights[a.symbol] ?? 0]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={(v) => setWeight(a.symbol, v[0])}
                      aria-label={a.symbol}
                    />
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        value={String(weights[a.symbol] ?? 0)}
                        onChange={(e) => setWeight(a.symbol, Number(e.target.value.replace(/\D/g, '')) || 0)}
                        className="pr-6 text-right tabular-nums"
                        aria-label={`${a.symbol} %`}
                      />
                      <span className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                )
              })}
              {tab === 'stock' && <p className="text-xs text-muted-foreground">{t('pool.stocksNote')}</p>}
            </div>
            <div className="flex items-center justify-between border-t pt-4 text-sm">
              <span className="text-muted-foreground">{t('pool.total')}</span>
              <span className={cn('font-semibold tabular-nums', !valid && 'text-destructive')}>
                {total}% {!valid && `· ${t('pool.mustBe100')}`}
              </span>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pool-amount" className="text-sm font-medium">
                {t('pool.amount')}
              </label>
              <div className="relative">
                <Input
                  id="pool-amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pr-16 tabular-nums"
                />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">AUSD</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        <Card className="rounded-2xl shadow-none">
          <CardHeader>
            <CardTitle>{t('pool.resultTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {historyError ? (
              <p className="text-sm text-muted-foreground">{t('pool.historyFailed')}</p>
            ) : !stats ? (
              valid ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <p className="text-sm text-muted-foreground">{t('pool.mustBe100')}</p>
              )
            ) : (
              <>
                <div>
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {t('pool.backtestLabel', { days: stats.days })}
                  </p>
                  <Chart values={stats.values} amount={money} locale={locale} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Stat
                    label={t('pool.return')}
                    value={pct(stats.totalReturn)}
                    tone={stats.totalReturn >= 0 ? 'up' : 'down'}
                  />
                  <Stat label={t('pool.volatility')} value={`${stats.volatility.toFixed(0)}%`} />
                  <Stat
                    label={t('pool.drawdown')}
                    value={pct(stats.maxDrawdown)}
                    tone={stats.maxDrawdown < -10 ? 'down' : undefined}
                  />
                </div>
                <div className="border-t pt-4">
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {t('pool.rangeLabel', { amount: ausd(money) })}
                  </p>
                  <div className="mt-2 grid grid-cols-[6rem_1fr_1fr_1fr] gap-x-3 gap-y-1.5 text-sm tabular-nums">
                    <span />
                    <span className="text-xs text-muted-foreground">{t('pool.low')}</span>
                    <span className="text-xs text-muted-foreground">{t('pool.mid')}</span>
                    <span className="text-xs text-muted-foreground">{t('pool.high')}</span>
                    {ranges.map((r) => (
                      <div key={r.months} className="contents">
                        <span className="text-muted-foreground">{t('pool.inMonths', { n: r.months })}</span>
                        <span>{ausd(r.low)}</span>
                        <span>{ausd(r.mid)}</span>
                        <span>{ausd(r.high)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{t('pool.rangeHint')}</p>
                </div>
              </>
            )}
            <p className="border-t pt-3 text-xs text-muted-foreground">{t('pool.disclaimer')}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
