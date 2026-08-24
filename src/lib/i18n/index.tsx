import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { Locale, TFn, TranslationKey, Translations } from './types'
import { de } from './de'
import { en } from './en'

const TRANSLATIONS: Record<Locale, Translations> = { de, en }
const STORAGE_KEY = 'manaschmiede-locale'

const SSR_DEFAULT: Locale = 'de'

function getStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'de') return stored
  return null
}

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: TFn
  /** Scryfall language code for the current locale */
  scryfallLang: string
}

const I18nContext = createContext<I18nContextValue>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(SSR_DEFAULT)

  useEffect(() => {
    const stored = getStoredLocale()
    if (stored && stored !== SSR_DEFAULT) setLocaleState(stored)
    document.getElementById('i18n-cloak')?.remove()
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
    document.documentElement.lang = l
  }, [])

  /**
   * The `?? key` fallback is load-bearing beyond being a safety net:
   * `section-plan.ts` compares the returned string against the key it passed to
   * detect a section with no translation. The cast is what lets a `DynamicKey`
   * index a catalog typed by its literal keys.
   */
  const t = useCallback<TFn>(
    (key, params): string => {
      const catalog = TRANSLATIONS[locale] as Record<string, string>
      let text = catalog[key] ?? TRANSLATIONS.en[key as TranslationKey] ?? key
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
