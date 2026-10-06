import type { StatusType } from './status.types'

/** Mapped onto Mirai's palette: success = savings (cyan), info = spending (cobalt). */
export const statusColors: Record<StatusType, string> = {
  success: 'var(--color-gold)',
  info: 'var(--primary)',
  degraded: 'var(--color-gold-ink)',
  error: 'var(--destructive)',
  empty: 'var(--muted)',
}
