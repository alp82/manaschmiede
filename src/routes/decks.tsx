import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { DeckMeta } from '../components/ui/DeckMeta'
import { EmptyState } from '../components/ui/EmptyState'
import { getCardImageUri, getCardName } from '../lib/scryfall/types'
import { cardSupply } from '../lib/scryfall/card-supply'
import { scryfallKeys } from '../lib/scryfall/keys'
import { loadDecks, type LocalDeck } from '../lib/deck-storage'
import { getTotalCards } from '../lib/deck-utils'
import { useT, useI18n } from '../lib/i18n'
import type { ScryfallCard } from '../lib/scryfall/types'

/** Preview slots per deck: one featured plate plus two sidekicks. */
const FEATURED_SLOTS = 3

export const Route = createFileRoute('/decks')({
  head: () => ({
    meta: [
      { title: 'Manaschmiede — Your decks' },
      {
        name: 'description',
        content: 'Archive of your forged Magic: the Gathering decks.',
      },
    ],
  }),
  component: DecksPage,
})

function DecksPage() {
  const t = useT()
  const queryClient = useQueryClient()
  const { scryfallLang } = useI18n()

  // Loaded in an effect, not a `useState` initializer: `loadDecks` reads
  // localStorage, so an initializer renders 0 decks on the server and N on the
  // client, and React tears the tree down with a hydration mismatch. Same
  // pattern as `routes/index.tsx`.
  const [decks, setDecks] = useState<LocalDeck[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setDecks(loadDecks())
    setLoaded(true)
  }, [])

  /** Deck id → the ids this deck previews, capped and hole-free. */
  const featuredIdsByDeck = useMemo(() => {
    const byDeck = new Map<string, string[]>()
    for (const deck of decks) {
      const ids = (deck.featuredCardIds ?? []).filter(Boolean).slice(0, FEATURED_SLOTS)
      byDeck.set(deck.id, ids)
    }
    return byDeck
  }, [decks])

  const allFeaturedIds = useMemo(() => {
    const set = new Set<string>()
    for (const ids of featuredIdsByDeck.values()) {
      for (const id of ids) set.add(id)
    }
    return Array.from(set).sort()
  }, [featuredIdsByDeck])

  // ONE `/cards/collection` batch for the whole page, owned here and handed
  // down as data. Per-tile `useLocalizedCard` hooks cannot do this job: React
  // Query fetches from an effect and effects run child-first, so every tile
  // fired its own single-id request before this one could register them as
  // in-flight. Thirty-odd cards then queued behind the client's request
  // spacing and the page finished painting blank plates.
  const featured = useQuery({
    queryKey: [...scryfallKeys.all, 'featured', scryfallLang, allFeaturedIds.join(',')],
    queryFn: async () => {
      const cards = await cardSupply.cardsById(allFeaturedIds, scryfallLang, {
        queryClient,
      })
      // Keyed by the id we asked for. A localized print carries its own
      // Scryfall id, so `card.id` is not a safe lookup key here.
      return Array.from(cards.entries())
    },
    enabled: allFeaturedIds.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
  })

  const cardsById = useMemo(
    () => new Map<string, ScryfallCard>(featured.data ?? []),
    [featured.data],
  )

  return (
    <Layout>
      {/* ─── Header ───────────────────────────────────────────── */}
      <section className="pb-6 pt-4">
        <header className="space-y-2 border-t border-hairline pt-8">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
                {t('decks.eyebrow')}
              </span>
              <h1 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
                {t('decks.title')}
              </h1>
            </div>
            <span className="font-mono text-mono-label tabular-nums tracking-mono-label text-cream-400">
              {String(decks.length).padStart(2, '0')}
            </span>
          </div>
          <p className="font-mono text-mono-marginal text-cream-500">{t('decks.hint')}</p>
        </header>
      </section>

      {!loaded ? null : decks.length === 0 ? (
        <section className="mx-auto max-w-2xl px-4 pb-16 sm:px-6">
          <div className="border-t border-hairline pt-12">
            <EmptyState
              title={t('decks.empty')}
              action={
                <Link to="/deck/new" className="outline-none">
                  <Button variant="primary" size="lg">
                    {t('home.forgeDeck')}
                  </Button>
                </Link>
              }
            />
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-8 pb-24 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              ids={featuredIdsByDeck.get(deck.id) ?? []}
              cardsById={cardsById}
              loading={featured.isPending}
            />
          ))}
        </div>
      )}
    </Layout>
  )
}

