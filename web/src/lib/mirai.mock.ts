import type { MiraiAccount, MiraiService, StrategyId } from '@/lib/types'

const LATENCY_MS = 800
const DEFAULT_SPLIT_BPS = 2000
const BPS_DENOMINATOR = 10_000n

const accounts = new Map<string, MiraiAccount>()
const goals = new Map<string, string>()

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
}

function account(user: string): MiraiAccount {
  let acc = accounts.get(user)
  if (!acc) {
    acc = { splitBps: DEFAULT_SPLIT_BPS, spend: 0n, shares: 0n, savings: 0n, lockUntil: 0n, strategy: 1 }
    accounts.set(user, acc)
  }
  return acc
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

// looks like a real 32-byte tx hash so the confirmation UI has something to show
function mockHash(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
}

export const miraiMock: MiraiService = {
  async getAccount(user) {
    await delay()
    return { ...account(user) }
  },

  async getStrategies() {
    const totals = [0n, 0n, 0n, 0n]
    for (const acc of accounts.values()) totals[acc.strategy] += acc.savings
    // mock vaults never earn yield; APRs mirror the testnet streamers (the market basket has none)
    return ([400, 800, 1200, 0] as const).map((aprBps, id) => ({
      id: id as StrategyId,
      aprBps,
      totalAssets: totals[id],
    }))
  },

  async getBasket() {
    await delay()
    const coins = [
      { symbol: 'BTC', weightBps: 5000, priceUsd: 86_000, valueUsd: 0 },
      { symbol: 'ETH', weightBps: 5000, priceUsd: 2_700, valueUsd: 0 },
    ]
    return { coins, valueUsd: 0 }
  },

  async pay(_from, to, amount) {
    await delay()
    const acc = account(to)
    const saved = (amount * BigInt(acc.splitBps)) / BPS_DENOMINATOR
    acc.shares += saved // 1:1 shares in the mock vault
    acc.savings += saved
    acc.spend += amount - saved
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

  async withdrawSavings(user, amount) {
    await delay()
    const acc = account(user)
    if (acc.lockUntil > nowSeconds()) throw new Error('Error(Contract, #5)')
    if (amount > acc.savings) throw new Error('Error(Contract, #4)')
    acc.shares -= amount
    acc.savings -= amount
    return { amount, hash: mockHash() }
  },

  async setSplit(user, bps) {
    await delay()
    account(user).splitBps = bps
    return { hash: mockHash() }
  },

  async setLock(user, until) {
    await delay()
    account(user).lockUntil = until
    return { hash: mockHash() }
  },

  async setStrategy(user, strategy) {
    await delay()
    account(user).strategy = strategy
    return { hash: mockHash() }
  },

  async getGoal(user) {
    return goals.get(user) ?? null
  },

  async setGoal(user, encrypted) {
    await delay()
    if (encrypted === '') goals.delete(user)
    else goals.set(user, encrypted)
    return { hash: mockHash() }
  },
}
