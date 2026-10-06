import type { ActivityItem } from './types.ts'

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
      // Shares burned can exceed the replayed count once savings moved between strategy vaults (each
      // vault prices shares differently), so cap at what is held: withdrawing everything zeroes the
      // basis instead of driving it negative. ponytail: share counts across vaults are approximate;
      // track StrategySet's moved amount as the new basis if partial post-migration withdrawals drift.
      const burned = item.shares < runningShares ? item.shares : runningShares
      basis -= runningShares > 0n ? (basis * burned) / runningShares : basis
      runningShares -= burned
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

export type DailyIncome = { day: string; received: bigint; saved: bigint }

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Payments received per local day for the last `days` days (oldest first), empty days included. */
export function dailyIncome(activity: ActivityItem[], days = 30, now = new Date()): DailyIncome[] {
  const out: DailyIncome[] = []
  const index = new Map<string, DailyIncome>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const row = { day: dayKey(d), received: 0n, saved: 0n }
    out.push(row)
    index.set(row.day, row)
  }
  for (const item of activity) {
    if (item.kind !== 'pay' || item.amount === undefined) continue
    const row = index.get(dayKey(item.at))
    if (!row) continue
    row.received += item.amount
    row.saved += item.saved ?? 0n
  }
  return out
}

/** Savings principal at the end of each of the last `days` local days (oldest first), carried forward. */
export function dailySavings(activity: ActivityItem[], days = 30, now = new Date()): { day: string; saved: bigint }[] {
  const points = replaySavingsBasis(activity)
  let i = 0
  let saved = 0n
  return Array.from({ length: days }, (_, n) => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - n) + 1)
    while (i < points.length && points[i].at < end) saved = points[i++].principal
    return { day: dayKey(new Date(end.getTime() - 1)), saved }
  })
}

