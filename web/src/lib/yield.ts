import type { ActivityItem } from '@/lib/activity'

export type SavingsPosition = {
  /** AUSD put into savings, minus the cost basis of what was withdrawn. Null without full history. */
  principal: bigint | null
  currentValue: bigint
  earnings: bigint | null
}

export type SavingsHistoryPoint = {
  at: Date
  principal: bigint
}

// Replays deposits and withdrawals (oldest first) to track the cost basis of the shares still held.
function replaySavingsBasis(activity: ActivityItem[]): SavingsHistoryPoint[] {
  const oldestFirst = [...activity].reverse()
  let runningShares = 0n
  let basis = 0n
  const points: SavingsHistoryPoint[] = []
  for (const item of oldestFirst) {
    if (item.kind === 'pay' && item.saved !== undefined && item.shares !== undefined && item.shares > 0n) {
      runningShares += item.shares
      basis += item.saved
      points.push({ at: item.at, principal: basis })
    } else if (item.kind === 'wd_save' && item.shares !== undefined) {
      if (runningShares > 0n) basis -= (basis * item.shares) / runningShares
      runningShares -= item.shares
      if (runningShares < 0n) runningShares = 0n
      points.push({ at: item.at, principal: basis })
    }
  }
  return points
}

/**
 * `currentValue` comes from the contract (accountOf.savings) and is always exact. Principal and
 * earnings need every deposit, so they are only reported when `historyComplete` (full indexer
 * history, finished loading); otherwise a partial replay would overstate earnings.
 */
export function computeSavingsPosition(
  activity: ActivityItem[],
  currentValue: bigint,
  historyComplete: boolean,
): SavingsPosition {
  if (!historyComplete) return { principal: null, currentValue, earnings: null }
  const points = replaySavingsBasis(activity)
  const principal = points.length > 0 ? points[points.length - 1].principal : 0n
  const earnings = currentValue - principal
  // Yield vaults round a few base units against the saver; a real loss only happens in the market basket.
  return { principal, currentValue, earnings: earnings < 0n && earnings > -10n ? 0n : earnings }
}

export function savingsHistory(activity: ActivityItem[]): SavingsHistoryPoint[] {
  return replaySavingsBasis(activity)
}