/* ────────────────────────────────────────────────────────────
 * Deck tile
 *   Card 0 large on the left, cards 1 and 2 stacked vertically on
 *   the right at half its width, then a hairline and the deck's
 *   name and metadata.
 * ──────────────────────────────────────────────────────────── */

interface DeckTileProps {
  deck: LocalDeck
  ids: string[]
  cardsById: ReadonlyMap<string, ScryfallCard>
  loading: boolean
}

function DeckTile({ deck, ids, cardsById, loading }: DeckTileProps) {
  const t = useT()
  const slots = Array.from({ length: FEATURED_SLOTS }, (_, i) => {
    const id = ids[i]
    return { card: id ? cardsById.get(id) : undefined, loading: Boolean(id) && loading }
  })

  return (
    <article>
      <Link
        to="/deck/$id"
        params={{ id: deck.id }}
        className="group flex cursor-pointer flex-col border border-hairline transition-colors hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
      >
        {ids.length === 0 ? (
          <NoPreviewPlate label={t('decks.noPreview')} />
        ) : (
          // 2:1 is the ratio that makes two stacked sidekicks plus the gap
          // come out the same height as one featured plate, so the row needs
          // no fixed aspect and leaves no dead space under the cards.
          <div className="flex items-center gap-2 p-3">
            {/* Left — large featured */}
            <div className="flex flex-[2] items-center justify-center">
              <CardPlate card={slots[0].card} loading={slots[0].loading} />
            </div>
            {/* Right — stacked sidekicks */}
            <div className="flex flex-1 flex-col gap-2">
              <CardPlate card={slots[1].card} loading={slots[1].loading} />
              <CardPlate card={slots[2].card} loading={slots[2].loading} />
            </div>
          </div>
        )}

        {/* Caption — Cinzel deck name over mono metadata */}
        <div className="space-y-2 border-t border-hairline px-4 py-4">
          <h2 className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100">
            {deck.name}
          </h2>
          <DeckMeta totalCards={getTotalCards(deck.cards)} colors={deck.colors} />
        </div>
      </Link>
    </article>
  )
}

/* ────────────────────────────────────────────────────────────
 * Supporting pieces
 * ──────────────────────────────────────────────────────────── */

/**
 * Renders a single MTG card plate (the card's `normal` image), sharp
 * corners, with a skeleton while the Scryfall hit is in flight and a
 * name-only fallback when the image fails. Card art may carry a soft
 * shadow — explicit Specimen exception for painterly card art.
 */
function CardPlate({ card, loading }: { card?: ScryfallCard; loading?: boolean }) {
  if (loading && !card) {
    return (
      <div
        className="aspect-[488/680] w-full animate-pulse bg-ash-800"
        aria-hidden="true"
      />
    )
  }
  if (!card) {
    return <div className="aspect-[488/680] w-full bg-ash-800" aria-hidden="true" />
  }
  const src = getCardImageUri(card, 'normal')
  const name = getCardName(card)
  if (!src) {
    return (
      <div className="flex aspect-[488/680] w-full items-center justify-center bg-ash-800 p-2">
        <span className="text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-300">
          {name}
        </span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className="aspect-[488/680] w-full object-cover shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
    />
  )
}

/**
 * Neutral text plate shown when the deck has no `featuredCardIds` (old
 * decks saved before the field existed).
 */
function NoPreviewPlate({ label }: { label: string }) {
  return (
    <div className="flex aspect-[16/15] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-300">
        {label}
      </p>
      <span className="h-px w-12 bg-hairline" aria-hidden="true" />
      <p className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
        —
      </p>
    </div>
  )
}
