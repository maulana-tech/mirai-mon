import { Interface, type Log } from 'ethers'
import { CONTRACT_ID, INDEXER_URL, readProvider } from '@/lib/config'

export type { ActivityItem } from '@/lib/types'
import type { ActivityItem } from '@/lib/types'

const iface = new Interface([
  'event PaymentRouted(address indexed from,address indexed to,uint256 amount,uint256 spendAmount,uint256 savingsAmount,uint256 shares)',
  'event SpendWithdrawn(address indexed user,uint256 amount)',
  'event SplitSet(address indexed user,uint16 bps)',
  'event PocketCreated(address indexed user,uint256 indexed pocket,uint8 strategy)',
  'event PocketStrategySet(address indexed user,uint256 indexed pocket,uint8 strategy,uint256 moved)',
  'event PocketLockSet(address indexed user,uint256 indexed pocket,uint64 until)',
  'event PocketWithdrawn(address indexed user,uint256 indexed pocket,uint256 amount)',
  'event PocketClosed(address indexed user,uint256 indexed pocket,uint256 indexed into,uint256 moved)',
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
  to: string | null
  custom: boolean | null
  amount: string | null
  saved: string | null
  shares: string | null
  bps: number | null
  until: string | null
  strategy: number | null
  pocket: number | null
}

const ACTIVITY_QUERY = `query Activity($user: String!) {
  Activity(where: { user: { _eq: $user } }, order_by: { timestamp: desc }, limit: 200) {
    id kind timestamp txHash from to amount saved shares bps until strategy custom pocket
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
    to: a.to ?? undefined,
    custom: a.custom ?? undefined,
    amount: big(a.amount),
    saved: big(a.saved),
    shares: big(a.shares),
    bps: a.bps ?? undefined,
    until: big(a.until),
    strategy: a.strategy ?? undefined,
    pocket: a.pocket ?? undefined,
  }))
}

/** Net deposits per pocket id from the indexer (PocketFlow); null without an indexer. */
export async function fetchPocketFlows(user: string): Promise<Record<number, bigint> | null> {
  if (!INDEXER_URL) return null
  const res = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query F($user: String!) { PocketFlow(where: { user: { _eq: $user } }) { pocket deposited } }',
      variables: { user: user.toLowerCase() },
    }),
  }).catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json()) as { data?: { PocketFlow: { pocket: number; deposited: string }[] } }
  if (!body.data) return null
  return Object.fromEntries(body.data.PocketFlow.map((f) => [f.pocket, BigInt(f.deposited)]))
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
  const base = { id: `${log.transactionHash}-${log.index}`, txHash: log.transactionHash, blockNumber: log.blockNumber }
  if (parsed.name === 'PaymentRouted') {
    const to = String(args.to).toLowerCase()
    // Mirrors the indexer: the recipient gets "pay", the payer (if someone else) gets "sent".
    if (to !== user) {
      if (String(args.from).toLowerCase() !== user) return null
      return { ...base, id: `${base.id}-sent`, kind: 'sent', to, amount: BigInt(args.amount) }
    }
  } else if (String(args.user).toLowerCase() !== user) return null
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
    case 'SplitSet':
      return { ...base, kind: 'split', bps: Number(args.bps) }
    case 'PocketWithdrawn':
      return { ...base, kind: 'wd_save', pocket: Number(args.pocket), amount: BigInt(args.amount) }
    case 'PocketStrategySet':
      return { ...base, kind: 'strategy', pocket: Number(args.pocket), strategy: Number(args.strategy), amount: BigInt(args.moved) }
    case 'PocketLockSet':
      return { ...base, kind: 'lock', pocket: Number(args.pocket), until: BigInt(args.until) }
    case 'PocketCreated':
      if (Number(args.pocket) === 0) return null // the default pocket, opened implicitly
      return { ...base, kind: 'pocket_new', pocket: Number(args.pocket), strategy: Number(args.strategy) }
    case 'PocketClosed':
      return { ...base, kind: 'pocket_close', pocket: Number(args.pocket), amount: BigInt(args.moved) }
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
