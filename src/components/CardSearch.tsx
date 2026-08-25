import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import { SearchInput } from './SearchInput'
import { FilterBar } from './FilterBar'
import { CardGrid, CardGridSkeleton } from './CardGrid'
import { CardLightbox } from './CardLightbox'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { ErrorBox } from './ui/ErrorBox'
import {
  browseParsers,
  buildScryfallQuery,
  decodeActiveFilters,
  decodeColors,
  decodeFilterState,
  encodeColors,
  hasAnyFilter,
  type ColorMode,
  type FilterPatch,
} from './card-filters'
import { cardSearchOptions } from '../lib/scryfall/queries'
import { useDeckSounds } from '../lib/sounds'
import { useT } from '../lib/i18n'
import type { ManaColor } from '../lib/mana-colors'
import type { ScryfallCard } from '../lib/scryfall/types'

/**
 * Full card-search experience: URL-bound filter state (nuqs), Scryfall
 * query assembly, results grid, and lightbox. Self-contained so it can be
 * dropped into any route without additional wiring — both the homepage
 * catalog section and the dedicated `/cards` route mount this.
 *
 * What a filter *is* lives in `./card-filters`; this component only owns the
 * URL binding and the results.
 */
export function CardSearch() {
  const t = useT()
  const sounds = useDeckSounds()
  const navigate = useNavigate()

  const renderLightboxActions = useCallback(
    (card: ScryfallCard) => (
      <Button
        variant="primary"
        size="md"
        className="w-full"
        onClick={() => {
          sounds.uiClick()
          navigate({ to: '/deck/new', search: { seed: card.id } })
        }}
      >
        {t('wizard.forgeWithCard')}
      </Button>
    ),
    [navigate, sounds, t],
  )

  // All card-search state lives in the URL via nuqs. Single `useQueryStates`
  // call over the registry's own schema, so every setter updates the URL
  // atomically. `history: 'replace'` keeps the back button from being buried
  // under dozens of filter tweaks.
  const [params, setParams] = useQueryStates(browseParsers, { history: 'replace' })

  // Decode typed views of the URL state. Memoised on the whole param object, so
  // a new filter cannot be forgotten in a dependency array.
  const search = params.q
  const selectedColors = useMemo(() => decodeColors(params.colors), [params.colors])
  const colorMode: ColorMode = params.cmode
  const filters = useMemo(() => decodeFilterState(params), [params])
  const activeFilters = useMemo(() => decodeActiveFilters(params.filters), [params.filters])

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const query = buildScryfallQuery({ search, colors: selectedColors, colorMode, filters })
  const hasSearch = search.length >= 1 || hasAnyFilter(selectedColors, filters)

  const { data, isLoading, isError, error } = useQuery({
    ...cardSearchOptions(query),
    enabled: hasSearch && query.length > 0,
  })

  const cards: ScryfallCard[] = data?.data ?? []

  // ── Setters. Everything goes through `setParams`; passing the parser's
  // default (empty string / null) strips the param from the URL, so the URL
  // stays clean when a filter is in its neutral state.

  const setSearch = useCallback(
    (value: string) => {
      setParams({ q: value || null })
    },
    [setParams],
  )

  const toggleColor = useCallback(
    (color: ManaColor) => {
      const current = decodeColors(params.colors)
      if (current.has(color)) current.delete(color)
      else current.add(color)
      setParams({ colors: encodeColors(current) || null })
    },
    [params.colors, setParams],
  )

  const setColorMode = useCallback(
    (mode: ColorMode) => {
      setParams({ cmode: mode })
    },
    [setParams],
  )

  const patchFilters = useCallback(
    (patch: FilterPatch) => {
      setParams(patch)
    },
    [setParams],
  )

  function handleCardClick(card: ScryfallCard) {
    const idx = cards.findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      setLightboxIndex(idx)
      sounds.cardOpen()
    }
  }

  return (
    <>
      <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder')} />

      <FilterBar
        selectedColors={selectedColors}
        onToggleColor={toggleColor}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        activeFilters={activeFilters}
        state={filters}
        onPatch={patchFilters}
      />

      {!hasSearch ? (
        <EmptyState
          title={t('search.welcome')}
          description={t('search.welcomeSub')}
          className="py-16"
        />
      ) : isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <ErrorBox
          title={t('search.error')}
          message={error instanceof Error ? error.message : 'Unknown error'}
        />
      ) : (
        <>
          <p className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400">
            {t('search.results', { count: data?.total_cards ?? 0 })}
          </p>
          <CardGrid cards={cards} searchTerm={search} onCardClick={handleCardClick} />
        </>
      )}

      {lightboxIndex !== null && cards.length > 0 && (
        <CardLightbox
          cards={cards}
          currentIndex={lightboxIndex}
          searchTerm={search}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          renderActions={renderLightboxActions}
        />
      )}
    </>
  )
}
