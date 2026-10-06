import { useState } from 'react'
import { TokenIcon } from '@/components/brand/token-icon'
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, chartCssVars } from '@/components/ui/bar-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AUSD_SCALE } from '@/lib/ausd'
import { useAppState } from '@/lib/app-state'
import { parseAusd } from '@/lib/format'
import { formatMoney, useT } from '@/lib/i18n'
import { useSettings } from '@/lib/settings'
import { DEFAULT_APR_BPS, YIELD_STRATEGIES, formatApr, isMarket } from '@/lib/strategies'
import type { MiraiAccount, StrategyId, StrategyStats } from '@/lib/types'
import { cn } from '@/lib/utils'

const HORIZONS = [6, 12, 24, 60] as const
// Line colours per strategy; the no-yield baseline is drawn dashed in muted ink.
const STROKE: Record<StrategyId, string> = {
  0: 'var(--muted-foreground)',
  1: 'var(--primary)',
  2: 'var(--color-cyan)',
  3: 'var(--destructive)', // never drawn: market value can't be projected
}

/**
 * Savings balance month by month: current savings compound monthly at the APR, plus the split of
 * each month's income deposited at month end. Display math in floats, never used for transactions.
 */
function project(start: number, monthly: number, aprBps: number, months: number): number[] {
  const r = aprBps / 10_000 / 12
  const out = [start]
  for (let m = 1; m <= months; m++) out.push(out[m - 1] * (1 + r) + monthly)
  return out
}

type ProjectionCardProps = {
  account: MiraiAccount
  strategies: StrategyStats[] | null
}

export function ProjectionCard({ account, strategies }: ProjectionCardProps) {
  const t = useT()
  const { rates } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const [income, setIncome] = useState('1000')
  const [months, setMonths] = useState<(typeof HORIZONS)[number]>(12)

  let incomeUnits = 0
  try {
    incomeUnits = Number(parseAusd(income === '' ? '0' : income)) / Number(AUSD_SCALE)
  } catch {
    incomeUnits = 0
  }
  const split = account.splitBps / 10_000
  const monthly = incomeUnits * split
  const start = Number(account.savings) / Number(AUSD_SCALE)
  const aprOf = (id: StrategyId) => strategies?.find((s) => s.id === id)?.aprBps ?? DEFAULT_APR_BPS[id]

  const series = YIELD_STRATEGIES.map((s) => ({ ...s, apr: aprOf(s.id), values: project(start, monthly, aprOf(s.id), months) }))
  const baseline = project(start, monthly, 0, months)
  const money = (units: number) => formatMoney(BigInt(Math.round(units * Number(AUSD_SCALE))), primaryCurrency, rates, locale)
  // A Smart Money saver sees the yield strategies for comparison; the summary uses Balanced.
  // The pocket taking the biggest share of new savings stands for the account.
  const main = account.pockets.reduce((m, p) => (p.shareBps > m.shareBps ? p : m), account.pockets[0])
  const market = !main || isMarket(main.strategy)
  const chosen = series.find((s) => s.id === main?.strategy) ?? series[1]
  const chosenEnd = chosen.values[months]
  const deposited = baseline[months]
  // At most 12 bars: monthly up to a year, then every 2 or 5 months.
  const step = Math.max(1, Math.round(months / 12))
  const chartData = Array.from({ length: Math.floor(months / step) }, (_, i) => {
    const m = (i + 1) * step
    return {
      label: t('projection.months', { n: m }),
      deposited: baseline[m],
      earned: Math.max(0, chosen.values[m] - baseline[m]),
    }
  })

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('projection.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('projection.caption', { pct: Math.round(split * 100) })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="projection-income" className="text-xs text-muted-foreground">
              {t('projection.incomeLabel')}
            </label>
            <div className="relative w-44">
              <TokenIcon token="ausd" size={22} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
              <Input
                id="projection-income"
                value={income}
                inputMode="decimal"
                className="pl-10 tabular-nums"
                onChange={(e) => setIncome(e.target.value.replace(',', '.'))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">{t('projection.horizonLabel')}</span>
            <div className="flex rounded-full bg-muted p-1">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setMonths(h)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs tabular-nums transition-colors',
                    months === h ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('projection.months', { n: h })}
                </button>
              ))}
            </div>
          </div>
        </div>

        <BarChart
          data={chartData}
          xDataKey="label"
          stacked
          aspectRatio="3 / 1"
          barGap={0.3}
          margin={{ top: 8, right: 4, bottom: 24, left: 4 }}
        >
          <Grid horizontal numTicksRows={4} />
          <Bar dataKey="deposited" fill={chartCssVars.linePrimary} lineCap="butt" />
          <Bar dataKey="earned" fill={chartCssVars.lineSecondary} lineCap={4} />
          <BarXAxis maxLabels={6} />
          <ChartTooltip
            showDots={false}
            rows={(point) => {
              const dep = Number(point.deposited)
              const earned = Number(point.earned)
              return [
                { color: chartCssVars.linePrimary, label: t('projection.deposited'), value: money(dep) },
                { color: chartCssVars.lineSecondary, label: t('projection.earned', { name: t(chosen.name) }), value: money(earned) },
                { color: 'transparent', label: t('projection.total'), value: money(dep + earned) },
              ]
            }}
          />
        </BarChart>

        <div className="grid gap-2 sm:grid-cols-4">
          {series.map((s) => (
            <div
              key={s.id}
              className={cn('rounded-xl border p-3', s.id === main?.strategy && 'border-primary bg-primary/5')}
            >
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: STROKE[s.id] }} />
                {t(s.name)} · {formatApr(s.apr)}
              </p>
              <p className="mt-1 font-semibold tabular-nums">{money(s.values[months])}</p>
            </div>
          ))}
          <div className="rounded-xl border border-dashed p-3">
            <p className="text-xs text-muted-foreground">{t('projection.noYield')}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(deposited)}</p>
          </div>
        </div>

        {market && <p className="text-sm text-muted-foreground">{t('projection.marketNote')}</p>}
        <p className="text-sm">
          {t('projection.summary', {
            months,
            name: t(chosen.name),
            total: money(chosenEnd),
            extra: money(Math.max(0, chosenEnd - deposited)),
          })}
        </p>
        <p className="text-xs text-muted-foreground">{t('projection.disclaimer')}</p>
      </CardContent>
    </Card>
  )
}
