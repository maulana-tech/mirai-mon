import { Interface, type Log } from 'ethers'
import { CONTRACT_ID, INDEXER_URL, readProvider } from '@/lib/config'

export type ActivityItem = {
  id: string
  kind: 'pay' | 'wd_spend' | 'wd_save' | 'split' | 'lock' | 'strategy'
  at: Date
  txHash: string
  from?: string
  amount?: bigint
  saved?: bigint
  shares?: bigint
  bps?: number
  until?: bigint
  strategy?: number
}

const iface = new Interface([
  'event PaymentRouted(address indexed from,address indexed to,uint256 amount,uint256 spendAmount,uint256 savingsAmount,uint256 shares)',
  'event SpendWithdrawn(address indexed user,uint256 amount)',
  'event SavingsWithdrawn(address indexed user,uint256 shares,uint256 amountOut)',
  'event SplitSet(address indexed user,uint16 bps)',
  'event LockSet(address indexed user,uint64 until)',
  'event StrategySet(address indexed user,uint8 strategy,uint256 moved)',
])

// ─── Envio indexer (full history) ────────────────────────────────────────────

/** `complete` is true only when the indexer served full history (the RPC fallback sees minutes). */
export type ActivityResult = { items: ActivityItem[]; complete: boolean }

type IndexedActivity = {
  id: string
  kind: ActivityItem['kind']
  timestamp: string
  txHash: string
  from: string | null
  amount: string | null
  saved: string | null
  shares: string | null
  bps: number | null
  until: string | null
  strategy: number | null
}

const ACTIVITY_QUERY = `query Activity($user: String!) {
  Activity(where: { user: { _eq: $user } }, order_by: { timestamp: desc }, limit: 200) {
    id kind timestamp txHash from amount saved shares bps until strategy
  }
}`

const big = (v: string | null) => (v === null ? undefined : BigInt(v))

async function fetchIndexedActivity(user: string): Promise<ActivityItem[]> {
  const res = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: ACTIVITY_QUERY, variables: { user } }),
  })
  if (!res.ok) throw new Error(`indexer ${res.status}`)
  const body = (await res.json()) as { data?: { Activity: IndexedActivity[] }; errors?: unknown }
  if (!body.data) throw new Error(`indexer error ${JSON.stringify(body.errors)}`)
  return body.data.Activity.map((a) => ({
    id: a.id,
    kind: a.kind,
    at: new Date(Number(a.timestamp) * 1000),
    txHash: a.txHash,
    from: a.from ?? undefined,
    amount: big(a.amount),
    saved: big(a.saved),
    shares: big(a.shares),
    bps: a.bps ?? undefined,
    until: big(a.until),
    strategy: a.strategy ?? undefined,
  }))
}

export type ProtocolStats = { volume: bigint; saved: bigint; payments: number; savers: number }

/** Protocol-wide totals kept by the indexer's Protocol entity; null without an indexer. */
export async function fetchProtocolStats(): Promise<ProtocolStats | null> {
  if (!INDEXER_URL) return null
  const res = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ Protocol { volume saved payments savers } }' }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as {
    data?: { Protocol: { volume: string; saved: string; payments: number; savers: number }[] }
  }
  const p = body.data?.Protocol[0]
  if (!p) return { volume: 0n, saved: 0n, payments: 0, savers: 0 }
  return { volume: BigInt(p.volume), saved: BigInt(p.saved), payments: p.payments, savers: p.savers }
}

// ─── RPC fallback (recent blocks only) ───────────────────────────────────────

// Monad's public RPC caps eth_getLogs at 100 blocks (~30s); 10 chunks cover the last ~5 minutes.
const LOG_RANGE = 100
const LOG_CHUNKS = 10
const blockTimestampCache = new Map<number, number>()

async function getBlockTimestamp(blockNumber: number): Promise<number> {
  const cached = blockTimestampCache.get(blockNumber)
  if (cached !== undefined) return cached
  const block = await readProvider.getBlock(blockNumber)
  const ts = Number(block?.timestamp ?? 0)
  blockTimestampCache.set(blockNumber, ts)
  return ts
}

type DecodedLog = Omit<ActivityItem, 'at'> & { blockNumber: number }

function decodeLog(log: Log, user: string): DecodedLog | null {
  const parsed = iface.parseLog(log)
  if (!parsed) return null
  const args = parsed.args
  const owner = String(parsed.name === 'PaymentRouted' ? args.to : args.user).toLowerCase()
  if (owner !== user) return null
  const base = { id: `${log.transactionHash}-${log.index}`, txHash: log.transactionHash, blockNumber: log.blockNumber }
  switch (parsed.name) {
    case 'PaymentRouted':
      return {
        ...base,
        kind: 'pay',
        from: String(args.from),
        amount: BigInt(args.amount),
        saved: BigInt(args.savingsAmount),
        shares: BigInt(args.shares),
      }
    case 'SpendWithdrawn':
      return { ...base, kind: 'wd_spend', amount: BigInt(args.amount) }
    case 'SavingsWithdrawn':
      return { ...base, kind: 'wd_save', shares: BigInt(args.shares), amount: BigInt(args.amountOut) }
    case 'SplitSet':
      return { ...base, kind: 'split', bps: Number(args.bps) }
    case 'StrategySet':
      return { ...base, kind: 'strategy', strategy: Number(args.strategy), amount: BigInt(args.moved) }
    case 'LockSet':
      return { ...base, kind: 'lock', until: BigInt(args.until) }
    default:
      return null
  }
}

async function fetchRecentActivity(user: string): Promise<ActivityItem[]> {
  const latest = await readProvider.getBlockNumber()
  const ranges = Array.from({ length: LOG_CHUNKS }, (_, i) => {
    const toBlock = latest - i * LOG_RANGE
    return { fromBlock: Math.max(toBlock - LOG_RANGE + 1, 0), toBlock }
  })
  // One call per chunk for every Mirai event; decodeLog keeps this user's.
  const logs = (await Promise.all(ranges.map((r) => readProvider.getLogs({ address: CONTRACT_ID, ...r })))).flat()

  const mine = logs.map((l) => decodeLog(l, user)).filter((item): item is DecodedLog => item !== null)
  await Promise.all([...new Set(mine.map((i) => i.blockNumber))].map(getBlockTimestamp))
  return mine
    .map(({ blockNumber, ...item }) => ({ ...item, at: new Date((blockTimestampCache.get(blockNumber) ?? 0) * 1000) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

// ─── Public API ──────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<ActivityResult>>()
const cache = new Map<string, { ts: number; result: ActivityResult }>()
const CACHE_MS = 5_000

export async function fetchActivity(user: string): Promise<ActivityResult> {
  if (CONTRACT_ID === '') return { items: [], complete: false }
  const key = user.toLowerCase()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.result
  const pending = inflight.get(key)
  if (pending) return pending
  const recent = () => fetchRecentActivity(key).then((items) => ({ items, complete: false }))
  // An unreachable indexer degrades to recent RPC logs, flagged incomplete so money math stays honest.
  const load: Promise<ActivityResult> = INDEXER_URL
    ? fetchIndexedActivity(key).then((items) => ({ items, complete: true }), recent)
    : recent()
  const p = load
    .then((result) => {
      cache.set(key, { ts: Date.now(), result })
      return result
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
