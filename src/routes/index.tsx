import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { Layout } from '../components/Layout'
import { SearchInput } from '../components/SearchInput'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { getTotalCards } from '../lib/deck-utils'
import { DeckMeta } from '../components/ui/DeckMeta'
import { loadDecks, deleteDeck as deleteStoredDeck, type LocalDeck } from '../lib/deck-storage'
import { useSampleDecks } from '../lib/useSampleDecks'
import { useT } from '../lib/i18n'

// Curated iconic MTG cards — rotated once per page load for the hero plate.
// Using Scryfall's named endpoint with `version=art_crop` returns a redirect
// to the card art crop image, so these URLs can be used directly in <img src>.
const HERO_ART_URLS = [
  'https://api.scryfall.com/cards/named?exact=Lightning+Bolt&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Counterspell&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Swords+to+Plowshares&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Dark+Ritual&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Llanowar+Elves&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Birds+of+Paradise&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Sol+Ring&format=image&version=art_crop',
  'https://api.scryfall.com/cards/named?exact=Black+Lotus&format=image&version=art_crop',
]

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Manaschmiede — MTG Deck Builder' },
      {
        name: 'description',
        content: 'Forge custom MTG decks with AI assistance.',
      },
      { property: 'og:title', content: 'Manaschmiede — MTG Deck Builder' },
      {
        property: 'og:description',
        content: 'Forge custom MTG decks with AI assistance.',
      },
      { property: 'og:type', content: 'website' },
    ],
  }),
  component: HomePage,
})

