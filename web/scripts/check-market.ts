// Basket weights from Nansen holdings: `node scripts/check-market.ts`
import assert from 'node:assert/strict'
import { weightsFrom } from '../api/market.ts'

const h = (symbol: string, valueUsd: number) => ({ symbol, valueUsd, change24hPct: 0, holders: 1, sharePct: 0 })

assert.deepEqual(weightsFrom([]), [5000, 5000]) // no data: even split
assert.deepEqual(weightsFrom([h('WBTC', 300), h('WETH', 100), h('MON', 1e9)]), [6500, 3500]) // MON ignored
assert.deepEqual(weightsFrom([h('WETH', 1)]), [2000, 8000]) // floor keeps 20% in BTC
assert.deepEqual(weightsFrom([h('wbtc', 1), h('WETH', 6)]), [2858, 7142]) // rounding dust to BTC, sums to 10k
console.log('check-market ok')
