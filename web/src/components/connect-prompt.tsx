import { ConnectButton } from '@/components/connect-button'
import { useT } from '@/lib/i18n'

export function ConnectPrompt() {
  const t = useT()

  return (
    <div className="flex flex-col items-center py-20 text-center">
      <h2 className="text-2xl font-semibold tracking-tight text-white dark:text-cobalt">{t('dashboard.connectTitle')}</h2>
      <p className="mt-2 max-w-md text-white/70 dark:text-cobalt/70">{t('dashboard.connectCaption')}</p>
      <div className="mt-6">
        <ConnectButton className="bg-white text-cobalt hover:bg-white/90 dark:bg-cobalt dark:text-white dark:hover:bg-cobalt/90" />
      </div>
    </div>
  )
}
