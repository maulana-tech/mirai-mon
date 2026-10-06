/** 0 conservative, 1 balanced (default), 2 growth (yield), 3 smart money (market basket); matches Mirai.sol. */
export type StrategyId = 0 | 1 | 2 | 3

/** One entry of an account's activity feed (indexer or recent RPC logs). */
export type ActivityItem = {
  id: string
  kind: 'pay' | 'sent' | 'wd_spend' | 'wd_save' | 'split' | 'lock' | 'strategy' | 'basket' | 'pocket_new' | 'pocket_close'
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
  /** Pocket slot the event is about (wd_save, lock, strategy, basket, pocket_*). */
  pocket?: number
  /** basket: the saver's own mix (true) or following Smart Money (false). */
  custom?: boolean
}

/** One savings pocket (Mirai.sol `PocketView`); `id` is its slot, stable while it is open. */
export type Pocket = {
  id: number
  /** Share of each payment's savings this pocket gets (open pockets sum to 10,000). */
  shareBps: number
  strategy: StrategyId
  lockUntil: bigint
  /** Yield-vault shares (0 for an invest pocket, whose holdings live in the basket). */
  shares: bigint
  /** Current AUSD value, including yield or market moves. */
  value: bigint
  /** Encrypted name/icon/target as 0x-hex (see pocket-meta.ts); '0x' when none. */
  meta: string
}

/** A pocket's private label, stored encrypted on-chain (pocket-meta.ts). */
export type PocketMeta = {
  name: string
  /** Icon key (POCKET_ICONS in components/pocket-icon.tsx). */
  icon: string
  /** Target in AUSD base units; 0n = no target. */
  target: bigint
}

export type MiraiAccount = {
  splitBps: number
  spend: bigint
  /** Sum of every pocket's value. */
  savings: bigint
  /** Open pockets only, by slot id. */
  pockets: Pocket[]
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

export type BasketAssetKind = 'stable' | 'blue' | 'meme'

/** One coin the invest basket can hold (BasketVault order). */
export type BasketAsset = {
  id: number
  symbol: string
  kind: BasketAssetKind
  /** USD; 0 when a curator-priced coin has no price yet. */
  priceUsd: number
  oracle: 'chainlink' | 'curator'
}

/** The invest strategy's basket, read from chain (BasketVault). */
export type BasketState = {
  assets: BasketAsset[]
  /** Today's "Follow Smart Money" weights, bps per asset. */
  smartBps: number[]
  /** The saver's own basket, when a user was given. */
  mine: {
    /** false: follows Smart Money. */
    custom: boolean
    bps: number[]
    /** USD value held per asset. */
    valueUsd: number[]
  } | null
}

export interface MiraiService {
  getAccount(user: string): Promise<MiraiAccount>
  getStrategies(): Promise<StrategyStats[]>
  /** The basket assets and Smart Money weights, plus one pocket's own basket when `user` is given. */
  getBasket(user?: string, pocket?: number): Promise<BasketState>
  /** Picks an invest pocket's mix (bps per asset, summing to 10,000); null follows Smart Money. */
  setBasketWeights(user: string, pocket: number, bps: number[] | null): Promise<TxResult>
  pay(from: string, to: string, amount: bigint): Promise<TxResult>
  withdrawSpend(user: string, amount: bigint): Promise<TxResult>
  setSplit(user: string, bps: number): Promise<TxResult>
  /** Opens a pocket with a 0% share; `meta` is the encrypted label (0x-hex). Resolves to its slot id. */
  createPocket(user: string, strategy: StrategyId, meta: string): Promise<TxResult & { id: number }>
  /** bps by pocket id for every open pocket, summing to 10,000. */
  setPocketShares(user: string, bps: Record<number, number>): Promise<TxResult>
  /** Moves the pocket's money into another strategy; its future savings follow. */
  setPocketStrategy(user: string, pocket: number, strategy: StrategyId): Promise<TxResult>
  setPocketMeta(user: string, pocket: number, meta: string): Promise<TxResult>
  setPocketLock(user: string, pocket: number, until: bigint): Promise<TxResult>
  /** `amount` in AUSD; at or above the pocket's value it withdraws everything. */
  withdrawPocket(user: string, pocket: number, amount: bigint): Promise<WithdrawSavingsResult>
  /** Moves the pocket's money and share into `into`, then frees the slot. */
  closePocket(user: string, pocket: number, into: number): Promise<TxResult>
}
