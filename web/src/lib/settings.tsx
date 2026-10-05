import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Locale = 'en' | 'id' | 'zh'
export type PrimaryCurrency = 'usd' | 'idr' | 'ausd' | 'cny'

type SettingsContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  primaryCurrency: PrimaryCurrency
  setPrimaryCurrency: (currency: PrimaryCurrency) => void
}

const LOCALE_KEY = 'mirai:locale'
const CURRENCY_KEY = 'mirai:currency'

const SettingsContext = createContext<SettingsContextValue | null>(null)

function initialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY)
  if (stored === 'en' || stored === 'id' || stored === 'zh') return stored
  const browser = navigator.language.toLowerCase()
  if (browser.startsWith('id')) return 'id'
  if (browser.startsWith('zh')) return 'zh'
  return 'en'
}

// First-time users see money in their own currency; AUSD stays visible as the secondary amount.
const LOCAL_FIAT: Record<Locale, PrimaryCurrency> = { en: 'usd', id: 'idr', zh: 'cny' }

// the fiat shown alongside an AUSD-primary display follows the chosen
// language, so a Chinese speaker sees CNY rather than defaulting to USD
export function secondaryCurrencyFor(primary: PrimaryCurrency, locale: Locale): PrimaryCurrency {
  if (primary !== 'ausd') return 'ausd'
  if (locale === 'zh') return 'cny'
  if (locale === 'id') return 'idr'
  return 'usd'
}

function initialCurrency(): PrimaryCurrency {
  const stored = localStorage.getItem(CURRENCY_KEY)
  if (stored === 'usd' || stored === 'idr' || stored === 'ausd' || stored === 'cny') return stored
  return LOCAL_FIAT[initialLocale()]
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [primaryCurrency, setCurrencyState] = useState<PrimaryCurrency>(initialCurrency)

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_KEY, next)
    setLocaleState(next)
  }, [])

  const setPrimaryCurrency = useCallback((next: PrimaryCurrency) => {
    localStorage.setItem(CURRENCY_KEY, next)
    setCurrencyState(next)
  }, [])

  const value = useMemo(
    () => ({ locale, setLocale, primaryCurrency, setPrimaryCurrency }),
    [locale, setLocale, primaryCurrency, setPrimaryCurrency],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
