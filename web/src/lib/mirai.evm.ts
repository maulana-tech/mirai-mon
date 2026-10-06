import { Contract, Interface, ZeroAddress, formatUnits, type ContractRunner } from 'ethers'
import { MIRAI_ADDRESS, readProvider } from '@/lib/config'
import { getAusdBalance, signPermit } from '@/lib/ausd'
import { getSigner } from '@/lib/wallet'
import { MARKET_STRATEGY } from '@/lib/strategies'
import type { BasketState, MiraiAccount, MiraiService, Pocket, StrategyId } from '@/lib/types'

const MIRAI_ABI = [
  'function accountOf(address user) view returns ((uint16 splitBps,uint128 spend,uint256 savings,uint8 pocketCount))',
  'function pocketsOf(address user) view returns ((uint16 shareBps,uint8 strategy,bool open,uint64 lockUntil,uint128 shares,uint256 value,bytes meta)[])',
  'function strategies() view returns (address[4] vaults,address[4] yieldSources)',
  'function payWithPermit(address from,address to,uint256 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function withdrawSpend(address user,uint256 amount) returns (uint256)',
  'function setSplit(address user,uint16 bps)',
  'function createPocket(address user,uint8 strategy,bytes meta) returns (uint256)',
  'function setPocketShares(address user,uint16[] bps)',
  'function setPocketStrategy(address user,uint256 id,uint8 strategy)',
  'function setPocketMeta(address user,uint256 id,bytes meta)',
  'function setPocketLock(address user,uint256 id,uint64 until)',
  'function withdrawPocket(address user,uint256 id,uint256 amount) returns (uint256)',
  'function withdrawAllPocket(address user,uint256 id) returns (uint256)',
  'function closePocket(address user,uint256 id,uint256 into)',
  'event PocketCreated(address indexed user,uint256 indexed pocket,uint8 strategy)',
  'error InvalidAddress()',
  'error InvalidAmount()',
  'error InvalidBps()',
  'error AmountOverflow()',
  'error InsufficientSpendable()',
  'error InsufficientShares()',
  'error LockActive()',
  'error LockCannotShrink()',
  'error EmptyWithdrawal()',
  'error LockTooLong()',
  'error Unauthorized()',
  'error GoalTooLarge()',
  'error InvalidStrategy()',
  'error InvalidPocket()',
  'error TooManyPockets()',
  'error InvalidShares()',
  // BasketVault (the invest strategy)
  'error InvalidWeights()',
  'error InvalidPrice()',
  'error InsufficientValue()',
] as const

const STREAMER_ABI = ['function aprBps() view returns (uint16)'] as const
const BASKET_ABI = [
  'function assets() view returns ((string symbol,address feed,bool meme)[])',
  'function prices() view returns (uint256[])',
  'function smartWeights() view returns (uint16[])',
  'function weightsOf(address user,uint256 pocket) view returns (uint16[])',
  'function holder(address user,uint256 pocket) view returns ((bool custom,uint64 epoch))',
  'function unitsOf(address user,uint256 pocket) view returns (uint256[])',
  'function setWeights(address user,uint256 pocket,uint16[] weights)',
  'error Unauthorized()',
  'error InvalidWeights()',
  'error InvalidPrice()',
  'error InsufficientValue()',
] as const

const VAULT_ABI = ['function totalAssets() view returns (uint256)'] as const

// Codes shown to users as Error(Contract, #N); localized in errors.ts. #9 was the removed SavingsNotZero.
const ERROR_CODES: Record<string, number> = {
  InvalidAddress: 10,
  InvalidAmount: 1,
  InvalidBps: 2,
  InsufficientSpendable: 3,
  InsufficientShares: 4,
  LockActive: 5,
  LockCannotShrink: 6,
  EmptyWithdrawal: 7,
  LockTooLong: 8,
  Unauthorized: 11,
  GoalTooLarge: 12,
  InvalidStrategy: 13,
  InvalidWeights: 14,
  InvalidPrice: 15,
  InsufficientValue: 4,
  InvalidPocket: 16,
  TooManyPockets: 17,
  InvalidShares: 18,
}

// A signed permit stays valid this long, covering a slow passkey prompt before submission.
const PERMIT_TTL_S = 20n * 60n

const iface = new Interface(MIRAI_ABI)

function reader(): Contract {
  return new Contract(MIRAI_ADDRESS, MIRAI_ABI, readProvider)
}

