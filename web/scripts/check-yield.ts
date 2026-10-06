// Savings basis replay: `node scripts/check-yield.ts`
import assert from 'node:assert/strict'
import { computeSavingsPosition, dailyIncome } from '../src/lib/yield.ts'

const at = (min: number) => new Date(Date.UTC(2026, 9, 6, 10, min))
// newest first, like the feed: pay 25 (5 saved, 5e12 shares), migrate, withdraw everything (more shares than replayed)
const activity = [
  { id: 'w', kind: 'wd_save', txHash: '', at: at(3), shares: 5_000_004_000_000n, amount: 5_000_004n },
  { id: 's', kind: 'strategy', txHash: '', at: at(2), strategy: 3, amount: 5_000_000n },
  { id: 'p', kind: 'pay', txHash: '', at: at(1), amount: 25_000_000n, saved: 5_000_000n, shares: 4_998_845_694_633n },
] as unknown as Parameters<typeof computeSavingsPosition>[0]

const pos = computeSavingsPosition(activity, 0n, true)
assert.equal(pos.principal, 0n) // never negative after a full withdrawal
assert.equal(pos.earnings, 0n)

const days = dailyIncome(activity, 3, new Date(Date.UTC(2026, 9, 6, 23)))
assert.equal(days.length, 3)
assert.equal(days.reduce((s, d) => s + d.received, 0n), 25_000_000n)
console.log('check-yield ok')
