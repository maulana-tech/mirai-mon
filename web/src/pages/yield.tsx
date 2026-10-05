import { RefreshCwIcon } from 'lucide-react'
import { AccountPanel } from '@/components/account-panel'
import { ConnectPrompt } from '@/components/connect-prompt'
import { PageHeader } from '@/components/page-header'
import { ProjectionCard } from '@/components/projection-card'
import { SmartMoneyCard } from '@/components/smart-money-card'
import { StrategyPicker } from '@/components/strategy-picker'
import { Button } from '@/components/ui/button'
import { YieldPositionCard } from '@/components/yield-position-card'
import { useAppState } from '@/lib/app-state'
import { useT } from '@/lib/i18n'
import { DEFAULT_APR_BPS, isMarket } from '@/lib/strategies'
import { useStrategies } from '@/lib/use-strategies'
import { useWallet } from '@/lib/wallet'

export function YieldPage() {
  const { address } = useWallet()
  const { account, accountStatus, activity, rates, refresh } = useAppState()
  const { strategies, loading, refresh: refreshStrategies } = useStrategies()
  const t = useT()

  if (!address) return <ConnectPrompt />

  const aprBps = account
    ? (strategies?.find((s) => s.id === account.strategy)?.aprBps ?? DEFAULT_APR_BPS[account.strategy])
    : 0
  const reload = () => {
    void refresh()
    void refreshStrategies()
  }

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title={t('nav.yield')} caption={t('page.yieldCaption')} />
        <Button variant="outline" size="icon-sm" aria-label={t('yield.refresh')} disabled={loading} onClick={reload}>
          <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <YieldPositionCard
        account={account}
        activity={activity}
        loading={accountStatus === 'loading'}
        rates={rates}
        aprBps={aprBps}
      />
      <AccountPanel>
        {(acc) => (
          <>
            <StrategyPicker account={acc} strategies={strategies} onChanged={reload} />
            <SmartMoneyCard active={isMarket(acc.strategy)} />
            <ProjectionCard account={acc} strategies={strategies} />
          </>
        )}
      </AccountPanel>
    </section>
  )
}
