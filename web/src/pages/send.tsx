import { useEffect, useState } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { AddressAvatar } from '@/components/brand/address-avatar'
import { TokenIcon } from '@/components/brand/token-icon'
import { ConnectPrompt } from '@/components/connect-prompt'
import { FeatureSplit } from '@/components/feature-split'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { isValidRecipientAddress } from '@/lib/address'
import { getAusdBalance } from '@/lib/ausd'
import { useAppState } from '@/lib/app-state'
import { CONTRACT_ID } from '@/lib/config'
import { parseAusd } from '@/lib/format'
import { formatMoney, useT } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { secondaryCurrencyFor, useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

// Accepts a bare address or a pasted Mirai payment link (…/pay/0x…?amount=…).
function parseRecipient(raw: string): { address: string; amount?: string } | null {
  const text = raw.trim()
  if (isValidRecipientAddress(text)) return { address: text }
  try {
    const url = new URL(text)
    const match = /\/pay\/(0x[0-9a-fA-F]{40})/.exec(url.pathname)
    if (match && isValidRecipientAddress(match[1])) {
      return { address: match[1], amount: url.searchParams.get('amount') ?? undefined }
    }
  } catch {
    // not a URL
  }
  return null
}

function tryParse(raw: string): bigint | null {
  try {
    const v = parseAusd(raw)
    return v > 0n ? v : null
  } catch {
    return null
  }
}

/** Send AUSD to any Mirai user; their split rule saves part of it the moment it lands. */
export function SendPage() {
  const t = useT()
  const { address } = useWallet()
  const { busy, rates, runAction } = useAppState()
  const { locale, primaryCurrency } = useSettings()
  const [to, setTo] = useState('')
  const [value, setValue] = useState('')
  // Until the user types an amount, it follows the amount carried by a pasted payment link.
  const [amountTouched, setAmountTouched] = useState(false)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [splitPct, setSplitPct] = useState<number | null>(null)

  const recipient = parseRecipient(to)
  const amount = tryParse(value)
  const tooMuch = amount !== null && balance !== null && amount > balance
  const secondary = secondaryCurrencyFor(primaryCurrency, locale)

  useEffect(() => {
    // the in-memory mock has no real balance to check against
    if (!address || CONTRACT_ID === '') return
    void getAusdBalance(address).then(setBalance, () => setBalance(null))
  }, [address, busy])

  useEffect(() => {
    setSplitPct(null)
    if (!recipient) return
    let active = true
    mirai.getAccount(recipient.address).then(
      (acc) => active && setSplitPct(Math.round(acc.splitBps / 100)),
      () => {},
    )
    return () => {
      active = false
    }
  }, [recipient?.address])

  if (!address) return <ConnectPrompt />

  const onRecipientChange = (raw: string) => {
    setTo(raw)
    const parsed = parseRecipient(raw)
    if (!amountTouched) setValue(parsed?.amount ?? '')
  }

  const send = async () => {
    if (!recipient || amount === null) {
      toast.error(t(recipient ? 'errors.invalidAmount' : 'send.invalidRecipient'))
      return
    }
    const ok = await runAction('send', 'send.sent', () => mirai.pay(address, recipient.address, amount))
    if (ok) {
      setValue('')
      setAmountTouched(false)
    }
  }

  const buttonLabel =
    busy === 'send'
      ? `${t('common.loading')}...`
      : amount === null
        ? t('withdraw.enterAmount')
        : t('send.button', { amount: formatMoney(amount, 'ausd', rates, locale) })

  return (
    <section className="space-y-5">
      <PageHeader title={t('nav.send')} caption={t('page.sendCaption')} />
      <FeatureSplit
        panel={{ art: 'split', label: t('send.panelLabel'), title: t('send.panelTitle'), body: t('send.panelBody') }}
      >
        <div className={cn('rounded-2xl border bg-muted/30 p-4', tooMuch && 'border-destructive/50')}>
          <label htmlFor="send-amount" className="text-sm text-muted-foreground">
            {t('withdraw.amountLabel')}
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="send-amount"
              value={value}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              disabled={busy !== null}
              onChange={(e) => {
                setAmountTouched(true)
                setValue(e.target.value.replace(',', '.'))
              }}
              className="min-w-0 flex-1 bg-transparent text-4xl font-semibold tracking-tight tabular-nums outline-none placeholder:text-muted-foreground/50"
            />
            <span className="flex shrink-0 items-center gap-2 rounded-full border bg-card py-1.5 pr-3 pl-1.5 text-sm font-medium">
              <TokenIcon token="ausd" size={24} />
              AUSD
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">~ {formatMoney(amount ?? 0n, secondary, rates, locale)}</span>
            {balance !== null && (
              <span className="tabular-nums">
                {t('send.balance', { amount: formatMoney(balance, 'ausd', rates, locale) })}
              </span>
            )}
          </div>
        </div>

        <div className="-my-2.5 flex justify-center" aria-hidden="true">
          <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-card">
            <ArrowDownIcon className="size-4 text-muted-foreground" />
          </span>
        </div>

        <div className={cn('rounded-2xl border p-4', to !== '' && !recipient && 'border-destructive/50')}>
          <label htmlFor="send-to" className="text-sm text-muted-foreground">
            {t('send.toLabel')}
          </label>
          <div className="mt-1 flex items-center gap-2">
            {recipient && <AddressAvatar address={recipient.address} size={24} className="shrink-0 rounded-md" />}
            <input
              id="send-to"
              value={to}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('send.toPlaceholder')}
              disabled={busy !== null}
              onChange={(e) => onRecipientChange(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground/60"
            />
          </div>
          {recipient && splitPct !== null && (
            <p className="mt-2 text-xs text-primary-ink">{t('pay.splitInfo', { pct: splitPct })}</p>
          )}
        </div>

        {tooMuch && <p className="mt-3 text-sm text-destructive">{t('errors.insufficientBalance')}</p>}

        <Button
          size="lg"
          className="mt-5 h-12 w-full rounded-full text-base"
          disabled={busy !== null || !recipient || amount === null || tooMuch}
          onClick={() => void send()}
        >
          {buttonLabel}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">{t('pay.signHint')}</p>
      </FeatureSplit>
    </section>
  )
}
