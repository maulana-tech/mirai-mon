// node scripts/check-pockets.ts — share redistribution when a pocket is created or resized.
import assert from 'node:assert/strict'
import { sharesWith } from '../src/lib/pockets.ts'
import type { Pocket } from '../src/lib/types.ts'

const p = (id: number, shareBps: number) => ({ id, shareBps, strategy: 1, lockUntil: 0n, shares: 0n, value: 0n, meta: '0x' }) as Pocket
const sum = (r: Record<number, number>) => Object.values(r).reduce((a, b) => a + b, 0)

let r = sharesWith([p(0, 10_000), p(1, 0)], 1, 3000)
assert.deepEqual(r, { 0: 7000, 1: 3000 })
r = sharesWith([p(0, 5000), p(1, 3000), p(2, 2000), p(3, 0)], 3, 2500)
assert.equal(sum(r), 10_000)
assert.equal(r[3], 2500)
assert.ok(r[0] > r[1] && r[1] > r[2])
r = sharesWith([p(0, 3333), p(1, 3333), p(2, 3334)], 1, 10_000)
assert.deepEqual(r, { 0: 0, 1: 10_000, 2: 0 })
r = sharesWith([p(0, 0), p(4, 0)], 4, 4000) // others had nothing: split the rest evenly
assert.deepEqual(r, { 0: 6000, 4: 4000 })
console.log('pockets ok')
