import { useState } from 'react'
import { CircleCheckIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { CoinIcon } from '@/components/brand/coin-icon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { useAppState } from '@/lib/app-state'
import { MEME_ACK_BPS, PRESET_MIX, bpsFromMix, memeBps, presetOf, type PresetId } from '@/lib/basket'
import { intlLocale, useT, type MessageKey } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { useSettings } from '@/lib/settings'
import { MARKET_STRATEGY } from '@/lib/strategies'
import type { BasketAssetKind, BasketState, Pocket } from '@/lib/types'
import { usePendingLabel } from '@/lib/use-pending-label'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

const PRESETS: { id: PresetId; label: MessageKey; caption: MessageKey }[] = [
  { id: 'smart', label: 'basket.presetSmart', caption: 'basket.presetSmartCaption' },
  { id: 'blue', label: 'basket.presetBlue', caption: 'basket.presetBlueCaption' },
  { id: 'careful', label: 'basket.presetCareful', caption: 'basket.presetCarefulCaption' },
  { id: 'custom', label: 'basket.presetCustom', caption: 'basket.presetCustomCaption' },
]
const KIND_COLOR: Record<BasketAssetKind, string> = {
  stable: 'bg-muted-foreground/40',
  blue: 'bg-primary',
  meme: 'bg-destructive/80',
}
const KIND_LABEL: Record<BasketAssetKind, MessageKey> = {
  stable: 'basket.groupStable',
  blue: 'basket.groupBlue',
  meme: 'basket.groupMeme',
}

/** Pick how a pocket's invested savings are split: follow Smart Money, a ready mix, or your own. */
export function BasketCard({
  pocket,
  basket,
  logos = {},
  onChanged,
}: {
  pocket: Pocket
  basket: BasketState | null
  /** Remote logos by symbol (DexScreener, via /api/market) for coins without a bundled icon. */
  logos?: Record<string, string>
  onChanged: () => void
}) {
  const t = useT()
  const { locale } = useSettings()
  const { address } = useWallet()
  const { busy, runAction, refresh } = useAppState()
  const pendingLabel = usePendingLabel()
  const intl = intlLocale(locale)
  const [picked, setPicked] = useState<PresetId | null>(null)
  const [draft, setDraft] = useState<number[] | null>(null)
  const [ack, setAck] = useState(false)

  if (!basket) {
    return (
      <Card className="rounded-2xl shadow-none">
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    )
  }

  const { assets } = basket
  const mine = basket.mine
  const invested = pocket.strategy === MARKET_STRATEGY
  const current = presetOf(assets, mine?.bps ?? basket.smartBps, mine?.custom ?? false)
  const preset = picked ?? current
  const bps =
    preset === 'smart'
      ? basket.smartBps
      : preset === 'custom'
        ? (draft ?? mine?.bps ?? basket.smartBps)
        : bpsFromMix(assets, PRESET_MIX[preset])
  const total = bps.reduce((a, b) => a + b, 0)
  const meme = memeBps(assets, bps)
  const unpriced = assets.filter((a, i) => bps[i] > 0 && a.priceUsd === 0)
  const unchanged = invested && preset === current && (preset !== 'custom' || draft === null)
  const valid = total === 10_000 && unpriced.length === 0 && (meme <= MEME_ACK_BPS || ack)
  const held = mine?.valueUsd ?? []
  const heldTotal = held.reduce((a, b) => a + b, 0)
  const pending = busy === 'basket'

  const usd = (n: number, digits = 2) =>
    new Intl.NumberFormat(intl, { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(n)
  const price = (n: number) =>
    new Intl.NumberFormat(intl, {
      style: 'currency',
      currency: 'USD',
      maximumSignificantDigits: n < 1 ? 3 : undefined,
      maximumFractionDigits: n < 1 ? undefined : 2,
    }).format(n)
  const pct = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`
  const setWeight = (i: number, pctValue: number) => {
    const next = [...bps]
    next[i] = Math.max(0, Math.min(100, Math.round(pctValue))) * 100
    setDraft(next)
    setPicked('custom')
  }

  const save = async () => {
    if (!address) return
    const ok = await runAction('basket', 'basket.saved', async () => {
      // Moving into the invest strategy first means the new mix applies to the savings moved over.
      let last = invested ? null : await mirai.setPocketStrategy(address, pocket.id, MARKET_STRATEGY)
      const wantsCustom = preset !== 'smart'
      if (wantsCustom || mine?.custom)
        last = await mirai.setBasketWeights(address, pocket.id, wantsCustom ? bps : null)
      return last!
    })
    if (ok) {
      setPicked(null)
      setDraft(null)
      setAck(false)
      onChanged()
      void refresh()
    }
  }

  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>{t('basket.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('basket.caption')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              onClick={() => {
                setPicked(p.id)
                if (p.id !== 'custom') setDraft(null)
              }}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                preset === p.id ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {t(p.label)}
                {invested && current === p.id && <CircleCheckIcon className="size-4 text-primary-ink" />}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(p.caption)}</span>
            </button>
          ))}
        </div>

        {/* the mix */}
        <div className="space-y-2">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {assets.map((a, i) =>
              bps[i] > 0 ? (
                <div
                  key={a.symbol}
                  className={cn('h-full border-r border-card last:border-r-0', KIND_COLOR[a.kind])}
                  style={{ width: `${bps[i] / 100}%` }}
                  title={`${a.symbol} ${pct(bps[i])}`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assets.map((a, i) =>
              bps[i] > 0 ? (
                <span
                  key={a.symbol}
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums"
                >
                  <CoinIcon symbol={a.symbol} size={14} fallbackSrc={logos[a.symbol]} />
                  {a.symbol} {pct(bps[i])}
                </span>
              ) : null,
            )}
          </div>
        </div>

        {preset === 'custom' && (
          <div className="space-y-4">
            {(['stable', 'blue', 'meme'] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <p
                  className={cn(
                    'text-[11px] font-medium tracking-wider uppercase',
                    kind === 'meme' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {t(KIND_LABEL[kind])}
                </p>
                {assets.map((a, i) =>
                  a.kind === kind ? (
                    <div key={a.symbol} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3">
                      <span className="flex items-center gap-2 text-sm">
                        <CoinIcon symbol={a.symbol} size={24} fallbackSrc={logos[a.symbol]} />
                        <span className="min-w-0">
                          <span className="block font-medium">{a.symbol}</span>
                          <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                            {a.priceUsd > 0 ? price(a.priceUsd) : t('basket.noPrice')}
                          </span>
                        </span>
                      </span>
                      <Slider
                        value={[bps[i] / 100]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(v) => setWeight(i, v[0])}
                        aria-label={a.symbol}
                      />
                      <div className="relative">
                        <Input
                          inputMode="numeric"
                          value={String(bps[i] / 100)}
                          onChange={(e) => setWeight(i, Number(e.target.value.replace(/\D/g, '')) || 0)}
                          className="pr-6 text-right tabular-nums"
                          aria-label={`${a.symbol} %`}
                        />
                        <span className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                          %
                        </span>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">{t('pool.total')}</span>
              <span className={cn('font-semibold tabular-nums', total !== 10_000 && 'text-destructive')}>
                {pct(total)} {total !== 10_000 && `· ${t('pool.mustBe100')}`}
              </span>
            </div>
          </div>
        )}

        {meme > 0 && (
          <div className="space-y-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
            <p className="flex gap-2">
              <TriangleAlertIcon className="size-4 shrink-0" />
              <span>{t('basket.memeRisk', { pct: pct(meme) })}</span>
            </p>
            {meme > MEME_ACK_BPS && (
              <label className="flex cursor-pointer items-start gap-2 pl-6 font-medium">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 size-4 accent-current"
                />
                {t('basket.memeAck')}
              </label>
            )}
          </div>
        )}
        {unpriced.length > 0 && (
          <p className="text-xs text-destructive">
            {t('basket.unpriced', { coins: unpriced.map((a) => a.symbol).join(', ') })}
          </p>
        )}

        {invested && heldTotal > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {t('basket.holdingNow', { total: usd(heldTotal) })}
            </p>
            <ul className="divide-y rounded-xl border text-sm">
              {assets.map((a, i) =>
                held[i] >= 0.005 ? (
                  <li key={a.symbol} className="flex items-center justify-between px-3 py-2 tabular-nums">
                    <span className="flex items-center gap-2 font-medium">
                      <CoinIcon symbol={a.symbol} size={20} fallbackSrc={logos[a.symbol]} />
                      {a.symbol}
                    </span>
                    <span>{usd(held[i])}</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}

        {address ? (
          <Button
            className="w-full rounded-full"
            disabled={busy !== null || unchanged || !valid}
            onClick={() => void save()}
          >
            {pending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {pending
              ? pendingLabel
              : unchanged
                ? t('basket.current')
                : invested
                  ? t('basket.save')
                  : pocket.value > 0n
                    ? t('basket.moveAndSave')
                    : t('basket.startAndSave')}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('pool.signInToInvest')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('basket.note')}</p>
      </CardContent>
    </Card>
  )
}
