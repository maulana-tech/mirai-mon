import { useCallback, useEffect, useRef, useState } from 'react'
import type { StrategyStats } from '@/lib/types'
import { mirai } from '@/lib/mirai'

/** Live per-strategy numbers (APR, TVL, share price) read from chain. */
export function useStrategies() {
  const [strategies, setStrategies] = useState<StrategyStats[] | null>(null)
  const [loading, setLoading] = useState(true)
  const runId = useRef(0)

  const load = useCallback(async () => {
    const id = ++runId.current
    setLoading(true)
    try {
      const next = await mirai.getStrategies()
      if (runId.current === id) setStrategies(next)
    } catch {
      if (runId.current === id) setStrategies(null)
    } finally {
      if (runId.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { strategies, loading, refresh: load }
}