// Vault addresses and streamer APRs are immutable on-chain: read them once per session.
let strategyConfig: Promise<{ vaults: string[]; aprs: number[] }> | null = null

function strategyConfigOnce() {
  strategyConfig ??= reader()
    .strategies()
    .then(async (r: { vaults: string[]; yieldSources: string[] }) => ({
      vaults: [...r.vaults],
      aprs: await Promise.all(
        [...r.yieldSources].map((source) =>
          source === ZeroAddress ? 0 : new Contract(source, STREAMER_ABI, readProvider).aprBps().then(Number),
        ),
      ),
    }))
    .catch((e: unknown) => {
      strategyConfig = null // retry on the next call instead of caching a failure
      throw e
    })
  return strategyConfig
}

async function signerContract(user: string, stepUp = false): Promise<Contract> {
  const signer = await getSigner({ stepUp })
  if (signer.address.toLowerCase() !== user.toLowerCase()) throw new Error('wallet_passkey_mismatch')
  return new Contract(MIRAI_ADDRESS, MIRAI_ABI, signer as ContractRunner)
}

function asContractError(error: unknown): Error | null {
  try {
    const e = error as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string }
    const data = e.data ?? e.info?.error?.data
    if (typeof data === 'string') {
      const parsed = iface.parseError(data)
      const code = parsed ? ERROR_CODES[parsed.name] : undefined
      if (code) return new Error(`Error(Contract, #${code})`)
    }
    const msg = e.shortMessage ?? String(error)
    const hit = Object.entries(ERROR_CODES).find(([name]) => msg.includes(name))
    if (hit) return new Error(`Error(Contract, #${hit[1]})`)
    return null
  } catch {
    return null
  }
}

// Gas limits come from estimateGas (+10% in MeraSigner): Monad charges the full limit, so no fixed padding.
async function sendTx(txPromise: Promise<{ hash: string; wait: () => Promise<unknown> }>): Promise<string> {
  try {
    const tx = await txPromise
    await tx.wait()
    return tx.hash
  } catch (error) {
    throw asContractError(error) ?? error
  }
}

type RawPocket = {
  shareBps: bigint
  strategy: bigint
  open: boolean
  lockUntil: bigint
  shares: bigint
  value: bigint
  meta: string
}

async function pocketSlots(user: string): Promise<RawPocket[]> {
  return [...((await reader().pocketsOf(user)) as RawPocket[])]
}

