import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Layout } from '../../components/Layout'
import { SearchInput } from '../../components/SearchInput'
import { FilterBar } from '../../components/FilterBar'
import { CardGridSkeleton } from '../../components/CardGrid'
import { CardImage } from '../../components/CardImage'
import { CardStack } from '../../components/CardStack'
import { CardLightbox } from '../../components/CardLightbox'
import { DeckCardList } from '../../components/DeckCardList'
import { BalanceAdvisor } from '../../components/BalanceAdvisor'
import { AiChat } from '../../components/AiChat'
import { cardSearchOptions } from '../../lib/scryfall/queries'
import { getCardById, getCardInLang } from '../../lib/scryfall/client'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getCardName } from '../../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../../lib/deck-utils'
import { getTotalCards } from '../../lib/deck-utils'
import { useT, useI18n } from '../../lib/i18n'
import type { ManaColor } from '../../components/ManaSymbol'

export const Route = createFileRoute('/deck/$id')({
  component: DeckBuilderPage,
})

interface LocalDeck {
  id: string
  name: string
  description?: string
  format: string
  cards: DeckCard[]
  createdAt: number
  updatedAt: number
}

function loadDeck(id: string): LocalDeck | null {
  const decks: LocalDeck[] = JSON.parse(localStorage.getItem('manaschmiede-decks') || '[]')
  return decks.find((d) => d.id === id) || null
}

function persistDeck(deck: LocalDeck) {
  const decks: LocalDeck[] = JSON.parse(localStorage.getItem('manaschmiede-decks') || '[]')
  const idx = decks.findIndex((d) => d.id === deck.id)
  if (idx >= 0) decks[idx] = deck
  else decks.push(deck)
  localStorage.setItem('manaschmiede-decks', JSON.stringify(decks))
}

