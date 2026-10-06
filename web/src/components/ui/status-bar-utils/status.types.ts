export type StatusType = 'success' | 'degraded' | 'error' | 'info' | 'empty'
export type StatusEventType = 'incident' | 'report' | 'maintenance'
export type StatusReportImpact = 'operational' | 'degraded' | 'partial' | 'major'

export type StatusBarData = {
  /** ISO date (YYYY-MM-DD) */
  day: string
  /** Segments top to bottom; heights in percent, summing to 100. */
  bar: { status: StatusType; height: number }[]
  card: { status: StatusType; value: string; label?: string; impact?: StatusReportImpact }[]
  events: {
    id: string
    name: string
    type: StatusEventType
    from?: Date | null
    to?: Date | null
    isAggregated?: boolean
    status?: Exclude<StatusType, 'empty'>
  }[]
}
