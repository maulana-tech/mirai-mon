import { useState } from 'react'
import { KeyRoundIcon } from 'lucide-react'
import { AccountPanel } from '@/components/account-panel'
import { ConnectPrompt } from '@/components/connect-prompt'
import { PageHeader } from '@/components/page-header'
import { NewPocketTile, PocketCard } from '@/components/pocket-card'
import { PocketForm } from '@/components/pocket-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAppState } from '@/lib/app-state'
import { useT } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { usePocketMetas } from '@/lib/pocket-meta'
import { MAX_POCKETS, pocketLabel } from '@/lib/pockets'
import { isMarket } from '@/lib/strategies'
import type { MiraiAccount, PocketMeta } from '@/lib/types'
import { usePendingLabel } from '@/lib/use-pending-label'
import { useStrategies } from '@/lib/use-strategies'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

// One color per pocket slot for the split bar.
const SLOT_COLORS = [
  'bg-primary',
  'bg-gold',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-amber-600',
  'bg-teal-600',
  'bg-fuchsia-500',
  'bg-lime-600',
]

export function PocketsPage() {
  const t = useT()
  const { address } = useWallet()
  if (!address) return <ConnectPrompt />
  return (
    <section className="space-y-5">
      <PageHeader title={t('nav.pockets')} caption={t('page.pocketsCaption')} />
      <AccountPanel>{(account) => <PocketsBody account={account} />}</AccountPanel>
    </section>
  )
}

function PocketsBody({ account }: { account: MiraiAccount }) {
  const t = useT()
  const { strategies } = useStrategies()
  const { metas, locked, busy, unlock } = usePocketMetas(account.pockets)
  const [creating, setCreating] = useState<'yield' | 'invest' | null>(null)
  const full = account.pockets.length >= MAX_POCKETS
  const yieldPockets = account.pockets.filter((p) => !isMarket(p.strategy))
  const investPockets = account.pockets.filter((p) => isMarket(p.strategy))

  const section = (kind: 'yield' | 'invest', title: string, caption: string, list: typeof account.pockets) => (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-white dark:text-cobalt">{title}</h2>
        <p className="text-sm text-white/70 dark:text-cobalt/70">{caption}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((p) => (
          <PocketCard key={p.id} pocket={p} meta={metas[p.id]} strategies={strategies} />
        ))}
        {!full && (
          <NewPocketTile
            label={kind === 'yield' ? t('pockets.newYield') : t('pockets.newInvest')}
            onClick={() => setCreating(kind)}
          />
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary-ink" />
            {t('pockets.namesHidden')}
          </span>
          <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => void unlock()}>
            {t('pockets.showNames')}
          </Button>
        </div>
      )}
      <SplitCard account={account} metas={metas} />
      {section('yield', t('pockets.yieldTitle'), t('pockets.yieldCaption'), yieldPockets)}
      {section('invest', t('pockets.investTitle'), t('pockets.investCaption'), investPockets)}
      {full && <p className="text-xs text-white/70 dark:text-cobalt/70">{t('pockets.full', { n: MAX_POCKETS })}</p>}
      {creating && (
        <PocketForm
          account={account}
          open
          onOpenChange={(o) => !o && setCreating(null)}
          invest={creating === 'invest'}
        />
      )}
    </div>
  )
}

/** How each payment's savings are spread over the pockets; editable as whole percents summing to 100. */
function SplitCard({ account, metas }: { account: MiraiAccount; metas: Record<number, PocketMeta | undefined> }) {
  const t = useT()
  const { address } = useWallet()
  const { busy, runAction } = useAppState()
  const pendingLabel = usePendingLabel()
  const [draft, setDraft] = useState<Record<number, number> | null>(null)
  const shares = draft ?? Object.fromEntries(account.pockets.map((p) => [p.id, p.shareBps]))
  const total = Object.values(shares).reduce((a, b) => a + b, 0)

  const save = async () => {
    if (!address || !draft) return
    const ok = await runAction('shares', 'pockets.sharesSaved', () => mirai.setPocketShares(address, draft))
    if (ok) setDraft(null)
  }

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('pockets.splitTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('pockets.splitCaption', { pct: account.splitBps / 100 })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {account.pockets.map((p) =>
            shares[p.id] > 0 ? (
              <div
                key={p.id}
                className={cn('h-full border-r border-card last:border-r-0', SLOT_COLORS[p.id % SLOT_COLORS.length])}
                style={{ width: `${shares[p.id] / 100}%` }}
              />
            ) : null,
          )}
        </div>
        {account.pockets.length > 1 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {account.pockets.map((p) => {
              const { name } = pocketLabel(p, metas[p.id], t)
              return (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={cn('size-2.5 shrink-0 rounded-full', SLOT_COLORS[p.id % SLOT_COLORS.length])} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <div className="relative w-20">
                    <Input
                      inputMode="numeric"
                      aria-label={`${name} %`}
                      value={String(shares[p.id] / 100)}
                      disabled={busy !== null}
                      onChange={(e) =>
                        setDraft({
                          ...shares,
                          [p.id]: Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0) * 100,
                        })
                      }
                      className="pr-6 text-right tabular-nums"
                    />
                    <span className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {draft && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className={cn('text-sm tabular-nums', total !== 10_000 && 'text-destructive')}>
              {t('pockets.splitTotal', { pct: total / 100 })}
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" className="rounded-full" disabled={busy !== null || total !== 10_000} onClick={() => void save()}>
                {busy === 'shares' ? pendingLabel : t('pockets.saveSplit')}
              </Button>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
