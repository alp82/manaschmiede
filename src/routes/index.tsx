import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { Layout } from '../components/Layout'
import { SearchInput } from '../components/SearchInput'
import { FilterBar, type ColorMode, type FilterType } from '../components/FilterBar'
import { CardGrid, CardGridSkeleton } from '../components/CardGrid'
import { CardLightbox } from '../components/CardLightbox'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorBox } from '../components/ui/ErrorBox'
import { cardSearchOptions } from '../lib/scryfall/queries'
import { FORMAT_LABELS } from '../lib/deck-utils'
import { loadDecks, deleteDeck as deleteStoredDeck, type LocalDeck } from '../lib/deck-storage'
import { useSampleDecks } from '../lib/useSampleDecks'
import { useDeckSounds } from '../lib/sounds'
import { useT } from '../lib/i18n'
import type { ManaColor } from '../components/ManaSymbol'
import type { ScryfallCard } from '../lib/scryfall/types'

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

interface BuildQueryInput {
  search: string
  colors: Set<ManaColor>
  colorMode: ColorMode
  cardType: string
  cmc: string
  format: string
  budgetMin: number | null
  budgetMax: number | null
  rarities: Set<string>
  keyword: string
  powerMin: number | null
  powerMax: number | null
  toughnessMin: number | null
  toughnessMax: number | null
  setCode: string
}

function buildScryfallQuery(input: BuildQueryInput): string {
  const parts: string[] = []
  if (input.search) {
    const escaped = input.search.replace(/[()]/g, '')
    parts.push(`(${escaped} or o:${escaped})`)
  }
  if (input.colors.size > 0) {
    const colorChars = Array.from(input.colors).map((c) => c.toLowerCase())
    if (input.colorMode === 'any') {
      // ANY mode → card has at least one of the selected colors.
      // Scryfall has no single-expression "any of" operator for colors, so we
      // emit a parenthesised OR chain.
      parts.push('(' + colorChars.map((c) => 'c:' + c).join(' OR ') + ')')
    } else {
      // ALL mode → card's own colors contain every selected color.
      parts.push('c>=' + colorChars.join(''))
    }
  }
  if (input.cardType) parts.push('t:' + input.cardType)
  if (input.cmc) {
    if (input.cmc === '7+') parts.push('cmc>=7')
    else parts.push('cmc=' + input.cmc)
  }
  if (input.format && input.format !== 'casual') parts.push('f:' + input.format)
  if (input.budgetMin != null) parts.push('usd>=' + input.budgetMin.toFixed(2))
  if (input.budgetMax != null) parts.push('usd<=' + input.budgetMax.toFixed(2))
  if (input.rarities.size > 0 && input.rarities.size < 4) {
    parts.push('(' + Array.from(input.rarities).map((r) => 'r:' + r).join(' OR ') + ')')
  }
  if (input.keyword) parts.push('keyword:' + input.keyword)
  if (input.powerMin != null) parts.push('pow>=' + input.powerMin)
  if (input.powerMax != null) parts.push('pow<=' + input.powerMax)
  if (input.toughnessMin != null) parts.push('tou>=' + input.toughnessMin)
  if (input.toughnessMax != null) parts.push('tou<=' + input.toughnessMax)
  if (input.setCode) parts.push('s:' + input.setCode.toLowerCase())
  return parts.join(' ')
}

// ─── nuqs encoding helpers ────────────────────────────────────────────
// Sets are encoded compactly into single-char codes so the URL stays short:
//   colors  → "WUBRG" substring ("WU", "RG", …)
//   rarity  → first-letter codes (c/u/r/m)
//   filters → comma-separated full names (they're the developer-facing enum)
const RARITY_CODE_TO_NAME: Record<string, string> = {
  c: 'common',
  u: 'uncommon',
  r: 'rare',
  m: 'mythic',
}
const RARITY_NAME_TO_CODE: Record<string, string> = {
  common: 'c',
  uncommon: 'u',
  rare: 'r',
  mythic: 'm',
}
const MANA_CODES = new Set<ManaColor>(['W', 'U', 'B', 'R', 'G'])
const FILTER_NAMES = new Set<FilterType>([
  'type',
  'cmc',
  'format',
  'keyword',
  'rarity',
  'budget',
  'stats',
  'set',
])

function decodeColors(s: string): Set<ManaColor> {
  const out = new Set<ManaColor>()
  for (const ch of s.toUpperCase()) {
    if (MANA_CODES.has(ch as ManaColor)) out.add(ch as ManaColor)
  }
  return out
}

function decodeRarities(s: string): Set<string> {
  const out = new Set<string>()
  for (const ch of s.toLowerCase()) {
    const name = RARITY_CODE_TO_NAME[ch]
    if (name) out.add(name)
  }
  return out
}

