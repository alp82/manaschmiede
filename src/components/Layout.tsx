import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import type { Locale } from '../lib/i18n'
import { useSoundEnabled } from '../lib/sounds'
import { Button } from './ui/Button'
import { AiUsageLog } from './AiUsageLog'

interface LayoutProps {
  children: ReactNode
}

/**
 * Specimen site shell.
 *
 * Thin monochromatic top bar with a hairline bottom border. Left: Cinzel
 * wordmark in display-eyebrow. Right: mono-label nav + utility toggles.
 * No blue, no rounded accent button, no backdrop blur.
 *
 * The homepage should render its content WITHOUT this layout (the hero is
 * the navigation) — see the component kit memory.
 */

export function Layout({ children }: LayoutProps) {
  const { locale, setLocale, t } = useI18n()
  const [soundEnabled, setSoundEnabled] = useSoundEnabled()

  return (
    <div className="min-h-screen bg-ash-900">
      <header className="sticky top-0 z-20 border-b border-hairline bg-ash-900/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center px-4 py-3 sm:px-6">
          {/* Wordmark */}
          <a
            href="/"
            className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-100 transition-colors hover:text-cream-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
          >
            Manaschmiede
          </a>

          {/* Nav */}
          <nav className="ml-6 hidden items-center gap-5 sm:flex">
            <a
              href="/"
              className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
            >
              {t('nav.cards')}
            </a>
          </nav>

          {/* Utility rail (pushed right) */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="cursor-pointer font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
              title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
              aria-pressed={soundEnabled}
            >
              <span className="hidden sm:inline">{soundEnabled ? 'Sound' : 'Muted'}</span>
              <span className="sm:hidden" aria-hidden="true">
                {soundEnabled ? '\u266B' : '\u2014'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLocale((locale === 'de' ? 'en' : 'de') as Locale)}
              className="cursor-pointer font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
              title={locale === 'de' ? 'Switch to English' : 'Zu Deutsch wechseln'}
            >
              {locale.toUpperCase()}
            </button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                window.location.href = '/deck/new'
              }}
            >
              <span className="hidden sm:inline">{t('nav.newDeck')}</span>
              <span className="sm:hidden">+</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6">{children}</main>

      <AiUsageLog />
    </div>
  )
}
