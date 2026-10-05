// Pool simulator math: `node scripts/check-pool.ts`
import assert from 'node:assert/strict'
import { backtest, normalizeWeights, projectRange } from '../src/lib/pool.ts'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

assert.equal(normalizeWeights({ BTC: 70, ETH: 20, AUSD: 10 }).valid, true)
assert.equal(normalizeWeights({ BTC: 70, ETH: 20 }).valid, false)
assert.deepEqual(normalizeWeights({ BTC: 50, ETH: 0, AUSD: 50 }).weights, { BTC: 50, AUSD: 50 })

const flat = backtest({ AUSD: 100 }, { BTC: [1, 2, 3] }) // a stablecoin never moves
assert.ok(flat.totalReturn === 0 && flat.volatility === 0 && flat.maxDrawdown === 0)
assert.ok(close(backtest({ BTC: 50, AUSD: 50 }, { BTC: [100, 200] }).totalReturn, 50)) // half doubles: +50%
const dd = backtest({ ETH: 100 }, { ETH: [100, 120, 90, 110] })
assert.ok(close(dd.maxDrawdown, -25) && dd.days === 3) // drawdown is the fall from the peak

const [still] = projectRange(100, 0, [12])
assert.ok(close(still.low, 100) && close(still.high, 100))
const [calm] = projectRange(100, 20, [12])
const [wild] = projectRange(100, 80, [12])
assert.ok(wild.high - wild.low > calm.high - calm.low && calm.low < 100 && calm.high > 100)
console.log('check-pool ok')
