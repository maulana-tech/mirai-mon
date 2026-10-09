import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, ArrowUpRightIcon, KeyRoundIcon, LockIcon, PencilIcon } from 'lucide-react'
import { AccountPanel } from '@/components/account-panel'
import { BasketCard } from '@/components/basket-card'
import { ConnectPrompt } from '@/components/connect-prompt'
import { NotFoundContent } from '@/components/not-found-content'
import { PocketForm } from '@/components/pocket-form'
import { PocketIcon } from '@/components/pocket-icon'
import { StrategyPicker } from '@/components/strategy-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fetchPocketFlows } from '@/lib/activity'
import { useAppState } from '@/lib/app-state'
import { formatDate, formatMoney, useT } from '@/lib/i18n'
import { useMarket } from '@/lib/market'
import { mirai } from '@/lib/mirai'
import { usePocketMetas } from '@/lib/pocket-meta'
import { isLocked, pocketLabel } from '@/lib/pockets'
import { useSettings } from '@/lib/settings'
import { isMarket } from '@/lib/strategies'
import type { MiraiAccount, Pocket } from '@/lib/types'
import { usePendingLabel } from '@/lib/use-pending-label'
import { useStrategies } from '@/lib/use-strategies'
import { useWallet } from '@/lib/wallet'

export function PocketPage() {
  const { address } = useWallet()
  const id = Number(useParams().id)
  if (!address) return <ConnectPrompt />
  return (
    <AccountPanel>
      {(account) => {
        const pocket = account.pockets.find((p) => p.id === id)
        return pocket ? <PocketDetail key={id} account={account} pocket={pocket} /> : <NotFoundContent />
      }}
    </AccountPanel>
  )
}

