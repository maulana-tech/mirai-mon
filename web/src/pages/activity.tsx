import { useState } from 'react'
import { ActivityList } from '@/components/activity-list'
import { ConnectPrompt } from '@/components/connect-prompt'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ActivityItem } from '@/lib/activity'
import { useAppState } from '@/lib/app-state'
import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

type FilterKey = 'all' | 'payments' | 'withdrawals' | 'changes'

const FILTERS: { key: FilterKey; label: MessageKey; kinds: ActivityItem['kind'][] | null }[] = [
  { key: 'all', label: 'activity.filterAll', kinds: null },
  { key: 'payments', label: 'activity.filterPayments', kinds: ['pay', 'sent'] },
  { key: 'withdrawals', label: 'activity.filterWithdrawals', kinds: ['wd_spend', 'wd_save'] },
  { key: 'changes', label: 'activity.filterChanges', kinds: ['split', 'lock', 'strategy'] },
]

export function ActivityPage() {
  const { address } = useWallet()
  const { activity, activityLoading } = useAppState()
  const t = useT()
  const [filter, setFilter] = useState<FilterKey>('all')

  if (!address) return <ConnectPrompt />

  const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? null
  const items = kinds === null ? activity : activity.filter((item) => kinds.includes(item.kind))

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-white dark:text-cobalt">{t('activity.title')}</h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              variant="ghost"
              size="sm"
              aria-pressed={filter === f.key}
              className={cn(
                'rounded-full text-white/80 hover:bg-white/10 hover:text-white dark:text-cobalt/80 dark:hover:bg-cobalt/10 dark:hover:text-cobalt',
                // the active filter is a pill in the backdrop's opposite colour
                filter === f.key &&
                  'bg-white text-cobalt hover:bg-white hover:text-cobalt dark:bg-cobalt dark:text-white dark:hover:bg-cobalt dark:hover:text-white',
              )}
              onClick={() => setFilter(f.key)}
            >
              {t(f.label)}
            </Button>
          ))}
        </div>
      </div>
      <Card className="rounded-2xl shadow-none">
        <CardContent>
          <ActivityList items={items} loading={activityLoading} />
        </CardContent>
      </Card>
    </section>
  )
}
