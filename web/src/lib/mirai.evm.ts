import { Contract, Interface, ZeroAddress, formatUnits, toUtf8Bytes, toUtf8String, type ContractRunner } from 'ethers'
import { MIRAI_ADDRESS, readProvider } from '@/lib/config'
import { getAusdBalance, signPermit } from '@/lib/ausd'
import { getSigner } from '@/lib/wallet'
import { MARKET_STRATEGY } from '@/lib/strategies'
import type { MarketBasket, MiraiAccount, MiraiService, StrategyId } from '@/lib/types'

const MIRAI_ABI = [
  'function accountOf(address user) view returns ((uint16 splitBps,uint128 spend,uint128 shares,uint256 savings,uint64 lockUntil,uint8 strategy))',
  'function strategies() view returns (address[4] vaults,address[4] yieldSources)',
  'function setStrategy(address user,uint8 strategy)',
  'function payWithPermit(address from,address to,uint256 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function withdrawSpend(address user,uint256 amount) returns (uint256)',
  'function withdrawSavings(address user,uint256 amount) returns (uint256)',
  'function withdrawAllSavings(address user) returns (uint256)',
  'function setSplit(address user,uint16 bps)',
  'function setLock(address user,uint64 until)',
  'function setGoal(address user,bytes encrypted)',
  'function goalOf(address user) view returns (bytes)',
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
] as const

const STREAMER_ABI = ['function aprBps() view returns (uint16)'] as const
const MARKET_ABI = [
  'function basket() view returns (address[] feeds,uint16[] weights,uint256[] units,uint256[] prices)',
] as const
/** MarketVault coins in vault order (DeployMirai.s.sol). */
const MARKET_SYMBOLS = ['BTC', 'ETH']

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

export const miraiEvm: MiraiService = {
  async getAccount(user: string): Promise<MiraiAccount> {
    const acc = await reader().accountOf(user)
    return {
      splitBps: Number(acc.splitBps),
      spend: BigInt(acc.spend),
      shares: BigInt(acc.shares),
      savings: BigInt(acc.savings),
      lockUntil: BigInt(acc.lockUntil),
      strategy: Number(acc.strategy) as StrategyId,
    }
  },

  async getStrategies() {
    const { vaults, aprs } = await strategyConfigOnce()
    const totals: bigint[] = await Promise.all(
      vaults.map((address) => new Contract(address, VAULT_ABI, readProvider).totalAssets()),
    )
    return vaults.map((_, i) => ({ id: i as StrategyId, aprBps: aprs[i], totalAssets: totals[i] }))
  },

  async getBasket(): Promise<MarketBasket> {
    const { vaults } = await strategyConfigOnce()
    const b = await new Contract(vaults[MARKET_STRATEGY], MARKET_ABI, readProvider).basket()
    const coins = [...b.weights].map((w: bigint, i: number) => {
      const priceUsd = Number(formatUnits(b.prices[i], 18))
      return {
        symbol: MARKET_SYMBOLS[i] ?? `#${i}`,
        weightBps: Number(w),
        priceUsd,
        valueUsd: Number(formatUnits(b.units[i], 18)) * priceUsd,
      }
    })
    return { coins, valueUsd: coins.reduce((s, c) => s + c.valueUsd, 0) }
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

  async withdrawSavings(user: string, amount: bigint) {
    const c = await signerContract(user, true) // touches savings: always confirm with the passkey
    // "Everything" redeems every share: a market-strategy balance can drop between reading it and
    // the transaction landing, and a fixed amount would then revert with InsufficientShares.
    const { savings } = await reader().accountOf(user)
    const all = amount >= BigInt(savings)
    const hash = await sendTx(all ? c.withdrawAllSavings(user) : c.withdrawSavings(user, amount))
    return { amount: all ? BigInt(savings) : amount, hash }
  },

  async setSplit(user: string, bps: number) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setSplit(user, bps))
    return { hash }
  },

  async setLock(user: string, until: bigint) {
    const c = await signerContract(user, true) // a lock can't be shortened: always confirm with the passkey
    const hash = await sendTx(c.setLock(user, until))
    return { hash }
  },

  async setStrategy(user: string, strategy: StrategyId) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setStrategy(user, strategy))
    return { hash }
  },

  async getGoal(user: string) {
    const raw: string = await reader().goalOf(user)
    return raw === '0x' ? null : toUtf8String(raw)
  },

  async setGoal(user: string, encrypted: string) {
    const c = await signerContract(user)
    const hash = await sendTx(c.setGoal(user, toUtf8Bytes(encrypted)))
    return { hash }
  },
}
