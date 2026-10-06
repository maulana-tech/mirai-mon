import { CircleCheckIcon, Loader2Icon } from 'lucide-react'
import { CoinIcon } from '@/components/brand/coin-icon'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppState } from '@/lib/app-state'
import { formatMoney, useT } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { useSettings } from '@/lib/settings'
import { DEFAULT_APR_BPS, STRATEGIES, formatApr, isMarket } from '@/lib/strategies'
import type { Pocket, StrategyId, StrategyStats } from '@/lib/types'
import { cn } from '@/lib/utils'
import { usePendingLabel } from '@/lib/use-pending-label'
import { useWallet } from '@/lib/wallet'

type StrategyPickerProps = {
  pocket: Pocket
  strategies: StrategyStats[] | null
  onChanged: () => void
}

/** Choose where a pocket's savings earn. Switching moves its money into the new strategy in one transaction. */
export function StrategyPicker({ pocket, strategies, onChanged }: StrategyPickerProps) {
  const t = useT()
  const { address } = useWallet()
  const pendingLabel = usePendingLabel()
  const { busy, rates, runAction } = useAppState()
  const { locale, primaryCurrency } = useSettings()

  const choose = async (id: StrategyId) => {
    if (!address || id === pocket.strategy) return
    const ok = await runAction(`strategy-${id}`, 'strategy.switched', () =>
      mirai.setPocketStrategy(address, pocket.id, id),
    )
    if (ok) onChanged()
  }

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('strategy.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('strategy.caption')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STRATEGIES.map((s) => {
            const stats = strategies?.find((x) => x.id === s.id)
            const apr = stats?.aprBps ?? DEFAULT_APR_BPS[s.id]
            const selected = pocket.strategy === s.id
            const pending = busy === `strategy-${s.id}`
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected}
                disabled={selected || busy !== null}
                onClick={() => void choose(s.id)}
                className={cn(
                  'relative flex flex-col rounded-2xl border p-4 text-left outline-none transition-[border-color,box-shadow,transform] focus-visible:ring-3 focus-visible:ring-ring/50',
                  selected
                    ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)_inset]'
                    : pending
                      ? 'border-primary/60' // the card being switched to stays fully visible while it waits
                      : 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t(s.name)}</span>
                  {selected && <CircleCheckIcon className="size-5 shrink-0 text-primary-ink" />}
                </div>
                {isMarket(s.id) ? (
                  <>
                    <span className="mt-3 flex items-center gap-2 text-3xl font-semibold tracking-tight">
                      <span className="flex -space-x-2">
                        <CoinIcon symbol="BTC" size={28} className="ring-2 ring-card" />
                        <CoinIcon symbol="ETH" size={28} className="ring-2 ring-card" />
                        <CoinIcon symbol="MON" size={28} className="ring-2 ring-card" />
                      </span>
                      {t('strategy.investHeadline')}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('strategy.marketLabel')}</span>
                  </>
                ) : (
                  <>
                    <span className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{formatApr(apr)}</span>
                    <span className="text-xs text-muted-foreground">{t('strategy.aprLabel')}</span>
                  </>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn('font-normal', isMarket(s.id) && 'border-destructive/40 text-destructive')}
                  >
                    {t(s.risk)}
                  </Badge>
                  {stats && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t('strategy.tvl', { amount: formatMoney(stats.totalAssets, primaryCurrency, rates, locale) })}
                    </span>
                  )}
                </div>
                <span className="mt-3 border-t pt-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {t('strategy.mainnet', { market: s.mainnet })}
                </span>
                {pending && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-card/90 px-3 text-center">
                    <Loader2Icon className="size-5 animate-spin text-primary-ink" />
                    <span className="text-xs font-medium text-primary-ink">{pendingLabel}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {pocket.value > 0n ? t('strategy.switchMoves') : t('strategy.switchFuture')} {t('strategy.testnetNote')}{' '}
          {t('strategy.marketNote')}
        </p>
      </CardContent>
    </Card>
  )
}
