import type { BasketAsset } from '@/lib/types'

/** Ready-made mixes by symbol, in percent. "smart" follows the Smart Money weights instead. */
export type PresetId = 'smart' | 'blue' | 'careful' | 'custom'
export const PRESET_MIX: Record<'blue' | 'careful', Record<string, number>> = {
  blue: { USDC: 10, BTC: 45, ETH: 45 },
  careful: { USDC: 60, BTC: 25, ETH: 15 },
}

/** Above this share of memecoins the saver has to confirm they understand the risk. */
export const MEME_ACK_BPS = 2_000

/** Percent-by-symbol mix → bps per basket asset (missing symbols get 0). */
export function bpsFromMix(assets: BasketAsset[], mix: Record<string, number>): number[] {
  return assets.map((a) => Math.round((mix[a.symbol] ?? 0) * 100))
}

export const memeBps = (assets: BasketAsset[], bps: number[]) =>
  assets.reduce((s, a, i) => (a.kind === 'meme' ? s + (bps[i] ?? 0) : s), 0)

/** Which preset a set of weights matches, for highlighting the current choice. */
export function presetOf(assets: BasketAsset[], bps: number[], custom: boolean): PresetId {
  if (!custom) return 'smart'
  for (const id of ['blue', 'careful'] as const) {
    if (bpsFromMix(assets, PRESET_MIX[id]).every((b, i) => b === bps[i])) return id
  }
  return 'custom'
}
