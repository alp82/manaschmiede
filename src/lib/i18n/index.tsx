import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { Locale, Translations } from './types'
import { de } from './de'
import { en } from './en'

const TRANSLATIONS: Record<Locale, Translations> = { de, en }
const STORAGE_KEY = 'manaschmiede-locale'

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'de'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'de') return stored
  return 'de'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** Scryfall language code for the current locale */
  scryfallLang: string
}

const I18nContext = createContext<I18nContextValue>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let text = (TRANSLATIONS[locale] as unknown as Record<string, string>)[key]
        ?? (TRANSLATIONS.en as unknown as Record<string, string>)[key]
        ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v))
        }
      }
      return text
    },
    [locale],
  )

  const scryfallLang = locale === 'de' ? 'de' : 'en'

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, scryfallLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

export function useT() {
  return useContext(I18nContext).t
}

export type { Locale, Translations }
