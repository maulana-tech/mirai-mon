import { SavingsWaveChart } from '@/components/savings-wave-chart'
import { TokenIcon } from '@/components/brand/token-icon'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppState } from '@/lib/app-state'
import { formatMoney, useT } from '@/lib/i18n'
import type { FxRates } from '@/lib/rates'
import { secondaryCurrencyFor, useSettings } from '@/lib/settings'
import { computeSavingsPosition, savingsHistory } from '@/lib/yield'
import type { ActivityItem } from '@/lib/activity'
import { isMarket } from '@/lib/strategies'
import type { MiraiAccount } from '@/lib/types'

type YieldPositionCardProps = {
  account: MiraiAccount | null
  activity: ActivityItem[]
  loading: boolean
  rates: FxRates
  /** APR of the saver's current strategy, for the earning-rate line. */
  aprBps: number
}

function Stat({
  label,
  amount,
  secondary,
  tone,
}: {
  label: string
  amount: string
  secondary: string
  tone?: 'gold' | 'muted' | 'loss'
}) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={
          'mt-1 flex items-center gap-1.5 text-lg font-semibold tracking-tight tabular-nums ' +
          (tone === 'gold'
            ? 'text-gold-ink'
            : tone === 'muted'
              ? 'text-muted-foreground'
              : tone === 'loss'
                ? 'text-destructive'
                : '')
        }
      >
        <TokenIcon token="ausd" size={24} />
        {amount}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">{secondary}</p>
    </div>
  )
}

export function YieldPositionCard({
  account,
  activity,
  loading,
  rates,
  aprBps,
}: YieldPositionCardProps) {
  const t = useT()
  const { historyComplete } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const secondaryCurrency = secondaryCurrencyFor(primaryCurrency, locale)

  const primary = (amount: bigint): string => formatMoney(amount, primaryCurrency, rates, locale)
  const secondary = (amount: bigint): string =>
    formatMoney(amount, secondaryCurrency, rates, locale)

  if (loading || account === null) {
    return (
      <Card className="rounded-2xl shadow-none">
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="mt-5 h-4 w-2/3" />
        </CardContent>
      </Card>
    )
  }

  const position = computeSavingsPosition(activity, account.savings, historyComplete)
  const earnings = position.earnings
  const earningsTone = earnings === null || earnings === 0n ? 'muted' : earnings > 0n ? 'gold' : 'loss'
  const signed = (amount: bigint, fmt: (a: bigint) => string) =>
    amount < 0n ? `-${fmt(-amount)}` : `${amount > 0n ? '+' : ''}${fmt(amount)}`
  const history = savingsHistory(activity)

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('yield.positionTitle')}</CardTitle>
        <Badge variant="outline" className="mt-2 w-fit font-normal">
          {isMarket(account.strategy) ? t('yield.marketBadge') : t('yield.vaultBadge')}
        </Badge>
        {account !== null && account.savings > 0n && aprBps > 0 && (
          <p className="mt-2 text-sm text-primary-ink tabular-nums">
            {t('yield.rate', {
              month: primary((account.savings * BigInt(aprBps)) / 10_000n / 12n),
              year: primary((account.savings * BigInt(aprBps)) / 10_000n),
            })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label={t('yield.currentValue')}
            amount={primary(position.currentValue)}
            secondary={`~ ${secondary(position.currentValue)}`}
          />
          {position.principal !== null && earnings !== null ? (
            <>
              <Stat
                label={t('yield.principal')}
                amount={primary(position.principal)}
                secondary={`~ ${secondary(position.principal)}`}
              />
              <Stat
                label={t('yield.earnings')}
                amount={signed(earnings, primary)}
                secondary={`~ ${signed(earnings, secondary)}`}
                tone={earningsTone}
              />
            </>
          ) : (
            <>
              <Stat label={t('yield.principal')} amount="-" secondary="-" tone="muted" />
              <Stat label={t('yield.earnings')} amount="-" secondary="-" tone="muted" />
            </>
          )}
        </div>
        {history.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {t('yield.historyLabel')}
            </p>
            <SavingsWaveChart
              history={history}
              currentValue={position.currentValue}
              className="mt-2 h-14 w-full"
            />
          </div>
        )}
        <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
          {earnings === null ? t('yield.historyHint') : t('yield.earningsCaption')}
        </p>
      </CardContent>
    </Card>
  )
}
