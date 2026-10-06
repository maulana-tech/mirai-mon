import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FeatureSplit } from '@/components/feature-split'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAppState } from '@/lib/app-state'
import { AUSD_SCALE } from '@/lib/ausd'
import { mirai } from '@/lib/mirai'
import { formatMoney, useT } from '@/lib/i18n'
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
  const anyBusy = busy !== null

  const percent = draft ?? Math.round(account.splitBps / 100)
  const unchanged = percent * 100 === account.splitBps
  const saved = (EXAMPLE * BigInt(percent)) / 100n
  const money = (amount: bigint) => formatMoney(amount, 'ausd', rates, locale)

  const handleSaveSplit = async () => {
    if (!address) return
    const ok = await runAction('split', 'success.splitSaved', () => mirai.setSplit(address, percent * 100))
    if (ok) setDraft(null)
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

      <Link to="/app/pockets" className="mt-4 block text-center text-sm text-primary-ink hover:underline">
        {t('rules.pocketsLink', { n: account.pockets.length })}
      </Link>
    </FeatureSplit>
  )
}