function HomePage() {
  const t = useT()
  const navigate = useNavigate()

  const [decks, setDecks] = useState<LocalDeck[]>([])
  const catalogRef = useRef<HTMLDivElement>(null)
  const [heroArtUrl] = useState(
    () => HERO_ART_URLS[Math.floor(Math.random() * HERO_ART_URLS.length)],
  )

  const reloadDecks = useCallback(() => {
    setDecks(loadDecks())
  }, [])

  useEffect(() => {
    reloadDecks()
  }, [reloadDecks])

  const { importAll: importSampleDecks } = useSampleDecks(reloadDecks)

  const [pendingDeleteDeckId, setPendingDeleteDeckId] = useState<string | null>(null)

  function deleteDeck(deckId: string) {
    setPendingDeleteDeckId(deckId)
  }

  function confirmDeleteDeck() {
    if (pendingDeleteDeckId) {
      deleteStoredDeck(pendingDeleteDeckId)
      setDecks((prev) => prev.filter((d) => d.id !== pendingDeleteDeckId))
    }
    setPendingDeleteDeckId(null)
  }

  function scrollToCatalog() {
    catalogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Homepage search is a dumb launcher: the first non-empty value redirects
  // to `/cards?q=<value>` so the full search experience (filters, grid,
  // lightbox) only lives on the dedicated route. The `q` search param is
  // consumed by CardSearch's nuqs state.
  function handleLauncherChange(value: string) {
    if (value.length >= 1) {
      navigate({ to: '/cards', search: { q: value } })
    }
  }

  return (
    <Layout>
      {/* ─── HERO ──────────────────────────────────────────────── */}
      {/* Full-bleed section: negative horizontal margin escapes Layout's
          max-w-7xl + px-4/6 padding so the background art spans the
          entire viewport width. */}
      <section className="relative mx-[calc(50%-50vw)] overflow-hidden">
        {/* Background plate — Scryfall art crop, ink-darkened */}
        <div className="absolute inset-0 -z-10">
          <img
            src={heroArtUrl}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover opacity-35"
          />
          {/* Heavy ash scrim — fades from semi-transparent at top to
              solid at the bottom so content blends into the page below */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, oklch(0.14 0.008 55 / 0.55) 0%, oklch(0.14 0.008 55 / 0.78) 50%, oklch(0.14 0.008 55 / 1) 100%)',
            }}
          />
        </div>

        {/* Content — re-centered inside the full-bleed section */}
        <div className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-32 pt-24 text-center md:pt-32 md:pb-40">
          <span className="font-mono text-mono-label uppercase leading-none tracking-mono-label text-cream-300">
            A Type Specimen for Deckbuilders
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.02] tracking-display-tight text-cream-100 sm:text-6xl md:text-display-hero">
            Manaschmiede
          </h1>
          <p className="mt-6 max-w-xl font-body text-base leading-relaxed text-cream-300 sm:text-lg">
            {t('home.tagline')}
          </p>

          {/* Ornamental rule */}
          <div className="mt-10 flex items-center justify-center gap-4" aria-hidden="true">
            <span className="h-px w-20 bg-hairline-strong" />
            <span className="font-mono text-mono-marginal text-cream-400">§</span>
            <span className="h-px w-20 bg-hairline-strong" />
          </div>

          {/* Primary CTA + secondary */}
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <Link to="/deck/new" className="outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900">
              <Button
                variant="primary"
                size="lg"
                className="font-display text-base tracking-display"
              >
                {t('home.forgeDeck')}
              </Button>
            </Link>
            <Button variant="ghost" size="md" onClick={scrollToCatalog}>
              {t('home.browseCatalog')}
            </Button>
          </div>
        </div>
      </section>

      {/* ─── SAVED DECKS ──────────────────────────────────────── */}
      {decks.length > 0 && (
        <section className="mx-auto max-w-6xl space-y-6 px-4 pb-16">
          <header className="flex items-center justify-between border-t border-hairline pt-8">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-mono-label tabular-nums tracking-mono-label text-cream-400">
                {String(decks.length).padStart(2, '0')}
              </span>
              <h2 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
                {t('deck.yourDecks')}
              </h2>
            </div>
            <Link to="/deck/new" className="outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900">
              <Button variant="secondary" size="sm">
                {t('nav.newDeck')}
              </Button>
            </Link>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((d, i) => {
              const totalCards = getTotalCards(d.cards)
              const letterIndex = String.fromCharCode(97 + (i % 26))
              return (
                <div
                  key={d.id}
                  className="group relative border border-hairline p-5 transition-colors hover:border-hairline-strong"
                >
                  {/* Marginal catalog letter */}
                  <span
                    aria-hidden="true"
                    className="absolute left-2 top-2 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500"
                  >
                    {letterIndex}
                  </span>

                  <Link to="/deck/$id" params={{ id: d.id }} className="block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900">
                    <div className="pl-4">
                      <h3 className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100">
                        {d.name}
                      </h3>
                      <div className="mt-3">
                        <DeckMeta format={d.format} totalCards={totalCards} colors={d.colors} />
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteDeck(d.id)}
                    className="absolute bottom-2 right-2 cursor-pointer font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500 opacity-0 transition-all hover:text-ink-red-bright group-hover:opacity-100"
                  >
                    {t('deck.delete')}
                  </button>
                </div>
              )
            })}
          </div>

          {/* "Continue reading" rule into the full archive. */}
          <Link
            to="/decks"
            className="group flex items-center gap-4 border-t border-hairline pt-6 outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
          >
            <span className="h-px flex-1 bg-hairline transition-colors group-hover:bg-hairline-strong" />
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors group-hover:text-ink-red-bright">
              {t('home.seeAllDecks')}
              <span aria-hidden="true">{' \u2192'}</span>
            </span>
            <span className="h-px flex-1 bg-hairline transition-colors group-hover:bg-hairline-strong" />
          </Link>
        </section>
      )}

      {decks.length === 0 && (
        <section className="mx-auto max-w-2xl px-4 pb-16">
          <div className="border-t border-hairline pt-12">
            <EmptyState
              title={t('deck.yourDecks')}
              description={t('home.emptyHint')}
              action={
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <Link to="/deck/new" className="outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900">
                    <Button variant="primary" size="lg">
                      {t('deck.createFirst')}
                    </Button>
                  </Link>
                  <Button variant="secondary" size="md" onClick={importSampleDecks}>
                    {t('deck.loadSamples')}
                  </Button>
                </div>
              }
            />
          </div>
        </section>
      )}

      {/* ─── CATALOG (LAUNCHER) ──────────────────────────────── */}
      {/* Teaser only: the full card-search experience lives at `/cards`.
          Typing a character redirects there with the query preserved. */}
      <section ref={catalogRef} className="mx-auto max-w-4xl space-y-8 px-4 pb-24 pt-8">
        <header className="flex items-baseline justify-between border-t border-hairline pt-8">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
              {t('cards.eyebrow')}
            </span>
            <h2 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
              {t('cards.title')}
            </h2>
          </div>
          <Link
            to="/cards"
            className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-ink-red-bright"
          >
            {t('nav.cards')}
            <span aria-hidden="true">{' \u2192'}</span>
          </Link>
        </header>

        <SearchInput
          value=""
          onChange={handleLauncherChange}
          placeholder={t('search.placeholder')}
        />
        <p className="font-mono text-mono-marginal text-cream-500">{t('home.searchHint')}</p>
      </section>

      <ConfirmModal
        open={pendingDeleteDeckId !== null}
        title={t('confirm.deleteDeckTitle')}
        body={t('confirm.deleteDeckBody')}
        confirmLabel={t('confirm.deleteDeckConfirm')}
        cancelLabel={t('confirm.cancel')}
        onConfirm={confirmDeleteDeck}
        onCancel={() => setPendingDeleteDeckId(null)}
      />
    </Layout>
  )
}
