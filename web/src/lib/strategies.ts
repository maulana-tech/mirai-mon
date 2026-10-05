import type { MessageKey } from '@/lib/i18n'
import type { StrategyId } from '@/lib/types'

/**
 * Display data for the savings strategies (order matches Mirai.sol). On testnet each yield vault's
 * yield is streamed at a fixed APR that mirrors the live Monad AUSD market named in `mainnet`;
 * on mainnet the strategy would point straight at that market's ERC-4626 vault. Smart Money is a
 * BTC/ETH basket priced by Chainlink and weighted by Nansen smart-money holdings; it has no APR.
 */
export const STRATEGIES: { id: StrategyId; name: MessageKey; risk: MessageKey; mainnet: string }[] = [
  { id: 0, name: 'strategy.conservative', risk: 'strategy.riskLow', mainnet: 'Aave V3 · AUSD' },
  { id: 1, name: 'strategy.balanced', risk: 'strategy.riskMedium', mainnet: 'Curvance · AUSD' },
  { id: 2, name: 'strategy.growth', risk: 'strategy.riskHigher', mainnet: 'Upshift · earnAUSD' },
  { id: 3, name: 'strategy.smartMoney', risk: 'strategy.riskMarket', mainnet: 'Kuru · BTC / ETH' },
]

export const MARKET_STRATEGY: StrategyId = 3
export const isMarket = (id: StrategyId) => id === MARKET_STRATEGY
export const YIELD_STRATEGIES = STRATEGIES.filter((s) => !isMarket(s.id))

/** Fallback APRs (bps) while chain data loads; the live values come from each strategy's streamer. */
export const DEFAULT_APR_BPS: Record<StrategyId, number> = { 0: 400, 1: 800, 2: 1200, 3: 0 }

export const formatApr = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
