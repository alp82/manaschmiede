import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { SearchInput } from '../components/SearchInput'
import { FilterBar } from '../components/FilterBar'
import { CardGrid, CardGridSkeleton } from '../components/CardGrid'
import { CardLightbox } from '../components/CardLightbox'
import { cardSearchOptions } from '../lib/scryfall/queries'
import { FORMAT_LABELS, type DeckFormat } from '../lib/deck-utils'
import { useSampleDecks } from '../lib/useSampleDecks'
import { useT, useI18n } from '../lib/i18n'
import type { ManaColor } from '../components/ManaSymbol'
import type { ScryfallCard } from '../lib/scryfall/types'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface LocalDeck {
  id: string
  name: string
  format: DeckFormat
  cards: { scryfallId: string; quantity: number; zone: string }[]
  updatedAt: number
}

function buildScryfallQuery(
  search: string,
  colors: Set<ManaColor>,
  cardType: string,
  cmc: string,
  scryfallLang: string,
  format: string,
  budget: string,
  rarities: Set<string>,
  keyword: string,
): string {
  const parts: string[] = []
  if (search) {
    // Search across name, oracle text, and type line
    const escaped = search.replace(/[()]/g, '')
    parts.push(`(${escaped} or o:${escaped})`)
  }
  if (scryfallLang !== 'en') parts.push(`lang:${scryfallLang}`)
  if (colors.size > 0) {
    const colorStr = Array.from(colors).join('').toLowerCase()
    parts.push('c>=' + colorStr)
  }
  if (cardType) parts.push('t:' + cardType)
  if (cmc) {
    if (cmc === '7+') parts.push('cmc>=7')
    else parts.push('cmc=' + cmc)
  }
  if (format && format !== 'casual') parts.push('f:' + format)
  if (budget) parts.push('usd<=' + budget)
  if (rarities.size > 0 && rarities.size < 4) {
    parts.push('(' + Array.from(rarities).map((r) => 'r:' + r).join(' OR ') + ')')
  }
  if (keyword) parts.push('keyword:' + keyword)
  return parts.join(' ')
}

function HomePage() {
  const t = useT()
  const { scryfallLang } = useI18n()
  const [search, setSearch] = useState('')
  const [selectedColors, setSelectedColors] = useState<Set<ManaColor>>(new Set())
  const [cardType, setCardType] = useState('')
  const [cmc, setCmc] = useState('')
  const [format, setFormat] = useState('')
  const [budget, setBudget] = useState('')
  const [selectedRarities, setSelectedRarities] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [decks, setDecks] = useState<LocalDeck[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const reloadDecks = useCallback(() => {
    const stored = JSON.parse(localStorage.getItem('manaschmiede-decks') || '[]')
    setDecks(stored)
  }, [])

  useEffect(() => {
    reloadDecks()
  }, [reloadDecks])

  const { importAll: importSampleDecks } = useSampleDecks(reloadDecks)

  const query = useMemo(
    () => buildScryfallQuery(search, selectedColors, cardType, cmc, scryfallLang, format, budget, selectedRarities, keyword),
    [search, selectedColors, cardType, cmc, scryfallLang, format, budget, selectedRarities, keyword],
  )

  const hasFilters = selectedColors.size > 0 || cardType !== '' || cmc !== '' || format !== '' || budget !== '' || selectedRarities.size > 0 || keyword !== ''
  const hasSearch = search.length >= 2 || hasFilters

  const { data, isLoading, isError, error } = useQuery({
    ...cardSearchOptions(query),
    enabled: hasSearch && query.length > 0,
  })

  const cards: ScryfallCard[] = data?.data ?? []

  function toggleColor(color: ManaColor) {
    setSelectedColors((prev) => {
      const next = new Set(prev)
      if (next.has(color)) next.delete(color)
      else next.add(color)
      return next
    })
  }

  function toggleRarity(rarity: string) {
    setSelectedRarities((prev) => {
      const next = new Set(prev)
      if (next.has(rarity)) next.delete(rarity)
      else next.add(rarity)
      return next
    })
  }

  function deleteDeck(deckId: string) {
    if (!confirm(t('deck.deleteConfirm'))) return
    const updated = decks.filter((d) => d.id !== deckId)
    setDecks(updated)
    localStorage.setItem('manaschmiede-decks', JSON.stringify(updated))
  }

  function handleCardClick(card: ScryfallCard) {
    const idx = cards.findIndex((c) => c.id === card.id)
    if (idx >= 0) setLightboxIndex(idx)
  }

  return (
    <Layout>
      <div className="space-y-6">
        {decks.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl text-surface-200">{t('deck.yourDecks')}</h2>
              <Link
                to="/deck/new"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                {t('nav.newDeck')}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {decks.map((d) => {
                const totalCards = d.cards.reduce((sum, c) => sum + c.quantity, 0)
                return (
                  <div key={d.id} className="group rounded-xl border border-surface-700 bg-surface-800/50 p-4 transition-colors hover:border-surface-500">
                    <Link to="/deck/$id" params={{ id: d.id }} className="block">
                      <h3 className="font-display text-lg text-surface-100">{d.name}</h3>
                      <div className="mt-1 flex items-center gap-2 text-xs text-surface-400">
                        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-accent">
                          {FORMAT_LABELS[d.format]}
                        </span>
                        <span>{t('deck.cards', { count: totalCards })}</span>
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteDeck(d.id)}
                      className="mt-2 text-xs text-surface-500 opacity-0 hover:text-mana-red group-hover:opacity-100"
                    >
                      {t('deck.delete')}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {decks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-4">
            <Link
              to="/deck/new"
              className="rounded-lg bg-accent px-6 py-3 font-medium text-white hover:bg-accent-hover"
            >
              {t('deck.createFirst')}
            </Link>
            <button
              type="button"
              onClick={importSampleDecks}
              className="rounded-lg border border-surface-600 px-6 py-3 text-sm text-surface-300 transition-colors hover:border-surface-500 hover:text-surface-100"
            >
              {t('deck.loadSamples')}
            </button>
          </div>
        )}

        <div>
          <h2 className="mb-3 font-display text-xl text-surface-200">{t('search.cardSearch')}</h2>
          <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder')} />
        </div>

        <FilterBar
          selectedColors={selectedColors}
          onToggleColor={toggleColor}
          cardType={cardType}
          onCardTypeChange={setCardType}
          cmc={cmc}
          onCmcChange={setCmc}
          format={format}
          onFormatChange={setFormat}
          budget={budget}
          onBudgetChange={setBudget}
          selectedRarities={selectedRarities}
          onToggleRarity={toggleRarity}
          keyword={keyword}
          onKeywordChange={setKeyword}
        />

        {!hasSearch ? (
          <div className="flex flex-col items-center justify-center py-12 text-surface-500">
            <p className="font-display text-2xl">{t('search.welcome')}</p>
            <p className="mt-2 text-sm">{t('search.welcomeSub')}</p>
          </div>
        ) : isLoading ? (
          <CardGridSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-mana-red">
            <p className="text-lg">{t('search.error')}</p>
            <p className="text-sm text-surface-400">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-surface-400">{t('search.results', { count: data?.total_cards ?? 0 })}</p>
            <CardGrid cards={cards} searchTerm={search} onCardClick={handleCardClick} />
          </>
        )}
      </div>

      {lightboxIndex !== null && cards.length > 0 && (
        <CardLightbox
          cards={cards}
          currentIndex={lightboxIndex}
          searchTerm={search}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </Layout>
  )
}
