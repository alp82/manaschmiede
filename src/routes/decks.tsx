import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { DeckMeta } from '../components/ui/DeckMeta'
import { EmptyState } from '../components/ui/EmptyState'
import { useLocalizedCard } from '../lib/scryfall/useLocalizedCard'
import { getCardImageUri, getCardName } from '../lib/scryfall/types'
import { getCardsCollection, getLocalizedCardData } from '../lib/scryfall/client'
import { scryfallKeys } from '../lib/scryfall/queries'
import { loadDecks, type LocalDeck } from '../lib/deck-storage'
import { getTotalCards } from '../lib/deck-utils'
import { useT, useI18n } from '../lib/i18n'
import type { ScryfallCard } from '../lib/scryfall/types'

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
  const [decks] = useState<LocalDeck[]>(() => loadDecks())

  // Collect every unique featured card id across all decks, then issue one
  // /cards/collection batch. Results seed React Query's cache so the
  // per-row useLocalizedCard hooks below hit the cache instead of firing
  // N separate requests.
  const allFeaturedIds = useMemo(() => {
    const set = new Set<string>()
    for (const d of decks) {
      for (const id of d.featuredCardIds ?? []) {
        if (id) set.add(id)
      }
    }
    return Array.from(set)
  }, [decks])

  useQuery({
    queryKey: [...scryfallKeys.all, 'collection', allFeaturedIds.slice().sort().join(',')],
    queryFn: async () => {
      const batch = await getCardsCollection(allFeaturedIds)
      for (const card of batch) {
        // Seed both the default (English) cache key and the active locale's
        // key so useLocalizedCard on the current locale finds something
        // immediately. Localization upgrades overwrite the latter below.
        queryClient.setQueryData(scryfallKeys.card(card.id, card.lang), card)
        queryClient.setQueryData(scryfallKeys.card(card.id, scryfallLang), card)
      }
      if (scryfallLang !== 'en') {
        for (const card of batch) {
          getLocalizedCardData(card, card.id, card.set, card.collector_number, scryfallLang)
            .then((localized) => {
              if (!localized || localized.lang !== scryfallLang) return
              queryClient.setQueryData(
                scryfallKeys.card(card.id, scryfallLang),
                localized,
              )
            })
            .catch(() => {})
        }
      }
      return batch
    },
    enabled: allFeaturedIds.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
  })

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
          <p className="font-mono text-mono-marginal text-cream-500">{t('decks.variantHint')}</p>
        </header>
      </section>

      {decks.length === 0 ? (
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
        <div className="space-y-16 pb-24">
          {decks.map((d) => (
            <DeckRow key={d.id} deck={d} />
          ))}
        </div>
      )}
    </Layout>
  )
}

/* ────────────────────────────────────────────────────────────
 * Deck row: one heading + four variants
 * ──────────────────────────────────────────────────────────── */

function useFeaturedCards(ids: (string | undefined)[]) {
  // Three hooks at fixed positions so hook ordering stays stable across renders.
  // Cap at 3 IDs.
  const card0 = useLocalizedCard({ id: ids[0], enabled: Boolean(ids[0]) })
  const card1 = useLocalizedCard({ id: ids[1], enabled: Boolean(ids[1]) })
  const card2 = useLocalizedCard({ id: ids[2], enabled: Boolean(ids[2]) })
  return [
    { id: ids[0], data: card0.data ?? undefined, loading: card0.isLoading },
    { id: ids[1], data: card1.data ?? undefined, loading: card1.isLoading },
    { id: ids[2], data: card2.data ?? undefined, loading: card2.isLoading },
  ] as Array<{ id: string | undefined; data: ScryfallCard | undefined; loading: boolean }>
}

