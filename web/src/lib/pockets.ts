import type { Pocket, PocketMeta, StrategyStats } from './types.ts'

const INVEST = 3 // MARKET_STRATEGY; inlined so scripts/check-pockets.ts runs under plain node
const isMarket = (s: number) => s === INVEST

export const MAX_POCKETS = 10 // Mirai.MAX_POCKETS

/** Name and icon key to show: the decrypted label, else a default by slot and strategy. */
export function pocketLabel(
  pocket: Pocket,
  meta: PocketMeta | undefined,
  t: (key: 'pockets.main' | 'pockets.untitled', vars?: Record<string, string | number>) => string,
) {
  return {
    name: meta?.name || (pocket.id === 0 ? t('pockets.main') : t('pockets.untitled', { n: pocket.id + 1 })),
    icon: meta?.icon || (isMarket(pocket.strategy) ? 'invest' : pocket.id === 0 ? 'piggy' : 'sprout'),
  }
}

export const isLocked = (p: Pocket) => Number(p.lockUntil) * 1000 > Date.now()

/** APR of the account's savings, weighted by pocket value (by share when empty); invest pockets count as 0. */
export function blendedAprBps(pockets: Pocket[], strategies: StrategyStats[] | null, fallback: Record<number, number>) {
  const total = pockets.reduce((a, p) => a + p.value, 0n)
  const weight = (p: Pocket) => (total > 0n ? Number(p.value) / Number(total) : p.shareBps / 10_000)
  return Math.round(
    pockets.reduce(
      (a, p) =>
        a + (isMarket(p.strategy) ? 0 : weight(p) * (strategies?.find((s) => s.id === p.strategy)?.aprBps ?? fallback[p.strategy])),
      0,
    ),
  )
}

/** Shares after giving `bps` to pocket `id`, taken from the others in proportion; sums to 10,000. */
export function sharesWith(pockets: Pocket[], id: number, bps: number): Record<number, number> {
  const others = pockets.filter((p) => p.id !== id)
  const rest = others.reduce((a, p) => a + p.shareBps, 0)
  const out: Record<number, number> = { [id]: bps }
  for (const p of others)
    out[p.id] = rest > 0 ? Math.floor((p.shareBps * (10_000 - bps)) / rest) : Math.floor((10_000 - bps) / others.length)
  // rounding dust goes to the biggest other pocket (or this one if it is alone)
  const dust = 10_000 - Object.values(out).reduce((a, b) => a + b, 0)
  const biggest = others.reduce<Pocket | null>((m, p) => (!m || out[p.id] > out[m.id] ? p : m), null)
  out[biggest?.id ?? id] += dust
  return out
}
