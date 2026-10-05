import { useEffect } from 'react'
import {
  AlertTriangleIcon,
  DropletsIcon,
  ExternalLinkIcon,
  RefreshCcwIcon,
  WalletIcon,
} from 'lucide-react'
import { ConnectPrompt } from '@/components/connect-prompt'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUnits as ethersFormatUnits } from 'ethers'
import { toast } from 'sonner'
import { explorerAddressUrl } from '@/lib/config'
import { AUSD_DECIMALS } from '@/lib/ausd'
import { errorKey } from '@/lib/errors'
import { useT } from '@/lib/i18n'
import { useFaucet } from '@/lib/use-faucet'
import { useWallet } from '@/lib/wallet'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// balances for display only: up to 4 decimals, so 18-decimal MON stays readable
function formatUnits(wei: bigint | null, decimals: number): string {
  if (wei === null) return '—'
  return Number(ethersFormatUnits(wei, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function FaucetPage() {
  const t = useT()
  const { address } = useWallet()
  const { faucetBusy, balances, error, hasFunds, runFaucet, refreshBalances } = useFaucet()

  useEffect(() => {
    if (!address) return
    const id = setInterval(() => void refreshBalances(), 8000)
    return () => clearInterval(id)
  }, [address, refreshBalances])

  if (!address) return <ConnectPrompt />

  const explorerUrl = explorerAddressUrl(address)

  const handleClaim = async () => {
    try {
      await runFaucet()
      toast.success(t('faucet.funded'))
    } catch (e) {
      toast.error(t(errorKey(e)))
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader title={t('faucet.title')} caption={t('faucet.caption')} />

      <Card className="rounded-2xl shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <WalletIcon className="size-4" />
            {t('faucet.wallet')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-sm">{shortAddress(address)}</p>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline"
          >
            {t('faucet.viewOnExplorer')} <ExternalLinkIcon className="size-3" />
          </a>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="rounded-2xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('faucet.mon')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {balances ? (
              <p className="text-2xl font-semibold">{formatUnits(balances.mon, 18)} MON</p>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t('faucet.monCaption')}</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('faucet.ausd')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {balances ? (
              <p className="text-2xl font-semibold">{formatUnits(balances.ausd, AUSD_DECIMALS)} AUSD</p>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t('faucet.ausdCaption')}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{t('errors.loadFailed')}</p>
            <p className="text-xs opacity-90">{error}</p>
          </div>
        </div>
      )}

      <Card className="rounded-2xl shadow-none">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-ink">
              <DropletsIcon className="size-5" />
            </div>
            <div>
              <h3 className="font-medium">{t('faucet.claimTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('faucet.claimCaption')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" disabled={faucetBusy} onClick={() => void handleClaim()}>
              {faucetBusy ? (
                <RefreshCcwIcon className="mr-2 size-4 animate-spin" />
              ) : (
                <DropletsIcon className="mr-2 size-4" />
              )}
              {t('faucet.claimButton')}
            </Button>
            <Button variant="outline" onClick={() => void refreshBalances()}>
              <RefreshCcwIcon className="mr-2 size-4" />
              {t('common.refresh')}
            </Button>
          </div>

          <a
            href="https://faucet.monad.xyz"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            {t('faucet.fallback')} <ExternalLinkIcon className="size-3" />
          </a>

          {hasFunds && (
            <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary-ink">
              {t('faucet.ready')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
