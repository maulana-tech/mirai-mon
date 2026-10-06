// Basket weights from Nansen holdings: `node scripts/check-market.ts`
import assert from 'node:assert/strict'
import { flowsFromTrades, weightsFrom } from '../api/market.ts'

const h = (symbol: string, valueUsd: number) => ({ symbol, address: '', valueUsd, change24hPct: 0, holders: 1, sharePct: 0 })

assert.deepEqual(weightsFrom([]), [5000, 5000]) // no data: even split
assert.deepEqual(weightsFrom([h('WBTC', 300), h('WETH', 100), h('MON', 1e9)]), [6500, 3500]) // MON ignored
assert.deepEqual(weightsFrom([h('WETH', 1)]), [2000, 8000]) // floor keeps 20% in BTC
assert.deepEqual(weightsFrom([h('wbtc', 1), h('WETH', 6)]), [2858, 7142]) // rounding dust to BTC, sums to 10k
// Net flow tilts the basket: smart money selling ETH and buying BTC moves weight to BTC.
const f = (symbol: string, flow24hUsd: number) => ({ symbol, flow24hUsd })
assert.deepEqual(weightsFrom([h('WBTC', 100), h('WETH', 100)], [f('WBTC', 200), f('WETH', -50)]), [7143, 2857]) // 300 vs 50
assert.deepEqual(weightsFrom([h('WETH', 100)], [f('WETH', -500)]), [5000, 5000]) // selling floors at zero: even split
// DEX trades become net flow per token: bought +usd, sold −usd.
const trade = (bought: string, sold: string, usd: number) => ({
  token_bought_address: `0x${bought}`, token_bought_symbol: bought,
  token_sold_address: `0x${sold}`, token_sold_symbol: sold, trade_value_usd: usd,
})
const flows = flowsFromTrades([trade('MONCAT', 'MON', 1277), trade('USDC', 'AUSD', 53), trade('MON', 'USDC', 20)])
assert.deepEqual(flows.map((x) => [x.symbol, Math.round(x.flow24hUsd)]), [['MONCAT', 1277], ['USDC', 33], ['AUSD', -53], ['MON', -1257]])
console.log('check-market ok')
