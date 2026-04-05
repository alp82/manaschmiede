import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import type { Locale } from '../lib/i18n'

const FLAGS: Record<Locale, string> = {
  de: '\u{1F1E9}\u{1F1EA}',
  en: '\u{1F1EC}\u{1F1E7}',
}

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-surface-700 bg-surface-800/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5">
          <a href="/" className="font-display text-lg font-bold text-mana-multi sm:text-2xl">
            Manaschmiede
          </a>
          <nav className="flex items-center gap-2 sm:gap-4">
            <a href="/" className="hidden text-sm text-surface-300 hover:text-surface-100 sm:inline">
              {t('nav.cards')}
            </a>
            <a href="/deck/new" className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover sm:px-3 sm:text-sm">
              <span className="hidden sm:inline">{t('nav.newDeck')}</span>
              <span className="sm:hidden">+</span>
            </a>
            <button
              type="button"
              onClick={() => setLocale(locale === 'de' ? 'en' : 'de' as Locale)}
              className="text-lg leading-none"
              title={locale === 'de' ? 'Switch to English' : 'Zu Deutsch wechseln'}
            >
              {FLAGS[locale]}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-20">{children}</main>
    </div>
  )
}
