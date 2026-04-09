import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import type { Locale } from '../lib/i18n'
import { useSoundEnabled } from '../lib/sounds'

const FLAGS: Record<Locale, string> = {
  de: '\u{1F1E9}\u{1F1EA}',
  en: '\u{1F1EC}\u{1F1E7}',
}

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { locale, setLocale, t } = useI18n()
  const [soundEnabled, setSoundEnabled] = useSoundEnabled()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-surface-700 bg-surface-800/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center px-4 py-2.5">
          {/* Logo + main nav together */}
          <div className="flex items-center gap-4 sm:gap-6">
            <a href="/" className="font-display text-lg font-bold text-mana-multi sm:text-2xl">
              Manaschmiede
            </a>
            <nav className="flex items-center gap-2 sm:gap-3">
              <a href="/" className="hidden text-sm text-surface-300 hover:text-surface-100 sm:inline">
                {t('nav.cards')}
              </a>
              <a href="/deck/new" className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover sm:px-3 sm:text-sm">
                <span className="hidden sm:inline">{t('nav.newDeck')}</span>
                <span className="sm:hidden">+</span>
              </a>
            </nav>
          </div>
          {/* Utility controls pushed right */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`text-lg leading-none transition-opacity ${soundEnabled ? 'opacity-100' : 'opacity-40'}`}
              title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
            >
              {soundEnabled ? '\u{1F50A}' : '\u{1F507}'}
            </button>
            <button
              type="button"
              onClick={() => setLocale(locale === 'de' ? 'en' : 'de' as Locale)}
              className="text-lg leading-none"
              title={locale === 'de' ? 'Switch to English' : 'Zu Deutsch wechseln'}
            >
              {FLAGS[locale]}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-20">{children}</main>
    </div>
  )
}
