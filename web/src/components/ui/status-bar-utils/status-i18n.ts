import { intlLocale, useT } from '@/lib/i18n'
import { useSettings } from '@/lib/settings'
import type { StatusReportImpact, StatusType } from './status.types'

/** Labels for StatusBar, from Mirai's i18n. Status/impact names are only used by the default card renderer. */
export function useStatusBlocksLabels() {
  const t = useT()
  const { locale } = useSettings()
  const intl = intlLocale(locale)
  const short = new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short' })
  const dateTime = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return {
    ariaStatusTracker: t('statusBar.aria'),
    ariaDayStatus: (n: number) => t('statusBar.day', { n }),
    clickAgainToUnpin: t('statusBar.unpin'),
    ongoing: t('statusBar.ongoing'),
    durationAcross: (duration: string) => `~ ${duration}`,
    formatDateShort: (d: Date) => short.format(d),
    formatDateRange: (from: Date, to?: Date) =>
      to ? `${dateTime.format(from)} – ${dateTime.format(to)}` : dateTime.format(from),
    requestStatus: { success: 'Success', degraded: 'Degraded', error: 'Error', info: 'Info', empty: 'No data' } as Record<
      StatusType,
      string
    >,
    componentImpact: { operational: 'Operational', degraded: 'Degraded', partial: 'Partial', major: 'Major' } as Record<
      StatusReportImpact,
      string
    >,
  }
}