function decodeActiveFilters(s: string): Set<FilterType> {
  const out = new Set<FilterType>()
  if (!s) return out
  for (const part of s.split(',')) {
    if (FILTER_NAMES.has(part as FilterType)) out.add(part as FilterType)
  }
  return out
}

function HomePage() {
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

  // All card-search filter state lives in the URL via nuqs. Single
  // `useQueryStates` call so every setter updates the URL atomically.
  // `history: 'replace'` keeps the back button from being buried under
  // dozens of filter tweaks.
  const [params, setParams] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      colors: parseAsString.withDefault(''),
      cmode: parseAsStringLiteral(['all', 'any'] as const).withDefault('all'),
      type: parseAsString.withDefault(''),
      cmc: parseAsString.withDefault(''),
      format: parseAsString.withDefault(''),
      rarity: parseAsString.withDefault(''),
      keyword: parseAsString.withDefault(''),
      bmin: parseAsInteger,
      bmax: parseAsInteger,
      pmin: parseAsInteger,
      pmax: parseAsInteger,
      tmin: parseAsInteger,
      tmax: parseAsInteger,
      set: parseAsString.withDefault(''),
      filters: parseAsString.withDefault(''),
    },
    { history: 'replace' },
  )

  // Decode typed views of the URL state. These are memoised so FilterBar
  // sees stable Set identities across unrelated param changes.
  const search = params.q
  const selectedColors = useMemo(() => decodeColors(params.colors), [params.colors])
  const colorMode: ColorMode = params.cmode
  const cardType = params.type
  const cmc = params.cmc
  const format = params.format
  const selectedRarities = useMemo(() => decodeRarities(params.rarity), [params.rarity])
  const keyword = params.keyword
  const budgetMin = params.bmin
  const budgetMax = params.bmax
  const powerMin = params.pmin
  const powerMax = params.pmax
  const toughnessMin = params.tmin
  const toughnessMax = params.tmax
  const setCode = params.set
  const activeFilters = useMemo(() => decodeActiveFilters(params.filters), [params.filters])

  const [decks, setDecks] = useState<LocalDeck[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
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

  const query = useMemo(
    () =>
      buildScryfallQuery({
        search,
        colors: selectedColors,
        colorMode,
        cardType,
        cmc,
        format,
        budgetMin,
        budgetMax,
        rarities: selectedRarities,
        keyword,
        powerMin,
        powerMax,
        toughnessMin,
        toughnessMax,
        setCode,
      }),
    [
      search,
      selectedColors,
      colorMode,
      cardType,
      cmc,
      format,
      budgetMin,
      budgetMax,
      selectedRarities,
      keyword,
      powerMin,
      powerMax,
      toughnessMin,
      toughnessMax,
      setCode,
    ],
  )

  const hasFilters =
    selectedColors.size > 0 ||
    cardType !== '' ||
    cmc !== '' ||
    format !== '' ||
    budgetMin != null ||
    budgetMax != null ||
    selectedRarities.size > 0 ||
    keyword !== '' ||
    powerMin != null ||
    powerMax != null ||
    toughnessMin != null ||
    toughnessMax != null ||
    setCode !== ''
  const hasSearch = search.length >= 1 || hasFilters

  const { data, isLoading, isError, error } = useQuery({
    ...cardSearchOptions(query),
    enabled: hasSearch && query.length > 0,
  })

  const cards: ScryfallCard[] = data?.data ?? []

  // ── Filter setters (all go through `setParams`). Passing the parser's
  // default (empty string / null) strips the param from the URL, so the URL
  // stays clean when filters are in their neutral state.

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
      const next = Array.from(current).sort().join('')
      setParams({ colors: next || null })
    },
    [params.colors, setParams],
  )

  const setColorMode = useCallback(
    (mode: ColorMode) => {
      setParams({ cmode: mode })
    },
    [setParams],
  )

  const toggleRarity = useCallback(
    (rarity: string) => {
      const current = decodeRarities(params.rarity)
      if (current.has(rarity)) current.delete(rarity)
      else current.add(rarity)
      const encoded = Array.from(current)
        .map((r) => RARITY_NAME_TO_CODE[r])
        .filter(Boolean)
        .join('')
      setParams({ rarity: encoded || null })
    },
    [params.rarity, setParams],
  )

  function encodeActiveFilters(set: Set<FilterType>): string | null {
    if (set.size === 0) return null
    return Array.from(set).join(',')
  }

  function filterResetPatch(type: FilterType): Record<string, null> {
    switch (type) {
      case 'type':
        return { type: null }
      case 'cmc':
        return { cmc: null }
      case 'format':
        return { format: null }
      case 'keyword':
        return { keyword: null }
      case 'rarity':
        return { rarity: null }
      case 'budget':
        return { bmin: null, bmax: null }
      case 'stats':
        return { pmin: null, pmax: null, tmin: null, tmax: null }
      case 'set':
        return { set: null }
    }
  }

  const addFilter = useCallback(
    (type: FilterType) => {
      const next = decodeActiveFilters(params.filters)
      next.add(type)
      setParams({ filters: encodeActiveFilters(next) })
    },
    [params.filters, setParams],
  )

  const removeFilter = useCallback(
    (type: FilterType) => {
      const next = decodeActiveFilters(params.filters)
      next.delete(type)
      setParams({ ...filterResetPatch(type), filters: encodeActiveFilters(next) })
    },
    [params.filters, setParams],
  )

  const clearAllFilters = useCallback(() => {
    const patch: Record<string, null> = { filters: null }
    for (const type of decodeActiveFilters(params.filters)) {
      Object.assign(patch, filterResetPatch(type))
    }
    setParams(patch)
  }, [params.filters, setParams])

  function deleteDeck(deckId: string) {
    if (!confirm(t('deck.deleteConfirm'))) return
    deleteStoredDeck(deckId)
    setDecks((prev) => prev.filter((d) => d.id !== deckId))
  }

  function handleCardClick(card: ScryfallCard) {
    const idx = cards.findIndex((c) => c.id === card.id)
    if (idx >= 0) { setLightboxIndex(idx); sounds.cardOpen() }
  }

  function scrollToCatalog() {
    catalogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
            <Link to="/deck/new" className="outline-none">
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
            <Link to="/deck/new" className="outline-none">
              <Button variant="secondary" size="sm">
                {t('nav.newDeck')}
              </Button>
            </Link>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((d, i) => {
              const totalCards = d.cards.reduce((sum, c) => sum + c.quantity, 0)
              const letterIndex = String.fromCharCode(97 + (i % 26))
              return (
                <div
                  key={d.id}
                  className="group relative border border-hairline bg-ash-800/40 p-5 transition-colors hover:border-hairline-strong"
                >
                  {/* Marginal catalog letter */}
                  <span
                    aria-hidden="true"
                    className="absolute left-2 top-2 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500"
                  >
                    {letterIndex}
                  </span>

                  <Link to="/deck/$id" params={{ id: d.id }} className="block">
                    <div className="pl-4">
                      <h3 className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100">
                        {d.name}
                      </h3>
                      <div className="mt-3 flex items-center gap-3 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400">
                        <span className="text-ink-red-bright">{FORMAT_LABELS[d.format]}</span>
                        <span className="h-px w-4 bg-hairline" aria-hidden="true" />
                        <span>{t('deck.cards', { count: totalCards })}</span>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteDeck(d.id)}
                    className="absolute bottom-2 right-2 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500 opacity-0 transition-all hover:text-ink-red-bright group-hover:opacity-100"
                  >
                    {t('deck.delete')}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {decks.length === 0 && (
        <section className="mx-auto max-w-2xl px-4 pb-16">
          <div className="border-t border-hairline pt-12">
            <EmptyState
              title={t('deck.yourDecks')}
              description={t('home.emptyHint') || 'No decks yet — forge your first, or load the sample catalog.'}
              action={
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <Link to="/deck/new" className="outline-none">
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

      {/* ─── CATALOG (CARD SEARCH) ───────────────────────────── */}
      <section ref={catalogRef} className="mx-auto max-w-7xl space-y-8 px-4 pb-24 pt-8">
        <header className="flex items-baseline justify-between border-t border-hairline pt-8">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
              Index
            </span>
            <h2 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
              {t('search.cardSearch')}
            </h2>
          </div>
        </header>

        <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder')} />

        <FilterBar
          selectedColors={selectedColors}
          onToggleColor={toggleColor}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          activeFilters={activeFilters}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilter}
          onClearAll={clearAllFilters}
          cardType={cardType}
          onCardTypeChange={(v) => setParams({ type: v || null })}
          cmc={cmc}
          onCmcChange={(v) => setParams({ cmc: v || null })}
          format={format}
          onFormatChange={(v) => setParams({ format: v || null })}
          budgetMin={budgetMin}
          budgetMax={budgetMax}
          onBudgetChange={(min, max) => setParams({ bmin: min, bmax: max })}
          selectedRarities={selectedRarities}
          onToggleRarity={toggleRarity}
          keyword={keyword}
          onKeywordChange={(v) => setParams({ keyword: v || null })}
          powerMin={powerMin}
          powerMax={powerMax}
          onPowerChange={(min, max) => setParams({ pmin: min, pmax: max })}
          onPowerAndToughnessChange={(min, max) =>
            setParams({ pmin: min, pmax: max, tmin: min, tmax: max })
          }
          toughnessMin={toughnessMin}
          toughnessMax={toughnessMax}
          onToughnessChange={(min, max) => setParams({ tmin: min, tmax: max })}
          setCode={setCode}
          onSetCodeChange={(v) => setParams({ set: v || null })}
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
      </section>

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
    </Layout>
  )
}
