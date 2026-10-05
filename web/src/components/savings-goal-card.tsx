import { useEffect, useState } from 'react'
import { FingerprintIcon, LockIcon, PencilIcon, TargetIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { TokenIcon } from '@/components/brand/token-icon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppState } from '@/lib/app-state'
import { errorKey } from '@/lib/errors'
import { ausdToInput, parseAusd } from '@/lib/format'
import { decryptGoal, encryptGoal, type SavingsGoal } from '@/lib/goal'
import { formatMoney, useT } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { useSettings } from '@/lib/settings'
import { useWallet } from '@/lib/wallet'

type View = 'loading' | 'empty' | 'locked' | 'open' | 'edit'

/** Private savings goal: stored on-chain as a passkey-encrypted vault, opened with one passkey tap. */
export function SavingsGoalCard({ savings }: { savings: bigint }) {
  const t = useT()
  const { address } = useWallet()
  const { busy, rates, runAction } = useAppState()
  const { locale } = useSettings()
  const [encrypted, setEncrypted] = useState<string | null>(null)
  const [goal, setGoal] = useState<SavingsGoal | null>(null)
  const [view, setView] = useState<View>('loading')
  const [opening, setOpening] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')

  useEffect(() => {
    if (!address) return
    let active = true
    setGoal(null)
    setView('loading')
    mirai.getGoal(address).then(
      (value) => {
        if (!active) return
        setEncrypted(value)
        setView(value ? 'locked' : 'empty')
      },
      () => active && setView('empty'),
    )
    return () => {
      active = false
    }
  }, [address])

  const money = (amount: bigint) => formatMoney(amount, 'ausd', rates, locale)

  const open = async () => {
    if (!encrypted) return
    setOpening(true)
    try {
      setGoal(await decryptGoal(encrypted))
      setView('open')
    } catch (e) {
      toast.error(t(errorKey(e)))
    } finally {
      setOpening(false)
    }
  }

  const startEdit = () => {
    setName(goal?.name ?? '')
    setTarget(goal ? ausdToInput(goal.target) : '')
    setView('edit')
  }

  const save = async () => {
    if (!address) return
    let parsedTarget: bigint
    try {
      parsedTarget = parseAusd(target)
      if (parsedTarget <= 0n || name.trim() === '') throw new Error('invalid')
    } catch {
      toast.error(t('goal.invalid'))
      return
    }
    const next = { name: name.trim(), target: parsedTarget }
    let vault = ''
    const result = await runAction('goal', 'goal.saved', async () => {
      vault = await encryptGoal(next)
      return mirai.setGoal(address, vault)
    })
    if (result) {
      setEncrypted(vault)
      setGoal(next)
      setView('open')
    }
  }

  const clear = async () => {
    if (!address) return
    const result = await runAction('goal', 'goal.cleared', () => mirai.setGoal(address, ''))
    if (result) {
      setEncrypted(null)
      setGoal(null)
      setView('empty')
    }
  }

  const pct = goal && goal.target > 0n ? Number((savings * 1000n) / goal.target) / 10 : 0

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TargetIcon className="size-4 text-primary-ink" />
            {t('goal.title')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('goal.caption')}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] tracking-wider text-accent-foreground uppercase">
          <LockIcon className="size-3" />
          {t('goal.private')}
        </span>
      </CardHeader>
      <CardContent>
        {view === 'loading' && <Skeleton className="h-16 w-full rounded-xl" />}

        {view === 'empty' && (
          <Button variant="outline" className="rounded-full" onClick={startEdit}>
            <TargetIcon />
            {t('goal.create')}
          </Button>
        )}

        {view === 'locked' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">{t('goal.lockedBody')}</p>
            <Button className="rounded-full" disabled={opening} onClick={() => void open()}>
              <FingerprintIcon />
              {opening ? `${t('common.loading')}...` : t('goal.open')}
            </Button>
          </div>
        )}

        {view === 'open' && goal && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-semibold tracking-tight">{goal.name}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {t('goal.progress', { saved: money(savings), target: money(goal.target) })}
              </p>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {pct >= 100 ? t('goal.reached') : t('goal.percent', { pct: pct.toFixed(1) })}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={startEdit}>
                  <PencilIcon />
                  {t('goal.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => void clear()}
                >
                  <Trash2Icon />
                  {t('goal.clear')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {view === 'edit' && (
          <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-name">{t('goal.nameLabel')}</Label>
                <Input
                  id="goal-name"
                  value={name}
                  maxLength={60}
                  placeholder={t('goal.namePlaceholder')}
                  className="bg-card"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-target">{t('goal.targetLabel')}</Label>
                <div className="relative">
                  <TokenIcon token="ausd" size={26} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                  <Input
                    id="goal-target"
                    value={target}
                    inputMode="decimal"
                    placeholder="500"
                    className="bg-card pl-12 tabular-nums"
                    onChange={(e) => setTarget(e.target.value.replace(',', '.'))}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('goal.encryptHint')}</p>
            <div className="flex gap-2">
              <Button className="rounded-full" disabled={busy !== null} onClick={() => void save()}>
                <FingerprintIcon />
                {busy === 'goal' ? `${t('common.loading')}...` : t('goal.save')}
              </Button>
              <Button
                variant="ghost"
                className="rounded-full"
                disabled={busy !== null}
                onClick={() => setView(goal ? 'open' : encrypted ? 'locked' : 'empty')}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