export const miraiEvm: MiraiService = {
  async getAccount(user: string): Promise<MiraiAccount> {
    const [acc, slots] = await Promise.all([reader().accountOf(user), pocketSlots(user)])
    const pockets: Pocket[] = slots.flatMap((p, id) =>
      p.open
        ? [
            {
              id,
              shareBps: Number(p.shareBps),
              strategy: Number(p.strategy) as StrategyId,
              lockUntil: BigInt(p.lockUntil),
              shares: BigInt(p.shares),
              value: BigInt(p.value),
              meta: p.meta,
            },
          ]
        : [],
    )
    return { splitBps: Number(acc.splitBps), spend: BigInt(acc.spend), savings: BigInt(acc.savings), pockets }
  },

  async getStrategies() {
    const { vaults, aprs } = await strategyConfigOnce()
    const totals: bigint[] = await Promise.all(
      vaults.map((address) => new Contract(address, VAULT_ABI, readProvider).totalAssets()),
    )
    return vaults.map((_, i) => ({ id: i as StrategyId, aprBps: aprs[i], totalAssets: totals[i] }))
  },

  async getBasket(user?: string, pocket = 0): Promise<BasketState> {
    const { vaults } = await strategyConfigOnce()
    const basket = new Contract(vaults[MARKET_STRATEGY], BASKET_ABI, readProvider)
    const [assets, prices, smart, mine] = await Promise.all([
      basket.assets() as Promise<{ symbol: string; feed: string; meme: boolean }[]>,
      basket.prices() as Promise<bigint[]>,
      basket.smartWeights() as Promise<bigint[]>,
      user
        ? Promise.all([basket.holder(user, pocket), basket.weightsOf(user, pocket), basket.unitsOf(user, pocket)])
        : Promise.resolve(null),
    ])
    const priceUsd = prices.map((p) => Number(formatUnits(p, 18)))
    return {
      assets: assets.map((a, id) => ({
        id,
        symbol: a.symbol,
        kind: a.meme ? 'meme' : /^USD/.test(a.symbol) ? 'stable' : 'blue',
        priceUsd: priceUsd[id],
        oracle: a.feed === ZeroAddress ? 'curator' : 'chainlink',
      })),
      smartBps: smart.map(Number),
      mine: mine && {
        custom: Boolean(mine[0].custom),
        bps: [...(mine[1] as bigint[])].map(Number),
        valueUsd: [...(mine[2] as bigint[])].map((u, i) => Number(formatUnits(u, 18)) * priceUsd[i]),
      },
    }
  },

  async setBasketWeights(user: string, pocket: number, bps: number[] | null) {
    const signer = await getSigner()
    if (signer.address.toLowerCase() !== user.toLowerCase()) throw new Error('wallet_passkey_mismatch')
    const { vaults } = await strategyConfigOnce()
    const basket = new Contract(vaults[MARKET_STRATEGY], BASKET_ABI, signer as ContractRunner)
    const hash = await sendTx(basket.setWeights(user, pocket, bps ?? []))
    return { hash }
  },

  async pay(from: string, to: string, amount: bigint) {
    // Catch an empty wallet before the passkey prompt instead of after a reverted transaction.
    if ((await getAusdBalance(from).catch(() => amount)) < amount) throw new Error('insufficient_ausd')
    const c = await signerContract(from)
    const signer = await getSigner()
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_TTL_S
    const sig = await signPermit(signer, MIRAI_ADDRESS, amount, deadline)
    const hash = await sendTx(c.payWithPermit(from, to, amount, deadline, sig.v, sig.r, sig.s))
    return { hash }
  },

  async withdrawSpend(user: string, amount: bigint) {
    const c = await signerContract(user)
    const hash = await sendTx(c.withdrawSpend(user, amount))
    return { hash }
  },

  async setSplit(user: string, bps: number) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setSplit(user, bps))
    return { hash }
  },

  async createPocket(user: string, strategy: StrategyId, meta: string) {
    const c = await signerContract(user)
    try {
      const tx = await c.createPocket(user, strategy, meta)
      const receipt = await tx.wait()
      const log = receipt.logs.map((l: { topics: string[]; data: string }) => iface.parseLog(l)).find(
        (l: { name: string } | null) => l?.name === 'PocketCreated',
      )
      return { hash: tx.hash as string, id: Number(log.args.pocket) }
    } catch (error) {
      throw asContractError(error) ?? error
    }
  },

  async setPocketShares(user: string, bps: Record<number, number>) {
    const c = await signerContract(user)
    // The contract wants one entry per slot (closed ones too). The RPC can lag a block behind right
    // after createPocket, so never size below the highest pocket id given (or 1 for a fresh account).
    const ids = Object.keys(bps).map(Number)
    const slots = Math.max((await pocketSlots(user)).length, ...ids.map((i) => i + 1), 1)
    const hash = await sendTx(c.setPocketShares(user, Array.from({ length: slots }, (_, i) => bps[i] ?? 0)))
    return { hash }
  },

  async setPocketStrategy(user: string, pocket: number, strategy: StrategyId) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setPocketStrategy(user, pocket, strategy))
    return { hash }
  },

  async setPocketMeta(user: string, pocket: number, meta: string) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setPocketMeta(user, pocket, meta))
    return { hash }
  },

  async setPocketLock(user: string, pocket: number, until: bigint) {
    const c = await signerContract(user, true) // a lock can't be shortened: always confirm with the passkey
    const hash = await sendTx(c.setPocketLock(user, pocket, until))
    return { hash }
  },

  async withdrawPocket(user: string, pocket: number, amount: bigint) {
    const c = await signerContract(user, true) // touches savings: always confirm with the passkey
    // "Everything" sells/redeems it all: an invest pocket can drop between reading it and the tx
    // landing, and a fixed amount would then revert with InsufficientShares.
    const value = BigInt((await pocketSlots(user))[pocket]?.value ?? 0n)
    const all = amount >= value
    const hash = await sendTx(all ? c.withdrawAllPocket(user, pocket) : c.withdrawPocket(user, pocket, amount))
    return { amount: all ? value : amount, hash }
  },

  async closePocket(user: string, pocket: number, into: number) {
    const c = await signerContract(user, true) // moves savings: confirm with the passkey
    const hash = await sendTx(c.closePocket(user, pocket, into))
    return { hash }
  },
}
