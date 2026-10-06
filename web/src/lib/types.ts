/** 0 conservative, 1 balanced (default), 2 growth (yield), 3 smart money (market basket); matches Mirai.sol. */
export type StrategyId = 0 | 1 | 2 | 3

/** One entry of an account's activity feed (indexer or recent RPC logs). */
export type ActivityItem = {
  id: string
  kind: 'pay' | 'sent' | 'wd_spend' | 'wd_save' | 'split' | 'lock' | 'strategy'
  at: Date
  txHash: string
  from?: string
  /** Recipient of a payment this account sent. */
  to?: string
  amount?: bigint
  saved?: bigint
  shares?: bigint
  bps?: number
  until?: bigint
  strategy?: number
}

export type MiraiAccount = {
  splitBps: number
  spend: bigint
  /** Vault shares held for the user. */
  shares: bigint
  /** Current AUSD value of `shares`, including yield. */
  savings: bigint
  lockUntil: bigint
  strategy: StrategyId
}

export type TxResult = { hash: string }
export type WithdrawSavingsResult = { amount: bigint; hash: string }

export type StrategyStats = {
  id: StrategyId
  /** Annual rate the strategy's yield source pays, read from chain (800 = 8%). */
  aprBps: number
  /** Total AUSD held by the strategy's vault. */
  totalAssets: bigint
}

/** The Smart Money vault's basket, read from chain (MarketVault.basket). */
export type MarketBasket = {
  coins: { symbol: string; weightBps: number; priceUsd: number; valueUsd: number }[]
  /** Basket value in AUSD units before the reserve cap. */
  valueUsd: number
}

export interface MiraiService {
  getAccount(user: string): Promise<MiraiAccount>
  getStrategies(): Promise<StrategyStats[]>
  getBasket(): Promise<MarketBasket>
  pay(from: string, to: string, amount: bigint): Promise<TxResult>
  withdrawSpend(user: string, amount: bigint): Promise<TxResult>
  /** `amount` is in AUSD; the contract burns the shares it is worth. */
  withdrawSavings(user: string, amount: bigint): Promise<WithdrawSavingsResult>
  setSplit(user: string, bps: number): Promise<TxResult>
  setLock(user: string, until: bigint): Promise<TxResult>
  /** Moves existing savings into the chosen strategy; future savings follow it. */
  setStrategy(user: string, strategy: StrategyId): Promise<TxResult>
  /** Encrypted savings goal (a Mera secret vault as JSON), or null when none is set. */
  getGoal(user: string): Promise<string | null>
  /** Stores an encrypted goal; an empty string clears it. */
  setGoal(user: string, encrypted: string): Promise<TxResult>
}