function buildScryfallQuery(
  search: string,
  colors: Set<ManaColor>,
  cardType: string,
  cmc: string,
  format: string,
  budget: string,
  rarities: Set<string>,
  keyword: string,
): string {
  const parts: string[] = []
  if (search) parts.push(search)
  if (colors.size > 0) {
    parts.push('c>=' + Array.from(colors).join('').toLowerCase())
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

type MobileTab = 'cards' | 'chat' | 'list'

function DeckBuilderPage() {
  const t = useT()
  const { scryfallLang } = useI18n()
  const { id } = Route.useParams()
  const [deck, setDeck] = useState<LocalDeck | null>(null)
  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null)
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')
  const cardGridRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Search state
  const [search, setSearch] = useState('')
  const [selectedColors, setSelectedColors] = useState<Set<ManaColor>>(new Set())
  const [cardType, setCardType] = useState('')
  const [cmc, setCmc] = useState('')
  const [format, setFormat] = useState('')
  const [budget, setBudget] = useState('')
  const [selectedRarities, setSelectedRarities] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const isSearching = search.length >= 2

  // Load deck
  useEffect(() => {
    const loaded = loadDeck(id)
    if (loaded) {
      setDeck(loaded)
      setDeckName(loaded.name)
      setDeckDescription(loaded.description || '')
    }
  }, [id])

  // Auto-save
  useEffect(() => {
    if (!deck) return
    const timer = setTimeout(() => persistDeck(deck), 500)
    return () => clearTimeout(timer)
  }, [deck])

  // Fetch card data for deck cards (refetch when language changes)
  useEffect(() => {
    if (!deck) return
    for (const dc of deck.cards) {
      const existing = cardDataMap.get(dc.scryfallId)
      if (existing && existing.lang === scryfallLang) continue
      const fetchCard = existing
        ? getCardInLang(existing.set, existing.collector_number, scryfallLang)
        : getCardById(dc.scryfallId)
      fetchCard
        .then((card: ScryfallCard) => {
          setCardDataMap((prev) => new Map(prev).set(dc.scryfallId, card))
        })
        .catch(() => {})
    }
  }, [deck?.cards.length, scryfallLang])

  // Search query
  const searchQuery = useMemo(
    () => (isSearching ? buildScryfallQuery(search, selectedColors, cardType, cmc, format, budget, selectedRarities, keyword) : ''),
    [search, selectedColors, cardType, cmc, format, budget, selectedRarities, keyword, isSearching],
  )
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    ...cardSearchOptions(searchQuery),
    enabled: isSearching,
  })

  // Deck mutations
  const addCard = useCallback(
    (card: ScryfallCard) => {
      if (!deck) return
      setCardDataMap((prev) => new Map(prev).set(card.id, card))
      setDeck((prev) => {
        if (!prev) return prev
        const cards = [...prev.cards]
        const existing = cards.findIndex((c) => c.scryfallId === card.id && c.zone === 'main')
        if (existing >= 0) {
          cards[existing] = { ...cards[existing], quantity: cards[existing].quantity + 1 }
        } else {
          cards.push({ scryfallId: card.id, quantity: 1, zone: 'main' })
        }
        return { ...prev, cards, updatedAt: Date.now() }
      })
    },
    [deck],
  )

  const updateQuantity = useCallback((scryfallId: string, zone: DeckZone, quantity: number) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId && c.zone === zone ? { ...c, quantity } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  const removeCard = useCallback((scryfallId: string, zone: DeckZone) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.filter((c) => !(c.scryfallId === scryfallId && c.zone === zone))
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  const updateDeckName = useCallback((name: string) => {
    setDeckName(name)
    setDeck((prev) => (prev ? { ...prev, name, updatedAt: Date.now() } : prev))
  }, [])

  const updateDeckDescription = useCallback((description: string) => {
    setDeckDescription(description)
    setDeck((prev) => (prev ? { ...prev, description, updatedAt: Date.now() } : prev))
  }, [])

  const toggleLock = useCallback((scryfallId: string) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId ? { ...c, locked: !c.locked } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  // Card list → grid scroll/highlight
  const handleCardSelect = useCallback((scryfallId: string) => {
    setMobileTab('cards')
    setHighlightedCard(scryfallId)
    const el = cardRefs.current.get(scryfallId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setTimeout(() => setHighlightedCard(null), 1500)
  }, [])

  // AI chat
  const handleDeckUpdate = useCallback(
    (newCards: DeckCard[], name?: string, description?: string) => {
      setDeck((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          cards: newCards,
          name: name || prev.name,
          description: description || prev.description,
          updatedAt: Date.now(),
        }
      })
      if (name) setDeckName(name)
      if (description) setDeckDescription(description)
    },
    [],
  )

  const handleCardDataUpdate = useCallback((card: ScryfallCard) => {
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
  }, [])

  const handleDownloadPdf = useCallback(async () => {
    if (!deck) return
    setPdfGenerating(true)
    try {
      const { pdf } = await import('@react-pdf/renderer')
      const { DeckPdf } = await import('../../lib/pdf')
      const blob = await pdf(
        DeckPdf({ cards: deck.cards, cardData: cardDataMap }),
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${deck.name || 'deck'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF generation failed:', err)
    } finally {
      setPdfGenerating(false)
    }
  }, [deck, cardDataMap])

  const lockedCardIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of deck?.cards ?? []) {
      if (c.locked) ids.add(c.scryfallId)
    }
    return ids
  }, [deck?.cards])

  const {
    messages,
    isLoading: chatLoading,
    pending,
    newCardIds,
    sendMessage,
    applyChanges,
    discardChanges,
  } = useDeckChat({
    cards: deck?.cards ?? [],
    cardDataMap,
    deckDescription,
    onDeckUpdate: handleDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    lockedCardIds,
  })

  // Analysis
  const analysis = useMemo(() => {
    if (!deck || deck.cards.length === 0) return null
    return analyzeDeck(deck.cards, cardDataMap, 'casual')
  }, [deck?.cards, cardDataMap])

  // Build card arrays for display
  const deckCards = useMemo(() => {
    if (!deck) return []
    return deck.cards
      .filter((c) => c.zone === 'main')
      .flatMap((c) => {
        const data = cardDataMap.get(c.scryfallId)
        if (!data) return []
        return [{ card: data, quantity: c.quantity }]
      })
  }, [deck?.cards, cardDataMap])

  const deckScryfallCards = useMemo(
    () => deckCards.map((d) => d.card),
    [deckCards],
  )

  const searchScryfallCards: ScryfallCard[] = searchResults?.data ?? []

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

  if (!deck) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20 text-surface-500">{t('deck.deckNotFound')}</div>
      </Layout>
    )
  }

  const mainCount = getTotalCards(deck.cards, 'main')

  // --- Shared content blocks ---

  const searchBar = (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder={t('deckPage.searchPlaceholder')} />
      {isSearching && (
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
      )}
    </div>
  )

  const cardDisplayContent = (
    <>
      {isSearching ? (
        searchLoading ? (
          <CardGridSkeleton count={8} />
        ) : searchScryfallCards.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {searchScryfallCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => addCard(card)}
                className="group relative"
              >
                <CardImage card={card} size="normal" />
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded bg-accent px-2 py-1 text-xs font-bold text-white">{t('deckPage.addOverlay')}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-surface-500">{t('deck.noResults')}</p>
        )
      ) : deckCards.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {deckCards.map(({ card, quantity }, i) => {
            const dc = deck.cards.find((c) => c.scryfallId === card.id)
            return (
              <CardStack
                key={card.id}
                card={card}
                quantity={quantity}
                locked={dc?.locked}
                isNew={newCardIds.has(card.id)}
                highlighted={highlightedCard === card.id}
                onClick={() => setLightboxIndex(i)}
                innerRef={(el) => {
                  if (el) cardRefs.current.set(card.id, el)
                  else cardRefs.current.delete(card.id)
                }}
              />
            )
          })}
        </div>
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-surface-500">
          <p className="font-display text-lg">{t('deck.emptyDeck')}</p>
          <p className="text-sm">{t('deck.emptyDeckSub')}</p>
        </div>
      )}
    </>
  )

  return (
    <Layout>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={deckName}
              onChange={(e) => updateDeckName(e.target.value)}
              className="w-full bg-transparent font-display text-lg font-bold text-surface-100 focus:outline-none sm:text-xl"
              placeholder={t('deck.namePlaceholder')}
            />
            <input
              type="text"
              value={deckDescription}
              onChange={(e) => updateDeckDescription(e.target.value)}
              className="w-full bg-transparent text-xs text-surface-400 focus:outline-none"
              placeholder={t('deck.descriptionPlaceholder')}
            />
          </div>
          <span className="text-xs text-surface-400 sm:text-sm">{t('deck.cards', { count: mainCount })}</span>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfGenerating || mainCount === 0}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:px-3 sm:text-sm"
          >
            {pdfGenerating ? t('deck.pdfGenerating') : t('deck.pdf')}
          </button>
        </div>

        {/* ========== MOBILE LAYOUT (< lg) ========== */}
        <div className="lg:hidden">
          {/* Tab bar */}
          <div className="mb-3 flex rounded-lg border border-surface-600 p-0.5">
            {([
              { id: 'cards' as MobileTab, label: t('nav.cards') },
              { id: 'chat' as MobileTab, label: 'KI Chat' },
              { id: 'list' as MobileTab, label: 'Liste' },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMobileTab(tab.id)}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  mobileTab === tab.id
                    ? 'bg-accent text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mobileTab === 'cards' && (
            <div>
              {searchBar}
              <div className="mt-2 rounded-xl border border-surface-700 bg-surface-800/50 p-3">
                {cardDisplayContent}
              </div>
            </div>
          )}

          {mobileTab === 'chat' && (
            <div style={{ height: 'calc(100dvh - 220px)' }}>
              <AiChat
                messages={messages}
                pending={pending}
                onSend={sendMessage}
                onApply={applyChanges}
                onDiscard={discardChanges}
                isLoading={chatLoading}
              />
            </div>
          )}

          {mobileTab === 'list' && (
            <div>
              <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-2">
                <DeckCardList
                  cards={deck.cards}
                  cardData={cardDataMap}
                  zone="main"
                  onUpdateQuantity={updateQuantity}
                  onRemoveCard={removeCard}
                  onCardSelect={handleCardSelect}
                  onToggleLock={toggleLock}
                />
              </div>
              <div className="mt-3">
                <BalanceAdvisor analysis={analysis} />
              </div>
            </div>
          )}
        </div>

        {/* ========== DESKTOP LAYOUT (>= lg) ========== */}
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3" style={{ height: 'calc(100dvh - 170px)' }}>
          {/* Left: AI Chat */}
          <div className="min-h-0 lg:col-span-3">
            <AiChat
              messages={messages}
              pending={pending}
              onSend={sendMessage}
              onApply={applyChanges}
              onDiscard={discardChanges}
              isLoading={chatLoading}
            />
          </div>

          {/* Center: Card grid (deck or search) */}
          <div className="flex min-h-0 flex-col gap-2 lg:col-span-6">
            {searchBar}
            <div ref={cardGridRef} className="flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-3">
              {cardDisplayContent}
            </div>
          </div>

          {/* Right: Card list + Balance */}
          <div className="flex min-h-0 flex-col gap-2 lg:col-span-3">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-2">
              <DeckCardList
                cards={deck.cards}
                cardData={cardDataMap}
                zone="main"
                onUpdateQuantity={updateQuantity}
                onRemoveCard={removeCard}
                onCardSelect={handleCardSelect}
                onToggleLock={toggleLock}
              />
            </div>
            <BalanceAdvisor analysis={analysis} />
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && deckScryfallCards.length > 0 && (
        <CardLightbox
          cards={deckScryfallCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </Layout>
  )
}
