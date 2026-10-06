import { TriangleAlertIcon } from 'lucide-react'
import { CoinIcon } from '@/components/brand/coin-icon'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { intlLocale, useT } from '@/lib/i18n'
import { useMarket } from '@/lib/market'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

const BAR = ['bg-primary', 'bg-cyan']

/** The Smart Money strategy: the on-chain BTC/ETH basket and the Nansen holdings that weight it. */
export function SmartMoneyCard({ active }: { active: boolean }) {
  const t = useT()
  const { locale } = useSettings()
  const { basket, info } = useMarket()
  const usd = (n: number, compact = false) =>
    new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency: 'USD',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 0,
    }).format(n)
  const pct = (n: number) =>
    new Intl.NumberFormat(intlLocale(locale), {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    }).format(n / 100)
  const nansen = info?.source === 'nansen'

  return (
    <Card className={cn('rounded-2xl shadow-none', active && 'border-primary')}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t('market.title')}</CardTitle>
          <Badge variant="outline" className="font-normal">
            {nansen ? t('market.poweredBy') : t('market.nansenOffline')}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('market.caption')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{t('market.basket')}</p>
          {basket ? (
            <>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                {basket.coins.map((c, i) => (
                  <div key={c.symbol} className={BAR[i % BAR.length]} style={{ width: `${c.weightBps / 100}%` }} />
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {basket.coins.map((c, i) => (
                  <div key={c.symbol} className="flex items-center justify-between rounded-xl border p-3 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <CoinIcon symbol={c.symbol} size={22} />
                      {c.symbol} · {c.weightBps / 100}%
                      <span className={cn('size-2 rounded-full', BAR[i % BAR.length])} aria-hidden="true" />
                    </span>
                    <span className="text-muted-foreground tabular-nums">{usd(c.priceUsd)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('market.priceSource')}</p>
            </>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </div>

        {nansen && info.holdings.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {t('market.holdingsTitle')}
            </p>
            <ul className="divide-y rounded-xl border text-sm">
              {info.holdings.map((h) => (
                <li key={h.symbol} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <CoinIcon symbol={h.symbol} size={20} />
                    <span className="truncate">{h.symbol}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums">
                    <span className="text-muted-foreground">
                      {h.holders === 1 ? t('market.holderOne') : t('market.holders', { n: h.holders })}
                    </span>
                    <span>{usd(h.valueUsd, true)}</span>
                    <span
                      className={cn(
                        'w-14 text-right text-xs',
                        Math.abs(h.change24hPct) < 0.05
                          ? 'text-muted-foreground'
                          : h.change24hPct < 0
                            ? 'text-destructive'
                            : 'text-primary-ink',
                      )}
                    >
                      {Math.abs(h.change24hPct) < 0.05 ? '–' : pct(h.change24hPct)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('market.holdingsCaption', {
                time: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(
                  info.fetchedAt,
                ),
              })}
            </p>
          </div>
        )}

        <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" />
          {t('market.risk')}
        </p>
      </CardContent>
    </Card>
  )
}
