import { useState } from 'react'
import { ArrowDownIcon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { TokenIcon } from '@/components/brand/token-icon'
import { FeatureSplit } from '@/components/feature-split'
import type { LineArtKind } from '@/components/landing/kit'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppState } from '@/lib/app-state'
import { mirai } from '@/lib/mirai'
import { ausdToInput, parseAusd } from '@/lib/format'
import { formatDate, formatMoney, useT, type MessageKey } from '@/lib/i18n'
import { usePendingLabel } from '@/lib/use-pending-label'
import { secondaryCurrencyFor, useSettings } from '@/lib/settings'
import type { MiraiAccount } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

type Pocket = 'spend' | 'savings'

const PANEL: Record<Pocket, { art: LineArtKind; label: MessageKey; title: MessageKey; body: MessageKey }> = {
  spend: { art: 'withdraw', label: 'withdraw.panelSpendLabel', title: 'withdraw.panelSpendTitle', body: 'withdraw.panelSpendBody' },
  savings: { art: 'vault', label: 'withdraw.panelSaveLabel', title: 'withdraw.panelSaveTitle', body: 'withdraw.panelSaveBody' },
}

// Parses what the user typed; null while empty or not a valid amount (no toast while typing).
function tryParse(raw: string): bigint | null {
  try {
    const v = parseAusd(raw)
    return v > 0n ? v : null
  } catch {
    return null
  }
}

export function WithdrawCard({ account }: { account: MiraiAccount }) {
  const t = useT()
  const pendingLabel = usePendingLabel()
  const { address } = useWallet()
  const { busy, rates, runAction } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const [pocket, setPocket] = useState<Pocket>('spend')
  const [value, setValue] = useState('')
  const anyBusy = busy !== null

  const locked = Number(account.lockUntil) * 1000 > Date.now()
  const available = pocket === 'spend' ? account.spend : account.savings
  const blocked = pocket === 'savings' && locked
  const amount = tryParse(value)
  const tooMuch = amount !== null && amount > available
  const secondary = secondaryCurrencyFor(primaryCurrency, locale)
  const panel = PANEL[pocket]

  const switchPocket = (next: string) => {
    setPocket(next as Pocket)
    setValue('')
  }

  const handleWithdraw = async () => {
    if (!address) return
    if (amount === null) {
      toast.error(t('errors.invalidAmount'))
      return
    }
    const ok =
      pocket === 'spend'
        ? await runAction('spend', 'success.withdrewSpend', () => mirai.withdrawSpend(address, amount))
        : await runAction('savings', 'success.withdrewSavings', () => mirai.withdrawSavings(address, amount))
    if (ok) setValue('')
  }

  const buttonLabel =
    busy === pocket
      ? pendingLabel
      : amount === null
        ? t('withdraw.enterAmount')
        : t('withdraw.buttonAmount', { amount: formatMoney(amount, 'ausd', rates, locale) })

  return (
    <FeatureSplit
      panel={{ art: panel.art, label: t(panel.label), title: t(panel.title), body: t(panel.body) }}
    >
        <Tabs value={pocket} onValueChange={switchPocket} className="items-center">
          <TabsList className="rounded-full">
            <TabsTrigger value="spend" className="rounded-full px-5">
              {t('withdraw.spendTab')}
            </TabsTrigger>
            <TabsTrigger value="savings" className="rounded-full px-5">
              {t('withdraw.saveTab')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <TokenIcon token="ausd" size={36} />
            <div>
              <p className="font-semibold">{t(pocket === 'spend' ? 'withdraw.fromSpend' : 'withdraw.fromSave')}</p>
              <p className="font-mono text-xs text-muted-foreground">AUSD</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{formatMoney(available, primaryCurrency, rates, locale)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">~ {formatMoney(available, secondary, rates, locale)}</p>
          </div>
        </div>

        <div className={cn('mt-5 rounded-2xl border bg-muted/30 p-4', tooMuch && 'border-destructive/50')}>
          <label htmlFor="withdraw-amount" className="text-sm text-muted-foreground">
            {t('withdraw.amountLabel')}
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="withdraw-amount"
              value={value}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              disabled={anyBusy || blocked}
              onChange={(e) => setValue(e.target.value.replace(',', '.'))}
              className="min-w-0 flex-1 bg-transparent text-4xl font-semibold tracking-tight tabular-nums outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
            />
            <span className="flex shrink-0 items-center gap-2 rounded-full border bg-card py-1.5 pr-3 pl-1.5 text-sm font-medium">
              <TokenIcon token="ausd" size={24} />
              AUSD
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">~ {formatMoney(amount ?? 0n, secondary, rates, locale)}</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                {t('withdraw.available', { amount: formatMoney(available, 'ausd', rates, locale) })}
              </span>
              <button
                type="button"
                disabled={anyBusy || blocked || available === 0n}
                onClick={() => setValue(ausdToInput(available))}
                className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary-ink uppercase transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {t('withdraw.max')}
              </button>
            </span>
          </div>
        </div>

        <div className="-my-2.5 flex justify-center" aria-hidden="true">
          <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-card">
            <ArrowDownIcon className="size-4 text-muted-foreground" />
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm">
          <span className="text-muted-foreground">{t('withdraw.destination')}</span>
          <span className="font-mono text-xs">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '-'}</span>
        </div>

        {tooMuch && (
          <p className="mt-3 text-sm text-destructive">
            {t(pocket === 'spend' ? 'errors.insufficientSpendable' : 'errors.insufficientShares')}
          </p>
        )}

        <Button
          size="lg"
          className="mt-5 h-12 w-full rounded-full text-base"
          disabled={anyBusy || blocked || amount === null || tooMuch}
          onClick={() => void handleWithdraw()}
        >
          {buttonLabel}
        </Button>

        {pocket === 'savings' && (
          <div className="mt-3 space-y-2">
            {locked && (
              <p className="flex items-center gap-2 text-xs font-medium text-accent-foreground">
                <LockIcon className="size-4 shrink-0" />
                {t('withdraw.lockedReason', { date: formatDate(account.lockUntil, locale) })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('withdraw.savingsHint')}</p>
          </div>
        )}
    </FeatureSplit>
  )
}
