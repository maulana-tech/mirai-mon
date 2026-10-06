import type { BasketAsset, MiraiAccount, MiraiService, Pocket, StrategyId } from '@/lib/types'

const LATENCY_MS = 800
const DEFAULT_SPLIT_BPS = 2000
const BPS_DENOMINATOR = 10_000n

const accounts = new Map<string, MiraiAccount>()

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
}

function account(user: string): MiraiAccount {
  let acc = accounts.get(user)
  if (!acc) {
    const main: Pocket = { id: 0, shareBps: 10_000, strategy: 1, lockUntil: 0n, shares: 0n, value: 0n, meta: '0x' }
    acc = { splitBps: DEFAULT_SPLIT_BPS, spend: 0n, savings: 0n, pockets: [main] }
    accounts.set(user, acc)
  }
  return acc
}

function pocket(user: string, id: number): Pocket {
  const p = account(user).pockets.find((x) => x.id === id)
  if (!p) throw new Error('Error(Contract, #16)')
  return p
}

const sync = (acc: MiraiAccount) => (acc.savings = acc.pockets.reduce((a, p) => a + p.value, 0n))

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

// looks like a real 32-byte tx hash so the confirmation UI has something to show
function mockHash(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
}

// mock baskets: one custom mix per user+pocket (none = follows Smart Money)
const mockWeights = new Map<string, number[]>()

export const miraiMock: MiraiService = {
  async getAccount(user) {
    await delay()
    const acc = account(user)
    return { ...acc, pockets: acc.pockets.map((p) => ({ ...p })) }
  },

  async getStrategies() {
    const totals = [0n, 0n, 0n, 0n]
    for (const acc of accounts.values()) for (const p of acc.pockets) totals[p.strategy] += p.value
    // mock vaults never earn yield; APRs mirror the testnet streamers (the market basket has none)
    return ([400, 800, 1200, 0] as const).map((aprBps, id) => ({
      id: id as StrategyId,
      aprBps,
      totalAssets: totals[id],
    }))
  },

  async getBasket(user, pocketId = 0) {
    await delay()
    const assets: BasketAsset[] = [
      { id: 0, symbol: 'USDC', kind: 'stable', priceUsd: 1, oracle: 'chainlink' },
      { id: 1, symbol: 'BTC', kind: 'blue', priceUsd: 85_000, oracle: 'chainlink' },
      { id: 2, symbol: 'ETH', kind: 'blue', priceUsd: 2_700, oracle: 'chainlink' },
      { id: 3, symbol: 'MON', kind: 'blue', priceUsd: 0.03, oracle: 'curator' },
      { id: 4, symbol: 'CHOG', kind: 'meme', priceUsd: 0.002, oracle: 'curator' },
    ]
    const smartBps = [4000, 0, 1000, 4500, 500]
    const custom = user ? mockWeights.get(`${user}:${pocketId}`) : undefined
    return { assets, smartBps, mine: user ? { custom: !!custom, bps: custom ?? smartBps, valueUsd: assets.map(() => 0) } : null }
  },

  async setBasketWeights(user, pocketId, bps) {
    await delay()
    if (bps) mockWeights.set(`${user}:${pocketId}`, bps)
    else mockWeights.delete(`${user}:${pocketId}`)
    return { hash: mockHash() }
  },

  async pay(_from, to, amount) {
    await delay()
    const acc = account(to)
    const saved = (amount * BigInt(acc.splitBps)) / BPS_DENOMINATOR
    let left = saved
    acc.pockets.forEach((p, i) => {
      const part = i === acc.pockets.length - 1 ? left : (saved * BigInt(p.shareBps)) / BPS_DENOMINATOR
      p.value += part // 1:1 in the mock vaults
      left -= part
    })
    acc.spend += amount - saved
    sync(acc)
    return { hash: mockHash() }
  },

  async withdrawSpend(user, amount) {
    await delay()
    const acc = account(user)
    // same format the EVM service surfaces for real contract failures, so errorKey maps it
    if (amount > acc.spend) throw new Error('Error(Contract, #3)')
    acc.spend -= amount
    return { hash: mockHash() }
  },

  async setSplit(user, bps) {
    await delay()
    account(user).splitBps = bps
    return { hash: mockHash() }
  },

  async createPocket(user, strategy, meta) {
    await delay()
    const acc = account(user)
    if (acc.pockets.length >= 10) throw new Error('Error(Contract, #17)')
    const used = new Set(acc.pockets.map((p) => p.id))
    let id = 0
    while (used.has(id)) id++
    acc.pockets.push({ id, shareBps: 0, strategy, lockUntil: 0n, shares: 0n, value: 0n, meta })
    acc.pockets.sort((a, b) => a.id - b.id)
    return { hash: mockHash(), id }
  },

  async setPocketShares(user, bps) {
    await delay()
    const acc = account(user)
    if (acc.pockets.reduce((a, p) => a + (bps[p.id] ?? 0), 0) !== 10_000) throw new Error('Error(Contract, #18)')
    for (const p of acc.pockets) p.shareBps = bps[p.id] ?? 0
    return { hash: mockHash() }
  },

  async setPocketStrategy(user, id, strategy: StrategyId) {
    await delay()
    pocket(user, id).strategy = strategy
    return { hash: mockHash() }
  },

  async setPocketMeta(user, id, meta) {
    await delay()
    pocket(user, id).meta = meta
    return { hash: mockHash() }
  },

  async setPocketLock(user, id, until) {
    await delay()
    const p = pocket(user, id)
    if (until < p.lockUntil) throw new Error('Error(Contract, #6)')
    p.lockUntil = until
    return { hash: mockHash() }
  },

  async withdrawPocket(user, id, amount) {
    await delay()
    const p = pocket(user, id)
    if (p.lockUntil > nowSeconds()) throw new Error('Error(Contract, #5)')
    const out = amount >= p.value ? p.value : amount
    p.value -= out
    sync(account(user))
    return { amount: out, hash: mockHash() }
  },

  async closePocket(user, id, into) {
    await delay()
    const acc = account(user)
    const p = pocket(user, id)
    const dest = pocket(user, into)
    if (id === into) throw new Error('Error(Contract, #16)')
    if (p.lockUntil > nowSeconds()) throw new Error('Error(Contract, #5)')
    dest.value += p.value
    dest.shareBps += p.shareBps
    acc.pockets = acc.pockets.filter((x) => x.id !== id)
    return { hash: mockHash() }
  },
}