function DeckRow({ deck }: { deck: LocalDeck }) {
  const t = useT()
  const totalCards = getTotalCards(deck.cards)
  const featuredIds = deck.featuredCardIds ?? []
  const cards = useFeaturedCards(featuredIds)

  return (
    <article className="space-y-6">
      {/* ─── Deck heading — Cinzel name between hairlines ─── */}
      <header className="space-y-2">
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
          <h2 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
            {deck.name}
          </h2>
          <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-center">
          <DeckMeta format={deck.format} totalCards={totalCards} colors={deck.colors} />
        </div>
      </header>

      {/* ─── Four variants side by side ───────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <VariantTile
          deckId={deck.id}
          label={t('decks.variant.stacked')}
          indexLabel="A"
        >
          <VariantStacked cards={cards} noPreview={t('decks.noPreview')} />
        </VariantTile>

        <VariantTile
          deckId={deck.id}
          label={t('decks.variant.triptych')}
          indexLabel="B"
        >
          <VariantTriptych cards={cards} noPreview={t('decks.noPreview')} />
        </VariantTile>

        <VariantTile
          deckId={deck.id}
          label={t('decks.variant.featured')}
          indexLabel="C"
        >
          <VariantFeatured
            cards={cards}
            deck={deck}
            noPreview={t('decks.noPreview')}
          />
        </VariantTile>

        <VariantTile
          deckId={deck.id}
          label={t('decks.variant.banner')}
          indexLabel="D"
        >
          <VariantBanner
            cards={cards}
            deck={deck}
            noPreview={t('decks.noPreview')}
          />
        </VariantTile>
      </div>
    </article>
  )
}

/* ────────────────────────────────────────────────────────────
 * Shared tile chrome — wraps each variant in a clickable link
 * with a mono eyebrow and hairline hover. Every tile is the
 * same height so the four-up reads as a gallery.
 * ──────────────────────────────────────────────────────────── */

interface VariantTileProps {
  deckId: string
  label: string
  indexLabel: string
  children: React.ReactNode
}

function VariantTile({ deckId, label, indexLabel, children }: VariantTileProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
          {indexLabel}
        </span>
        <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
          {label}
        </span>
      </div>
      <Link
        to="/deck/$id"
        params={{ id: deckId }}
        className="group block cursor-pointer border border-hairline transition-colors hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
      >
        {children}
      </Link>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * Variant A — Stacked plates
 *   Three full-card plates composed as a fanned stack:
 *     card 0 on top, card 1 offset -12px/+8px rotated -3°,
 *     card 2 offset -24px/+16px rotated +3°.
 *   Cinzel deck name below handled by heading row; this plate
 *   contains only the visual composition.
 * ──────────────────────────────────────────────────────────── */

interface VariantCardData {
  id: string | undefined
  data: ScryfallCard | undefined
  loading: boolean
}

function VariantStacked({
  cards,
  noPreview,
}: {
  cards: VariantCardData[]
  noPreview: string
}) {
  const hasAny = cards.some((c) => c.id)
  if (!hasAny) return <NoPreviewPlate label={noPreview} />

  return (
    <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden p-6">
      {/* Card 2 — bottom-left, rotated +3° */}
      <div
        className="absolute left-1/2 top-1/2 w-[55%]"
        style={{ transform: 'translate(-50%, -50%) translate(-24px, 16px) rotate(3deg)' }}
      >
        <CardPlate card={cards[2]?.data} loading={cards[2]?.loading} />
      </div>
      {/* Card 1 — mid-left, rotated -3° */}
      <div
        className="absolute left-1/2 top-1/2 w-[55%]"
        style={{ transform: 'translate(-50%, -50%) translate(-12px, 8px) rotate(-3deg)' }}
      >
        <CardPlate card={cards[1]?.data} loading={cards[1]?.loading} />
      </div>
      {/* Card 0 — on top, centered, no rotation */}
      <div
        className="absolute left-1/2 top-1/2 w-[55%]"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <CardPlate card={cards[0]?.data} loading={cards[0]?.loading} />
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * Variant B — Triptych strip
 *   Three cards side by side as equal thirds, shared top and
 *   bottom, hairline dividers between.
 * ──────────────────────────────────────────────────────────── */

function VariantTriptych({
  cards,
  noPreview,
}: {
  cards: VariantCardData[]
  noPreview: string
}) {
  const hasAny = cards.some((c) => c.id)
  if (!hasAny) return <NoPreviewPlate label={noPreview} />

  return (
    <div className="flex aspect-[3/4] items-center p-4">
      <div className="grid h-full w-full grid-cols-3 items-center gap-0">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={
              i > 0
                ? 'flex h-full items-center justify-center border-l border-hairline px-1'
                : 'flex h-full items-center justify-center px-1'
            }
          >
            <CardPlate card={cards[i]?.data} loading={cards[i]?.loading} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * Variant C — Featured + sidekicks
 *   Card 0 large on the left (~65% width), cards 1 and 2
 *   stacked vertically on the right (~35% width, ~50% height
 *   each). Mono format/colors line along the bottom.
 * ──────────────────────────────────────────────────────────── */

function VariantFeatured({
  cards,
  deck,
  noPreview,
}: {
  cards: VariantCardData[]
  deck: LocalDeck
  noPreview: string
}) {
  const hasAny = cards.some((c) => c.id)
  if (!hasAny) return <NoPreviewPlate label={noPreview} />

  return (
    <div className="flex aspect-[3/4] flex-col">
      <div className="flex min-h-0 flex-1 gap-2 p-3">
        {/* Left — large featured */}
        <div className="flex flex-[65] items-center justify-center">
          <CardPlate card={cards[0]?.data} loading={cards[0]?.loading} />
        </div>
        {/* Right — stacked sidekicks */}
        <div className="flex flex-[35] flex-col gap-2">
          <div className="flex flex-1 items-center justify-center">
            <CardPlate card={cards[1]?.data} loading={cards[1]?.loading} />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <CardPlate card={cards[2]?.data} loading={cards[2]?.loading} />
          </div>
        </div>
      </div>
      {/* Bottom metadata row */}
      <div className="border-t border-hairline px-4 py-3">
        <DeckMeta format={deck.format} totalCards={getTotalCards(deck.cards)} colors={deck.colors} />
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * Variant D — Art crop banner
 *   Full-width horizontal banner using only card 0's art_crop.
 *   Cinzel deck name overlaid on the lower third between thin
 *   cream hairlines. Mono metadata floats top-right.
 * ──────────────────────────────────────────────────────────── */

function VariantBanner({
  cards,
  deck,
  noPreview,
}: {
  cards: VariantCardData[]
  deck: LocalDeck
  noPreview: string
}) {
  const first = cards[0]
  if (!first?.id) return <NoPreviewPlate label={noPreview} />

  const art = first.data ? getCardImageUri(first.data, 'art_crop') : undefined
  const name = first.data ? getCardName(first.data) : ''

  return (
    <div className="relative aspect-[3/4] overflow-hidden">
      {/* Art plate */}
      {first.loading && !art && (
        <div className="absolute inset-0 animate-pulse bg-ash-800" aria-hidden="true" />
      )}
      {art ? (
        <img
          src={art}
          alt={name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : !first.loading ? (
        <div className="absolute inset-0 bg-ash-800" aria-hidden="true" />
      ) : null}

      {/* Ash scrim so overlaid text stays legible */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-ash-900/20 via-ash-900/35 to-ash-900/80"
      />

      {/* Top-right floating metadata */}
      <div className="absolute right-3 top-3">
        <DeckMeta format={deck.format} totalCards={getTotalCards(deck.cards)} colors={deck.colors} tone="overlay" />
      </div>

      {/* Lower-third deck name between hairlines */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-5 pt-4">
        <span className="mb-2 block h-px w-full bg-hairline-strong" aria-hidden="true" />
        <p className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100">
          {deck.name}
        </p>
        <span className="mt-2 block h-px w-full bg-hairline" aria-hidden="true" />
      </div>
    </div>
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
 * Neutral text plate shown for variants when the deck has no
 * featuredCardIds (old decks saved before the field existed).
 */
function NoPreviewPlate({ label }: { label: string }) {
  return (
    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 p-6 text-center">
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
