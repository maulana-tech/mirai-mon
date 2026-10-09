import { Link } from 'react-router-dom'
import { ArrowRightIcon, LockIcon, PlusIcon } from 'lucide-react'
import { PocketIcon } from '@/components/pocket-icon'
import { useAppState } from '@/lib/app-state'
import { formatMoney, useT } from '@/lib/i18n'
import { usePocketMetas } from '@/lib/pocket-meta'
import { isLocked, pocketLabel } from '@/lib/pockets'
import { useSettings } from '@/lib/settings'
import { DEFAULT_APR_BPS, STRATEGIES, formatApr, isMarket } from '@/lib/strategies'
import type { MiraiAccount, Pocket, PocketMeta, StrategyStats } from '@/lib/types'
import { cn } from '@/lib/utils'

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`

/** A pocket as a tall card: icon, name, value, progress to its target, share of new savings. */
export function PocketCard({
  pocket,
  meta,
  strategies,
  compact = false,
}: {
  pocket: Pocket
  meta: PocketMeta | undefined
  strategies: StrategyStats[] | null
  compact?: boolean
}) {
  const t = useT()
  const { rates } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const { name, icon } = pocketLabel(pocket, meta, t)
  const target = meta?.target ?? 0n
  const progress = target > 0n ? Math.min(100, Number((pocket.value * 10_000n) / target) / 100) : null
  const market = isMarket(pocket.strategy)
  const apr = strategies?.find((s) => s.id === pocket.strategy)?.aprBps ?? DEFAULT_APR_BPS[pocket.strategy]

  return (
    <Link
      to={`/app/pockets/${pocket.id}`}
      className={cn(
        'group flex flex-col rounded-2xl border bg-card p-4 outline-none transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50',
        compact ? 'min-h-40 w-36 shrink-0' : 'min-h-[324px]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <PocketIcon icon={icon} size={compact ? 'sm' : 'md'} />
        {isLocked(pocket) && <LockIcon className="size-4 text-muted-foreground" aria-label={t('pockets.locked')} />}
      </div>
      <p className="mt-3 line-clamp-2 font-medium break-words">{name}</p>
      <p className="mt-auto pt-3 text-xl font-semibold tracking-tight tabular-nums">
        {formatMoney(pocket.value, primaryCurrency, rates, locale)}
      </p>
      {progress !== null && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {t('pockets.ofTarget', { pct: Math.floor(progress), target: formatMoney(target, primaryCurrency, rates, locale) })}
          </p>
        </div>
      )}
      {!compact && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3 text-[11px]">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary-ink tabular-nums">
            {t('pockets.shareBadge', { pct: pct(pocket.shareBps) })}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 tabular-nums',
              market ? 'bg-destructive/10 text-destructive' : 'bg-gold/15 text-gold-ink',
            )}
          >
            {market ? t('strategy.invest') : `${t(STRATEGIES[pocket.strategy].name)} · ${formatApr(apr)}`}
          </span>
        </div>
      )}
    </Link>
  )
}

/** Dashed tile that starts a new pocket. */
export function NewPocketTile({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[324px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/40 text-sm text-white/80 outline-none transition-colors hover:border-white hover:bg-white/10 hover:text-white dark:border-cobalt/40 dark:text-cobalt/80 dark:hover:text-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <PlusIcon className="size-6" />
      {label}
    </button>
  )
}

/** Dashboard row: the account's pockets as small cards, scrolling sideways. */
export function PocketStrip({ account }: { account: MiraiAccount }) {
  const t = useT()
  const { metas, locked, busy, unlock } = usePocketMetas(account.pockets)
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-white dark:text-cobalt">{t('nav.pockets')}</h2>
        <span className="flex items-center gap-3 text-xs">
          {locked && (
            <button type="button" disabled={busy} onClick={() => void unlock()} className="text-white hover:underline dark:text-cobalt">
              {t('pockets.showNames')}
            </button>
          )}
          <Link to="/app/pockets" className="flex items-center gap-1 text-white/70 hover:underline dark:text-cobalt/70">
            {t('pockets.seeAll')}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {account.pockets.map((p) => (
          <PocketCard key={p.id} pocket={p} meta={metas[p.id]} strategies={null} compact />
        ))}
      </div>
    </section>
  )
}
