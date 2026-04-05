import { useState, useEffect, useCallback, useMemo } from 'react'
import { AiChat } from '../AiChat'
import { BalanceAdvisor } from '../BalanceAdvisor'
import { CardLightbox } from '../CardLightbox'
import { CardStack } from '../CardStack'
import { CardImage } from '../CardImage'
import { SearchInput } from '../SearchInput'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat, type ChatMessage as DeckChatMessage } from '../../lib/useDeckChat'
import { searchCards } from '../../lib/scryfall/client'
import { getTraitById, buildSearchFilterSuffix } from '../../lib/trait-mappings'
import { useT } from '../../lib/i18n'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard } from '../../lib/deck-utils'
import type { WizardState, WizardAction } from '../../lib/wizard-state'
import { getActiveColors } from '../../lib/wizard-state'

interface StepDeckFillProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onBack: () => void
  onFinish: () => void
}

type MobileTab = 'cards' | 'chat' | 'stats'

export function StepDeckFill({ state, dispatch, onBack, onFinish }: StepDeckFillProps) {
  const t = useT()
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [lightboxCards, setLightboxCards] = useState<ScryfallCard[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')

  // Search & filter
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [cmcFilter, setCmcFilter] = useState<number | null>(null)

  // Candidates: cards the user wants to propose adding
  const [candidates, setCandidates] = useState<ScryfallCard[]>([])

  const lockedCardIds = useMemo(
    () => new Set(state.lockedCardIds),
    [state.lockedCardIds],
  )

  const handleDeckUpdate = useCallback((cards: DeckCard[], name?: string, description?: string) => {
    const updatedCards = cards.map((c) => ({
      ...c,
      locked: lockedCardIds.has(c.scryfallId) ? true : c.locked,
    }))
    dispatch({ type: 'SET_DECK', cards: updatedCards, name, description })
  }, [dispatch, lockedCardIds])

  const handleCardDataUpdate = useCallback((card: ScryfallCard) => {
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
  }, [])

  const handleChatMessagesChange = useCallback((messages: DeckChatMessage[]) => {
    dispatch({ type: 'SET_CHAT_MESSAGES', messages })
  }, [dispatch])

  const {
    messages,
    isLoading: chatLoading,
    pending,
    newCardIds,
    sendMessage,
    applyChanges,
    discardChanges,
  } = useDeckChat({
    cards: state.deckCards,
    cardDataMap,
    deckDescription: state.deckDescription,
    onDeckUpdate: handleDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    lockedCardIds,
    initialMessages: state.chatMessages,
    onMessagesChange: handleChatMessagesChange,
  })

  // Seed core cards into deck + generate rest on mount
  useEffect(() => {
    if (generated || isGenerating || state.deckCards.length > 0) return

    const generateDeck = async () => {
      setIsGenerating(true)
      try {
        const selectedCombo = state.selectedComboIndex != null && state.selectedComboIndex >= 0
          ? state.coreCombos[state.selectedComboIndex]
          : null

        if (selectedCombo) {
          const coreCards: DeckCard[] = []
          for (const card of selectedCombo.cards) {
            if (card.scryfallId) {
              coreCards.push({ scryfallId: card.scryfallId, quantity: 4, zone: 'main', locked: true })
              dispatch({ type: 'TOGGLE_LOCK', scryfallId: card.scryfallId })
              if (card.scryfallCard) handleCardDataUpdate(card.scryfallCard)
            }
          }
          if (coreCards.length > 0) dispatch({ type: 'SET_DECK', cards: coreCards })
        }

        const activeColors = getActiveColors(state.colors)
        const colorNames = activeColors.map((c) =>
          c === 'W' ? 'White' : c === 'U' ? 'Blue' : c === 'B' ? 'Black' : c === 'R' ? 'Red' : 'Green',
        )
        const archetypeLabels = state.selectedArchetypes.map((id) => getTraitById(id)?.label || id)
        const traitLabels = state.selectedTraits.map((id) => getTraitById(id)?.label || id)

        let prompt = 'Build a 60-card deck with these preferences:\n'
        if (colorNames.length > 0) prompt += `Colors: ${colorNames.join(', ')}\n`
        if (archetypeLabels.length > 0) prompt += `Archetypes: ${archetypeLabels.join(', ')}\n`
        if (traitLabels.length > 0) prompt += `Traits: ${traitLabels.join(', ')}\n`
        if (state.customStrategy) prompt += `Strategy: ${state.customStrategy}\n`

        if (selectedCombo) {
          const coreCardNames = selectedCombo.cards.map((c) => c.name).join(', ')
          prompt += `\nBuild the deck around these core cards (already included as 4x each): ${coreCardNames}\nKeep all 4 copies of each core card. Fill the remaining slots with support cards, removal, card draw, and lands.`
        }

        if (state.budgetLimit != null) {
          prompt += `\nBudget constraint: max $${state.budgetLimit} per card.`
        }

        sendMessage(prompt)
      } catch (err) {
        console.error('Deck generation failed:', err)
      } finally {
        setIsGenerating(false)
        setGenerated(true)
      }
    }

    generateDeck()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch card data for deck cards
  useEffect(() => {
    for (const dc of state.deckCards) {
      if (!cardDataMap.has(dc.scryfallId)) {
        fetch('https://api.scryfall.com/cards/' + dc.scryfallId + '?lang=de', {
          headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
        })
          .then((r) => r.json())
          .then((card: ScryfallCard) => setCardDataMap((prev) => new Map(prev).set(card.id, card)))
          .catch(() => {})
      }
    }
  }, [state.deckCards.length])

  // Build filter suffix from step 1 & 2 selections
  const searchSuffix = useMemo(() => {
    const activeColors = getActiveColors(state.colors)
    return buildSearchFilterSuffix(activeColors, {
      format: state.format,
      budgetLimit: state.budgetLimit,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetLimit, state.rarityFilter])

  // Card search
  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await searchCards(`${search}${searchSuffix}`)
        setSearchResults(result.data?.slice(0, 12) ?? [])
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [search, searchSuffix])

  const analysis = useMemo(() => {
    if (state.deckCards.length === 0) return null
    return analyzeDeck(state.deckCards, cardDataMap, state.format)
  }, [state.deckCards, cardDataMap, state.format])

  // Build filtered deck display
  const deckDisplay = useMemo(() => {
    return state.deckCards
      .filter((c) => c.zone === 'main')
      .map((dc) => ({ ...dc, card: cardDataMap.get(dc.scryfallId) }))
      .filter((d): d is DeckCard & { card: ScryfallCard } => {
        if (!d.card) return false
        if (typeFilter) {
          const mainType = d.card.type_line.toLowerCase()
          if (!mainType.includes(typeFilter.toLowerCase())) return false
        }
        if (colorFilter) {
          if (!d.card.color_identity.includes(colorFilter)) return false
        }
        if (cmcFilter !== null) {
          const cardCmc = Math.min(Math.floor(d.card.cmc), 7)
          if (cardCmc !== cmcFilter) return false
        }
        return true
      })
  }, [state.deckCards, cardDataMap, typeFilter, colorFilter, cmcFilter])

  // Search results that are NOT already in the deck
  const newSearchResults = useMemo(() => {
    const deckIds = new Set(state.deckCards.map((c) => c.scryfallId))
    return searchResults.filter((c) => !deckIds.has(c.id))
  }, [searchResults, state.deckCards])

  const allScryfallCards = useMemo(() => deckDisplay.map((d) => d.card), [deckDisplay])

  const mainCount = state.deckCards
    .filter((c) => c.zone === 'main')
    .reduce((s, c) => s + c.quantity, 0)

  function openLightbox(card: ScryfallCard) {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      setLightboxCards(allScryfallCards)
      setLightboxIndex(idx)
    }
  }

  function addCandidate(card: ScryfallCard) {
    if (!candidates.find((c) => c.id === card.id)) {
      setCandidates((prev) => [...prev, card])
    }
  }

  function removeCandidate(cardId: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== cardId))
  }

  function sendCandidates() {
    if (candidates.length === 0) return
    const names = candidates.map((c) => c.name).join(', ')
    sendMessage(`Add these cards to the deck: ${names}. Adjust the rest of the deck to accommodate them while keeping it at 60 cards.`)
    setCandidates([])
  }

  const hasActiveFilter = typeFilter !== null || colorFilter !== null || cmcFilter !== null

  // --- Shared sub-components ---

  const candidatesBar = candidates.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-2">
      <span className="text-[10px] text-accent font-medium">{t('fill.candidates')}</span>
      {candidates.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
          {c.name}
          <button type="button" onClick={() => removeCandidate(c.id)} className="hover:text-white">x</button>
        </span>
      ))}
      <button
        type="button"
        onClick={sendCandidates}
        className="ml-auto rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-hover"
      >
        {t('fill.addToDeck')}
      </button>
    </div>
  )

  const cardGridContent = (
    <>
      {/* Search results: new cards to add */}
      {newSearchResults.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-surface-400">{t('fill.addToDeck')}</h4>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {newSearchResults.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => addCandidate(card)}
                className={`group relative rounded-lg transition-all ${
                  candidates.find((c) => c.id === card.id)
                    ? 'ring-2 ring-accent'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <CardImage card={card} size="normal" />
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded bg-accent px-2 py-1 text-xs font-bold text-white">{t('deckPage.addOverlay')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && <p className="py-4 text-center text-xs text-surface-500">{t('search.searching')}</p>}

      {/* Deck cards */}
      {deckDisplay.length > 0 ? (
        <>
          {newSearchResults.length > 0 && (
            <h4 className="mb-2 text-xs font-medium text-surface-400">{t('fill.inYourDeck')}</h4>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {deckDisplay.map(({ card, quantity, locked, scryfallId }) => (
              <CardStack
                key={scryfallId}
                card={card}
                quantity={quantity}
                locked={locked}
                isNew={newCardIds.has(scryfallId)}
                onClick={() => openLightbox(card)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-surface-500">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-sm">{t('fill.building')}</p>
        </div>
      )}
    </>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display text-xl font-bold text-surface-100">
            {state.deckName || t('fill.yourDeck')}
          </h2>
          {state.deckDescription && (
            <p className="text-xs text-surface-400">{state.deckDescription}</p>
          )}
        </div>
        <span className={`text-sm font-medium ${mainCount === 60 ? 'text-mana-green' : 'text-mana-red'}`}>
          {t('fill.cardsCount', { count: mainCount })}
        </span>
      </div>

      {/* ========== MOBILE LAYOUT (< lg) ========== */}
      <div className="lg:hidden">
        {/* Mobile tab bar */}
        <div className="mb-3 flex rounded-lg border border-surface-600 p-0.5">
          {([
            { id: 'cards' as MobileTab, label: t('nav.cards') },
            { id: 'chat' as MobileTab, label: 'KI Chat' },
            { id: 'stats' as MobileTab, label: t('balance.cardTypes').split(' ')[0] || 'Stats' },
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

        {/* Candidates bar (always visible when present) */}
        {candidatesBar && <div className="mb-3">{candidatesBar}</div>}

        {/* Tab content */}
        {mobileTab === 'cards' && (
          <div>
            <div className="mb-2 flex gap-2">
              <div className="flex-1">
                <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
              </div>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => { setTypeFilter(null); setColorFilter(null); setCmcFilter(null) }}
                  className="rounded-lg border border-surface-600 px-3 text-xs text-surface-400 hover:text-surface-200"
                >
                  {t('fill.clearFilters')}
                </button>
              )}
            </div>
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-3">
              {cardGridContent}
            </div>
          </div>
        )}

        {mobileTab === 'chat' && (
          <div style={{ height: 'calc(100dvh - 280px)' }}>
            <AiChat
              messages={messages}
              pending={pending}
              onSend={sendMessage}
              onApply={applyChanges}
              onDiscard={discardChanges}
              isLoading={chatLoading || isGenerating}
            />
          </div>
        )}

        {mobileTab === 'stats' && (
          <div>
            <BalanceAdvisor
              analysis={analysis}
              activeTypeFilter={typeFilter}
              activeColorFilter={colorFilter}
              activeCmcFilter={cmcFilter}
              onFilterByType={(type) => { setTypeFilter(type); if (type !== null) setMobileTab('cards') }}
              onFilterByColor={(color) => { setColorFilter(color); if (color !== null) setMobileTab('cards') }}
              onFilterByCmc={(cmc) => { setCmcFilter(cmc); if (cmc !== null) setMobileTab('cards') }}
            />
          </div>
        )}
      </div>

      {/* ========== DESKTOP LAYOUT (>= lg) ========== */}
      <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3" style={{ height: 'calc(100dvh - 240px)' }}>
        {/* Left: AI Chat */}
        <div className="min-h-0 flex flex-col lg:col-span-3">
          {candidatesBar && <div className="mb-2">{candidatesBar}</div>}
          <div className="min-h-0 flex-1">
            <AiChat
              messages={messages}
              pending={pending}
              onSend={sendMessage}
              onApply={applyChanges}
              onDiscard={discardChanges}
              isLoading={chatLoading || isGenerating}
            />
          </div>
        </div>

        {/* Center: Card grid with search */}
        <div className="flex min-h-0 flex-col gap-2 lg:col-span-6">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
            </div>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => { setTypeFilter(null); setColorFilter(null); setCmcFilter(null) }}
                className="rounded-lg border border-surface-600 px-3 text-xs text-surface-400 hover:text-surface-200"
              >
                {t('fill.clearFilters')}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-3">
            {cardGridContent}
          </div>
        </div>

        {/* Right: Balance advisor */}
        <div className="min-h-0 overflow-y-auto lg:col-span-3">
          <BalanceAdvisor
            analysis={analysis}
            activeTypeFilter={typeFilter}
            activeColorFilter={colorFilter}
            activeCmcFilter={cmcFilter}
            onFilterByType={setTypeFilter}
            onFilterByColor={setColorFilter}
            onFilterByCmc={setCmcFilter}
          />
        </div>
      </div>

      {/* Fixed bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-surface-700 bg-surface-900/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-surface-600 px-6 py-2.5 text-sm text-surface-300 hover:border-surface-500 hover:text-surface-100"
          >
            {t('wizard.back')}
          </button>
          <button
            type="button"
            onClick={onFinish}
            disabled={mainCount === 0}
            className="rounded-lg bg-mana-green px-8 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('fill.finishOpen')}
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && lightboxCards.length > 0 && (
        <CardLightbox
          cards={lightboxCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  )
}
