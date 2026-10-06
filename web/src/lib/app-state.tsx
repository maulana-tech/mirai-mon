import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { fetchActivity, type ActivityItem } from '@/lib/activity'
import { getAusdBalance } from '@/lib/ausd'
import { mirai } from '@/lib/mirai'
import { explorerTxUrl } from '@/lib/config'
import { errorKey } from '@/lib/errors'
import { shortHex } from '@/lib/format'
import { useT, type MessageKey } from '@/lib/i18n'
import { FALLBACK_RATES, getFxRates, type FxRates } from '@/lib/rates'
import type { MiraiAccount } from '@/lib/types'
import { useWallet } from '@/lib/wallet'

type AccountStatus = 'disconnected' | 'loading' | 'ready' | 'error'

type AppStateValue = {
  account: MiraiAccount | null
  /** AUSD in the user's own account (outside Mirai's pockets): onboarding funds, withdrawals, money to pay with. */
  wallet: bigint | null
  accountStatus: AccountStatus
  rates: FxRates
  activity: ActivityItem[]
  activityLoading: boolean
  /** Activity is the full history and has finished loading (required for principal/earnings). */
  historyComplete: boolean
  busy: string | null
  refresh: () => Promise<void>
  runAction: <T extends { hash: string }>(
    key: string,
    successKey: MessageKey,
    fn: () => Promise<T>,
  ) => Promise<T | null>
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet()
  const t = useT()
  const [account, setAccount] = useState<MiraiAccount | null>(null)
  const [wallet, setWallet] = useState<bigint | null>(null)
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('disconnected')
  const [rates, setRates] = useState<FxRates>(FALLBACK_RATES)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [historyFull, setHistoryFull] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const addressRef = useRef(address)

  useEffect(() => {
    void getFxRates().then(setRates)
  }, [])

  const load = useCallback(async (addr: string, initial: boolean) => {
    if (initial) {
      setAccount(null)
      setWallet(null)
      setAccountStatus('loading')
      setActivity([])
      setActivityLoading(true)
    }
    const [accountResult, activityResult, walletResult] = await Promise.allSettled([
      mirai.getAccount(addr),
      fetchActivity(addr),
      getAusdBalance(addr),
    ])
    if (addressRef.current !== addr) return
    if (walletResult.status === 'fulfilled') setWallet(walletResult.value)
    if (accountResult.status === 'fulfilled') {
      setAccount(accountResult.value)
      setAccountStatus('ready')
    } else {
      if (initial) setAccount(null) // keep stale data on refresh failure so cards stay usable
      setAccountStatus('error')
    }
    if (activityResult.status === 'fulfilled') {
      setActivity(activityResult.value.items)
      setHistoryFull(activityResult.value.complete)
    } else {
      setHistoryFull(false)
    }
    setActivityLoading(false)
  }, [])

  useEffect(() => {
    addressRef.current = address
    if (!address) {
      setAccount(null)
      setWallet(null)
      setAccountStatus('disconnected')
      setActivity([])
      setActivityLoading(false)
      setBusy(null)
      return
    }
    void load(address, true)
  }, [address, load])

  const refresh = useCallback(async () => {
    if (addressRef.current) await load(addressRef.current, false)
  }, [load])

  const runAction = useCallback(
    async <T extends { hash: string }>(
      key: string,
      successKey: MessageKey,
      fn: () => Promise<T>,
    ): Promise<T | null> => {
      if (!address) {
        toast.error(t('common.connectFirst'))
        return null
      }
      setBusy(key)
      try {
        const result = await fn()
        // The receipt is final on Monad, so refresh right away; a follow-up refresh covers an RPC
        // node that is a block behind.
        await load(address, false)
        setTimeout(() => void load(address, false), 1500)
        const hash = result.hash
        toast.success(t(successKey), {
          description: hash ? shortHex(hash) : undefined,
          action: hash
            ? {
                label: t('common.viewTx'),
                onClick: () => window.open(explorerTxUrl(hash), '_blank', 'noopener,noreferrer'),
              }
            : undefined,
        })
        return result
      } catch (e) {
        toast.error(t(errorKey(e)))
        return null
      } finally {
        setBusy(null)
      }
    },
    [address, load, t],
  )

  const value = useMemo(
    () => ({
      account,
      wallet,
      accountStatus,
      rates,
      activity,
      activityLoading,
      historyComplete: historyFull && !activityLoading,
      busy,
      refresh,
      runAction,
    }),
    [account, wallet, accountStatus, rates, activity, activityLoading, historyFull, busy, refresh, runAction],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
