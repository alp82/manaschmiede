import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { SearchInput } from './SearchInput'
import { FilterBar, type ColorMode, type FilterType } from './FilterBar'
import { CardGrid, CardGridSkeleton } from './CardGrid'
import { CardLightbox } from './CardLightbox'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { ErrorBox } from './ui/ErrorBox'
import { cardSearchOptions } from '../lib/scryfall/queries'
import { useDeckSounds } from '../lib/sounds'
import { useT } from '../lib/i18n'
import type { ManaColor } from './ManaSymbol'
import type { ScryfallCard } from '../lib/scryfall/types'

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

/**
 * Full card-search experience: URL-bound filter state (nuqs), Scryfall
 * query assembly, results grid, and lightbox. Self-contained so it can be
 * dropped into any route without additional wiring — both the homepage
 * catalog section and the dedicated `/cards` route mount this.
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

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

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
