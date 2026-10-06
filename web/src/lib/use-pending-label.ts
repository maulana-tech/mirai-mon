import { useT } from '@/lib/i18n'
import { useWallet } from '@/lib/wallet'

/** Button text while an action runs: asks for the passkey while its prompt is open, so nobody stares at "Loading". */
export function usePendingLabel(): string {
  const t = useT()
  const { connecting } = useWallet()
  return connecting ? t('common.confirmPasskey') : t('common.working')
}
