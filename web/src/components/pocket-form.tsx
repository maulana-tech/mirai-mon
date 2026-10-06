import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { POCKET_ICONS } from '@/components/pocket-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useAppState } from '@/lib/app-state'
import { errorKey } from '@/lib/errors'
import { ausdToInput, parseAusd } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { mirai } from '@/lib/mirai'
import { encryptMeta } from '@/lib/pocket-meta'
import { sharesWith } from '@/lib/pockets'
import { MARKET_STRATEGY, STRATEGIES } from '@/lib/strategies'
import type { MiraiAccount, Pocket, PocketMeta, StrategyId } from '@/lib/types'
import { usePendingLabel } from '@/lib/use-pending-label'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

const ICONS = Object.keys(POCKET_ICONS)

type Props = {
  account: MiraiAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this pocket's label; omitted = create a new pocket. */
  pocket?: Pocket
  meta?: PocketMeta
  /** New pocket: start as invest (true) or yield (false). */
  invest?: boolean
}

/** Create a pocket, or rename one. The label is encrypted with the passkey before it goes on-chain. */
export function PocketForm({ account, open, onOpenChange, pocket, meta, invest = false }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const { address } = useWallet()
  const { busy, runAction } = useAppState()
  const pendingLabel = usePendingLabel()
  const editing = pocket !== undefined
  const [name, setName] = useState(meta?.name ?? '')
  const [icon, setIcon] = useState(meta?.icon && POCKET_ICONS[meta.icon] ? meta.icon : invest ? 'invest' : 'laptop')
  const [target, setTarget] = useState(meta && meta.target > 0n ? ausdToInput(meta.target) : '')
  const [strategy, setStrategy] = useState<StrategyId>(invest ? MARKET_STRATEGY : 1)
  const [share, setShare] = useState(20)
  const [encrypting, setEncrypting] = useState(false)

  let targetUnits: bigint | null = 0n
  try {
    targetUnits = target.trim() === '' ? 0n : parseAusd(target)
  } catch {
    targetUnits = null
  }
  const valid = name.trim() !== '' && targetUnits !== null && targetUnits >= 0n
  const pending = encrypting || busy === 'pocket-form'

  const submit = async () => {
    if (!address || !valid) return
    // encrypting runs the passkey once per session; do it before the transaction prompt
    let encrypted: string
    setEncrypting(true)
    try {
      encrypted = await encryptMeta({ name, icon, target: targetUnits ?? 0n })
    } catch (e) {
      toast.error(t(errorKey(e)))
      return
    } finally {
      setEncrypting(false)
    }
    const done = editing
      ? await runAction('pocket-form', 'pockets.saved', () => mirai.setPocketMeta(address, pocket.id, encrypted))
      : await runAction('pocket-form', 'pockets.created', async () => {
          const created = await mirai.createPocket(address, strategy, encrypted)
          if (share > 0) {
            const fresh: Pocket = { ...account.pockets[0], id: created.id, shareBps: 0 }
            await mirai.setPocketShares(address, sharesWith([...account.pockets, fresh], created.id, share * 100))
          }
          return created
        })
    if (!done) return
    onOpenChange(false)
    if (!editing && 'id' in done) void navigate(`/app/pockets/${done.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('pockets.editTitle') : t('pockets.newTitle')}</DialogTitle>
          <DialogDescription>{t('pockets.formCaption')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('pockets.iconLabel')}>
            {ICONS.map((key) => {
              const Icon = POCKET_ICONS[key]
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={icon === key}
                  aria-label={key}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl border text-muted-foreground transition-colors',
                    icon === key ? 'border-primary bg-primary/10 text-primary-ink' : 'hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px]" />
                </button>
              )
            })}
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t('pockets.nameLabel')}</span>
            <Input
              value={name}
              maxLength={40}
              placeholder={t('pockets.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">{t('pockets.targetLabel')}</span>
            <Input
              value={target}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => setTarget(e.target.value.replace(',', '.'))}
            />
          </label>

          {!editing && (
            <>
              <div className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">{t('pockets.typeLabel')}</span>
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={strategy === s.id}
                      onClick={() => setStrategy(s.id)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left',
                        strategy === s.id ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                      )}
                    >
                      <span className="block font-medium">{t(s.name)}</span>
                      <span className="block text-xs text-muted-foreground">{t(s.risk)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">{t('pockets.shareLabel')}</span>
                  <span className="text-lg font-semibold tabular-nums">{share}%</span>
                </div>
                <Slider value={[share]} min={0} max={100} step={5} onValueChange={(v) => setShare(v[0])} />
                <p className="text-xs text-muted-foreground">{t('pockets.shareHint')}</p>
              </div>
            </>
          )}

          <p className="flex gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-4 shrink-0 text-primary-ink" />
            {t('pockets.encryptHint')}
          </p>
          <Button className="h-11 w-full rounded-full" disabled={!valid || pending} onClick={() => void submit()}>
            {pending ? pendingLabel : editing ? t('pockets.saveLabel') : t('pockets.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