function PocketDetail({ account, pocket }: { account: MiraiAccount; pocket: Pocket }) {
  const t = useT()
  const { rates } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const { strategies, refresh } = useStrategies()
  const { metas, locked, busy, unlock } = usePocketMetas(account.pockets)
  const [editing, setEditing] = useState(false)
  const [deposited, setDeposited] = useState<bigint | null>(null)
  const { address } = useWallet()
  useEffect(() => {
    if (address) void fetchPocketFlows(address).then((f) => setDeposited(f ? (f[pocket.id] ?? 0n) : null))
  }, [address, pocket.id, pocket.value])
  const earned = deposited === null ? null : pocket.value - deposited
  const meta = metas[pocket.id]
  const { name, icon } = pocketLabel(pocket, meta, t)
  const money = (v: bigint) => formatMoney(v, primaryCurrency, rates, locale)
  const target = meta?.target ?? 0n
  const progress = target > 0n ? Math.min(100, Number((pocket.value * 10_000n) / target) / 100) : null

  return (
    <section className="space-y-5">
      <Link to="/app/pockets" className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:underline dark:text-cobalt/80">
        <ArrowLeftIcon className="size-4" />
        {t('nav.pockets')}
      </Link>

      <Card className="rounded-2xl shadow-none">
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4">
            <PocketIcon icon={icon} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold break-words">{name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('pockets.shareLine', { pct: pocket.shareBps / 100 })}
              </p>
            </div>
            {locked ? (
              <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => void unlock()}>
                <KeyRoundIcon className="size-4" />
                {t('pockets.showNames')}
              </Button>
            ) : (
              <Button variant="outline" size="icon-sm" aria-label={t('pockets.editTitle')} onClick={() => setEditing(true)}>
                <PencilIcon />
              </Button>
            )}
          </div>
          <div>
            <p className="text-4xl font-semibold tracking-tight tabular-nums">{money(pocket.value)}</p>
            {earned !== null && deposited! > 0n && (
              <p className={earned < 0n ? 'mt-1 text-sm text-destructive' : 'mt-1 text-sm text-gold-ink'}>
                {t('pockets.earned', { amount: money(earned < 0n ? -earned : earned), sign: earned < 0n ? '−' : '+' })}
              </p>
            )}
          </div>
          {progress !== null && (
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {progress >= 100
                  ? t('pockets.reached')
                  : t('pockets.toGo', { amount: money(target - pocket.value), target: money(target) })}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild className="rounded-full">
              <Link to={`/app/withdraw?pocket=${pocket.id}`}>
                <ArrowUpRightIcon className="size-4" />
                {t('nav.withdraw')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <StrategyPicker pocket={pocket} strategies={strategies} onChanged={() => void refresh()} />
      {isMarket(pocket.strategy) && <InvestSection pocket={pocket} />}
      <LockCard pocket={pocket} />
      {account.pockets.length > 1 && <CloseCard account={account} pocket={pocket} />}

      {editing && <PocketForm account={account} open onOpenChange={setEditing} pocket={pocket} meta={meta} />}
    </section>
  )
}

function InvestSection({ pocket }: { pocket: Pocket }) {
  const { basket, info, reload } = useMarket(pocket.id)
  const logos = Object.fromEntries(
    [...(info?.holdings ?? []), ...(info?.movers ?? [])].flatMap((x) => (x.logo ? [[x.symbol, x.logo]] : [])),
  )
  return <BasketCard pocket={pocket} basket={basket} logos={logos} onChanged={reload} />
}

/** Extend-only time lock on this pocket's withdrawals. */
function LockCard({ pocket }: { pocket: Pocket }) {
  const t = useT()
  const { address } = useWallet()
  const { busy, runAction } = useAppState()
  const { locale } = useSettings()
  const pendingLabel = usePendingLabel()
  const [date, setDate] = useState('')
  // local calendar date; toISOString would allow locking a date already past in UTC+ zones
  const next = new Date(Date.now() + 86_400_000)
  const tomorrow = [next.getFullYear(), String(next.getMonth() + 1).padStart(2, '0'), String(next.getDate()).padStart(2, '0')].join('-')

  const lock = async () => {
    if (!address) return
    const until = BigInt(Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000))
    const ok = await runAction('lock', 'success.lockSet', () => mirai.setPocketLock(address, pocket.id, until))
    if (ok) setDate('')
  }

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="size-4 text-muted-foreground" />
          {t('rules.lockTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {isLocked(pocket) ? t('rules.lockedStatus', { date: formatDate(pocket.lockUntil, locale) }) : t('rules.noLock')}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="date"
            aria-label={t('rules.lockLabel')}
            min={tomorrow}
            value={date}
            disabled={busy !== null}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => void lock()}
            disabled={busy !== null || date === '' || date < tomorrow}
          >
            {busy === 'lock' ? pendingLabel : t('rules.lockButton')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('pockets.lockCaption')}</p>
      </CardContent>
    </Card>
  )
}

/** Closes the pocket: its money and share move into another pocket. */
function CloseCard({ account, pocket }: { account: MiraiAccount; pocket: Pocket }) {
  const t = useT()
  const navigate = useNavigate()
  const { address } = useWallet()
  const { busy, runAction } = useAppState()
  const pendingLabel = usePendingLabel()
  const { metas } = usePocketMetas(account.pockets)
  const others = account.pockets.filter((p) => p.id !== pocket.id)
  const [into, setInto] = useState(others[0].id)
  const [sure, setSure] = useState(false)

  const close = async () => {
    if (!address) return
    const ok = await runAction('close', 'pockets.closed', () => mirai.closePocket(address, pocket.id, into))
    if (ok) void navigate(`/app/pockets/${into}`)
  }

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('pockets.closeTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('pockets.closeCaption')}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('pockets.closeInto')}
          value={into}
          disabled={busy !== null}
          onChange={(e) => setInto(Number(e.target.value))}
          className="h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-sm"
        >
          {others.map((p) => {
            const l = pocketLabel(p, metas[p.id], t)
            return (
              <option key={p.id} value={p.id}>
                {l.name}
              </option>
            )
          })}
        </select>
        {sure ? (
          <Button variant="destructive" className="rounded-full" disabled={busy !== null || isLocked(pocket)} onClick={() => void close()}>
            {busy === 'close' ? pendingLabel : t('pockets.closeConfirm')}
          </Button>
        ) : (
          <Button variant="outline" className="rounded-full" disabled={isLocked(pocket)} onClick={() => setSure(true)}>
            {t('pockets.close')}
          </Button>
        )}
        {isLocked(pocket) && <p className="w-full text-xs text-muted-foreground">{t('pockets.closeLocked')}</p>}
      </CardContent>
    </Card>
  )
}
