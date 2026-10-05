import { useId, useState } from 'react'
import { TokenIcon } from '@/components/brand/token-icon'
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
  const gradientId = useId()
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
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const toPath = (values: number[]) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / months) * 300).toFixed(2)},${(110 - (v / max) * 100).toFixed(2)}`)
      .join(' ')
  const money = (units: number) => formatMoney(BigInt(Math.round(units * Number(AUSD_SCALE))), primaryCurrency, rates, locale)
  // A Smart Money saver sees the yield strategies for comparison; the summary uses Balanced.
  const market = isMarket(account.strategy)
  const chosen = series.find((s) => s.id === account.strategy) ?? series[1]
  const chosenEnd = chosen.values[months]
  const deposited = baseline[months]

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

        <svg viewBox="0 0 300 115" className="h-44 w-full" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${toPath(chosen.values)} L300,110 L0,110 Z`} fill={`url(#${gradientId})`} />
          <path
            d={toPath(baseline)}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            opacity="0.6"
          />
          {series.map((s) => (
            <path
              key={s.id}
              d={toPath(s.values)}
              fill="none"
              stroke={STROKE[s.id]}
              strokeWidth={s.id === account.strategy ? 2.5 : 1.25}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div className="grid gap-2 sm:grid-cols-4">
          {series.map((s) => (
            <div
              key={s.id}
              className={cn('rounded-xl border p-3', s.id === account.strategy && 'border-primary bg-primary/5')}
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
