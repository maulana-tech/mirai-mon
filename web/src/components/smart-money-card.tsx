import { ChevronDownIcon } from 'lucide-react'
import { CoinIcon } from '@/components/brand/coin-icon'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { intlLocale, useT } from '@/lib/i18n'
import type { MarketInfo } from '@/lib/market'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

/**
 * Why "Follow Smart Money" holds what it holds: per basket coin, what Nansen smart money holds on
 * Monad and bought in the last 24h, and the weight that came out. Tokens smart money holds that the
 * basket can't are shown below as market context, clearly marked as not in the basket.
 */
export function SmartMoneyCard({ info }: { info: MarketInfo | null }) {
  const t = useT()
  const { locale } = useSettings()
  const intl = intlLocale(locale)
  const usd = (n: number) =>
    new Intl.NumberFormat(intl, {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n)
  // Net flow under $1 is noise; show a dash instead of "+$0".
  const flow = (n?: number) =>
    n === undefined || Math.abs(n) < 1
      ? '–'
      : new Intl.NumberFormat(intl, {
          style: 'currency',
          currency: 'USD',
          notation: 'compact',
          maximumFractionDigits: 1,
          signDisplay: 'exceptZero',
        }).format(n)
  const flowTone = (n?: number) =>
    n === undefined || Math.abs(n) < 1 ? 'text-muted-foreground' : n < 0 ? 'text-destructive' : 'text-primary-ink'
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`
  const nansen = info?.source === 'nansen'
  const signals = (info?.signals ?? []).filter((s) => s.kind !== 'stable')
  const stable = info?.signals?.find((s) => s.kind === 'stable')
  const inBasket = new Set((info?.signals ?? []).flatMap((s) => (s.symbol === 'MON' ? ['MON', 'WMON'] : [s.symbol])))
  const context = (info?.holdings ?? []).filter((h) => !inBasket.has(h.symbol.toUpperCase()))
  const movers = info?.movers ?? []
  const logoOf = (symbol: string) => [...(info?.holdings ?? []), ...movers].find((x) => x.symbol === symbol)?.logo

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t('smart.title')}</CardTitle>
          <Badge variant="outline" className="font-normal">
            {nansen ? t('market.poweredBy') : t('market.nansenOffline')}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('smart.caption')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!info ? (
          <Skeleton className="h-40 w-full" />
        ) : !nansen || signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('smart.unavailable')}</p>
        ) : (
          <div className="space-y-2">
            <ul className="divide-y rounded-xl border text-sm">
              <li className="grid grid-cols-[1fr_4.5rem_4.5rem_3.5rem] gap-2 px-3 py-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
                <span>{t('smart.colCoin')}</span>
                <span className="text-right">{t('market.colHeld')}</span>
                <span className="text-right">{t('market.colFlow')}</span>
                <span className="text-right">{t('smart.colWeight')}</span>
              </li>
              {signals.map((s) => (
                <li
                  key={s.symbol}
                  className="grid grid-cols-[1fr_4.5rem_4.5rem_3.5rem] items-center gap-2 px-3 py-2 tabular-nums"
                >
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <CoinIcon symbol={s.symbol} size={20} fallbackSrc={logoOf(s.symbol)} />
                    <span className="truncate">{s.symbol}</span>
                    {s.kind === 'meme' && (
                      <span className="rounded bg-destructive/10 px-1 text-[9px] font-semibold text-destructive">
                        {t('basket.meme')}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-muted-foreground">{s.heldUsd >= 1 ? usd(s.heldUsd) : '–'}</span>
                  <span className={cn('text-right text-xs', flowTone(s.flow24hUsd))}>{flow(s.flow24hUsd)}</span>
                  <span className="text-right font-semibold">{pct(s.bps)}</span>
                </li>
              ))}
              {stable && (
                <li className="grid grid-cols-[1fr_3.5rem] items-center gap-2 px-3 py-2 tabular-nums">
                  <span className="flex items-center gap-2 font-medium">
                    <CoinIcon symbol="USDC" size={20} />
                    {t('smart.stableRow')}
                  </span>
                  <span className="text-right font-semibold">{pct(stable.bps)}</span>
                </li>
              )}
            </ul>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('smart.rule')}</p>
          </div>
        )}

        {nansen && movers.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {t('market.moversTitle')}
            </p>
            <div className="flex flex-wrap gap-2">
              {movers.map((m) => (
                <span
                  key={m.address}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm tabular-nums"
                >
                  <CoinIcon symbol={m.symbol} size={18} fallbackSrc={m.logo} />
                  <span className="font-medium">{m.symbol}</span>
                  <span className="text-xs text-primary-ink">{flow(m.flow24hUsd)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {nansen && context.length > 0 && (
          <details className="group rounded-xl border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{t('smart.contextTitle')}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t('smart.contextNote')}</span>
              </span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <ul className="divide-y border-t text-sm">
              {context.map((h) => (
                <li key={h.address} className="flex items-center justify-between gap-3 px-3 py-2 tabular-nums">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <CoinIcon symbol={h.symbol} size={20} fallbackSrc={h.logo} />
                    <span className="truncate">{h.symbol}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-muted-foreground">
                      {h.holders === 1 ? t('market.holderOne') : t('market.holders', { n: h.holders })}
                    </span>
                    <span>{usd(h.valueUsd)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {nansen && (
          <p className="text-xs text-muted-foreground">
            {t('market.holdingsCaption', {
              time: new Intl.DateTimeFormat(intl, { dateStyle: 'medium', timeStyle: 'short' }).format(info.fetchedAt),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
