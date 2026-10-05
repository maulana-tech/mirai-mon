import { AUSD_SCALE } from '@/lib/ausd'

export function parseAusd(input: string): bigint {
  const trimmed = input.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error('Invalid amount')
  const [whole, frac = ''] = trimmed.split('.')
  return BigInt(whole) * AUSD_SCALE + BigInt(frac.padEnd(6, '0'))
}

// plain decimal string that parseAusd accepts, for prefilling inputs
export function ausdToInput(amount: bigint): string {
  const whole = (amount / AUSD_SCALE).toString()
  const frac = (amount % AUSD_SCALE).toString().padStart(6, '0').replace(/0+$/, '')
  return frac === '' ? whole : `${whole}.${frac}`
}

export function ausdToNumber(amount: bigint): number {
  return Number(amount) / Number(AUSD_SCALE)
}

// truncates a hex string (tx hash, address) for compact display: abcd1234...wxyz9876
export function shortHex(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-6)}`
}
