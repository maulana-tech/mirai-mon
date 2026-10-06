// Smart Money weights + DEX-trade flows: `node scripts/check-market.ts`
import assert from 'node:assert/strict'
import { ASSETS, flowsFromTrades, signalsFrom, smartWeights } from '../api/market.ts'

const idx = (s: string) => ASSETS.findIndex((a) => a.symbol === s)
const h = (symbol: string, valueUsd: number) => ({ symbol, valueUsd })
const f = (symbol: string, flow24hUsd: number) => ({ symbol, flow24hUsd })
const sum = (w: number[]) => w.reduce((a, b) => a + b, 0)

// No signal: plain BTC/ETH mix with 10% stable.
const none = smartWeights(signalsFrom([], []))
assert.deepEqual([none[idx('USDC')], none[idx('BTC')], none[idx('ETH')]], [1000, 4000, 5000])

// Today's Monad picture: smart money mostly holds MON, some memecoins, a little ETH.
const w = smartWeights(
  signalsFrom(
    [
      h('MON', 176_000),
      h('WMON', 10_000),
      h('EMO', 13_000),
      h('CHOG', 3_500),
      h('MONCAT', 2_000),
      h('NADS', 950),
      h('WETH', 500),
    ],
    [f('MONCAT', 1_300), f('MON', -1_300)],
  ),
)
assert.equal(sum(w), 10_000)
assert.equal(w[idx('MON')], 5000) // biggest conviction, capped at half
const memes = ['CHOG', 'NADS', 'MONCAT', 'EMO'].reduce((s, m) => s + w[idx(m)], 0)
assert.ok(memes <= 2000, `memes ${memes}`) // memecoins together at most 20%
assert.ok(['CHOG', 'NADS', 'MONCAT', 'EMO'].every((m) => w[idx(m)] <= 1000)) // and 10% each
assert.ok(w[idx('USDC')] >= 1000) // stable keeps at least 10% and takes what caps leave
assert.ok(w[idx('ETH')] < 100) // a $500 position earns a sliver, not the caps' leftovers

// Selling floors conviction at zero; it never goes negative.
const sold = smartWeights(signalsFrom([h('WETH', 100)], [f('WETH', -500), f('WBTC', 300)]))
assert.equal(sold[idx('ETH')], 0)
assert.equal(sold[idx('BTC')], 5000) // all conviction in BTC: capped at half, the rest stable
assert.equal(sold[idx('USDC')], 5000)
assert.equal(sum(sold), 10_000)

// DEX trades become net flow per token: bought +usd, sold −usd.
const trade = (bought: string, sold: string, usd: number) => ({
  token_bought_address: `0x${bought}`,
  token_bought_symbol: bought,
  token_sold_address: `0x${sold}`,
  token_sold_symbol: sold,
  trade_value_usd: usd,
})
const flows = flowsFromTrades([trade('MONCAT', 'MON', 1277), trade('USDC', 'AUSD', 53), trade('MON', 'USDC', 20)])
assert.deepEqual(
  flows.map((x) => [x.symbol, Math.round(x.flow24hUsd)]),
  [
    ['MONCAT', 1277],
    ['USDC', 33],
    ['AUSD', -53],
    ['MON', -1257],
  ],
)
console.log('smart weights today:', Object.fromEntries(ASSETS.map((a, i) => [a.symbol, w[i] / 100])))
console.log('check-market ok')
