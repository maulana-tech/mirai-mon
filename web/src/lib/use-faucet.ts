import { useCallback, useEffect, useState } from 'react'
import { getNativeBalance } from '@/lib/balances'
import { getAusdBalance, AUSD_SCALE } from '@/lib/ausd'
import { useWallet } from '@/lib/wallet'

const FAUCET_STORAGE_KEY = 'mirai:faucet:v1'

// Enough MON for a handful of transactions; matches the onboarding drip floor.
const MIN_MON = 10n ** 17n // 0.1 MON
const MIN_AUSD = 1n * AUSD_SCALE

export type FaucetBalance = {
  mon: bigint
  ausd: bigint
}

export function faucetedFlag(address: string): boolean {
  try {
    const raw = localStorage.getItem(FAUCET_STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as Record<string, boolean>
    return data[address.toLowerCase()] === true
  } catch {
    return false
  }
}

function setFaucetedFlag(address: string, value: boolean) {
  try {
    const raw = localStorage.getItem(FAUCET_STORAGE_KEY)
    const data = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    data[address.toLowerCase()] = value
    localStorage.setItem(FAUCET_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

/** Asks /api/onboard to top up gas and test AUSD for `address`. */
export async function requestTestFunds(address: string): Promise<{ mon: boolean; ausd: boolean }> {
  const res = await fetch('/api/onboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  // A non-JSON reply means no /api behind this host (e.g. a static preview without functions).
  if (!res.headers.get('content-type')?.includes('json')) throw new Error('faucet_unavailable')
  const body = (await res.json()) as { mon: boolean; ausd: boolean; error?: string }
  if (!res.ok) throw new Error(body.error ?? 'faucet_unavailable')
  return body
}

export function useFaucet(): {
  faucetBusy: boolean
  balances: FaucetBalance | null
  error: string | null
  hasFunds: boolean
  runFaucet: () => Promise<void>
  refreshBalances: () => Promise<void>
} {
  const { address } = useWallet()
  const [balances, setBalances] = useState<FaucetBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [faucetBusy, setFaucetBusy] = useState(false)

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setBalances(null)
      setError(null)
      return
    }
    setError(null)
    try {
      const [mon, ausd] = await Promise.all([getNativeBalance(address), getAusdBalance(address)])
      setBalances({ mon, ausd })
      setFaucetedFlag(address, mon >= MIN_MON && ausd >= MIN_AUSD)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'balance_fetch_failed')
      setBalances(null)
    }
  }, [address])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  const runFaucet = useCallback(async () => {
    if (!address) return
    setFaucetBusy(true)
    try {
      await requestTestFunds(address)
      await refreshBalances()
    } finally {
      setFaucetBusy(false)
    }
  }, [address, refreshBalances])

  const hasFunds = balances
    ? balances.mon >= MIN_MON && balances.ausd >= MIN_AUSD
    : faucetedFlag(address ?? '')

  return { faucetBusy, balances, error, hasFunds, runFaucet, refreshBalances }
}
