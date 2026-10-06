import { useState } from 'react'
import { LockIcon } from 'lucide-react'
import { FeatureSplit } from '@/components/feature-split'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useAppState } from '@/lib/app-state'
import { AUSD_SCALE } from '@/lib/ausd'
import { mirai } from '@/lib/mirai'
import { formatDate, formatMoney, useT } from '@/lib/i18n'
import { usePendingLabel } from '@/lib/use-pending-label'
import { useSettings } from '@/lib/settings'
import type { MiraiAccount } from '@/lib/types'
import { useWallet } from '@/lib/wallet'

// Example payment used to preview the split in plain numbers.
const EXAMPLE = 100n * AUSD_SCALE

type RulesCardProps = {
  account: MiraiAccount
}

export function RulesCard({ account }: RulesCardProps) {
  const t = useT()
  const pendingLabel = usePendingLabel()
  const { address } = useWallet()
  const { busy, rates, runAction } = useAppState()
  const { locale } = useSettings()
  const [draft, setDraft] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const anyBusy = busy !== null

  const percent = draft ?? Math.round(account.splitBps / 100)
  const unchanged = percent * 100 === account.splitBps
  const saved = (EXAMPLE * BigInt(percent)) / 100n
  const money = (amount: bigint) => formatMoney(amount, 'ausd', rates, locale)

  // local calendar date; toISOString would allow locking a date already past in UTC+ zones
  const next = new Date(Date.now() + 86_400_000)
  const tomorrow = [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    String(next.getDate()).padStart(2, '0'),
  ].join('-')
  const locked = Number(account.lockUntil) * 1000 > Date.now()

  const handleSaveSplit = async () => {
    if (!address) return
    const ok = await runAction('split', 'success.splitSaved', () => mirai.setSplit(address, percent * 100))
    if (ok) setDraft(null)
  }

  const handleLock = async () => {
    if (!address) return
    const until = BigInt(Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000))
    const ok = await runAction('lock', 'success.lockSet', () => mirai.setLock(address, until))
    if (ok) setDate('')
  }

  return (
    <FeatureSplit
      panel={{
        art: 'split',
        label: t('rules.panelLabel'),
        title: t('rules.panelTitle'),
        body: t('rules.panelBody'),
      }}
    >
      <div className="rounded-2xl border bg-muted/30 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('rules.splitLabel')}</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{percent}%</p>
        </div>
        <Slider
          className="mt-4"
          value={[percent]}
          min={0}
          max={100}
          step={1}
          disabled={anyBusy}
          onValueChange={(values) => setDraft(values[0])}
        />
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-primary" />
              {t('balances.spendable')}
            </p>
            <p className="mt-1 font-semibold tabular-nums">{money(EXAMPLE - saved)}</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-gold" />
              {t('balances.savings')}
            </p>
            <p className="mt-1 font-semibold tabular-nums">{money(saved)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('rules.previewCaption', { amount: money(EXAMPLE) })}</p>
      </div>

      <Button
        size="lg"
        className="mt-4 h-12 w-full rounded-full text-base"
        onClick={() => void handleSaveSplit()}
        disabled={anyBusy || unchanged}
      >
        {busy === 'split' ? pendingLabel : t('rules.saveButton')}
      </Button>

      <div className="mt-5 rounded-2xl border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LockIcon className="size-4 text-muted-foreground" />
          {t('rules.lockTitle')}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {locked ? t('rules.lockedStatus', { date: formatDate(account.lockUntil, locale) }) : t('rules.noLock')}
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            type="date"
            aria-label={t('rules.lockLabel')}
            min={tomorrow}
            value={date}
            disabled={anyBusy}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => void handleLock()}
            disabled={anyBusy || date === '' || date < tomorrow}
          >
            {busy === 'lock' ? pendingLabel : t('rules.lockButton')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('rules.lockCaption')}</p>
      </div>
    </FeatureSplit>
  )
}
