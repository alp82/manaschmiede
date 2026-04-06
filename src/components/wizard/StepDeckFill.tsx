import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  const [chatSheetOpen, setChatSheetOpen] = useState(false)

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
        fetch('https://api.scryfall.com/cards/' + dc.scryfallId, {
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

  // Classify deck cards into lanes
  type DeckDisplayCard = (typeof deckDisplay)[number]
  const lanes = useMemo(() => {
    const coreIds = new Set(state.lockedCardIds)
    const core: DeckDisplayCard[] = []
    const creatures: DeckDisplayCard[] = []
    const spells: DeckDisplayCard[] = []
    const support: DeckDisplayCard[] = []
    const lands: DeckDisplayCard[] = []

    for (const d of deckDisplay) {
      if (coreIds.has(d.scryfallId)) {
        core.push(d)
        continue
      }
      const type = d.card.type_line.toLowerCase()
      if (type.includes('land')) lands.push(d)
      else if (type.includes('creature')) creatures.push(d)
      else if (type.includes('instant') || type.includes('sorcery')) spells.push(d)
      else support.push(d)
    }
    return { core, creatures, spells, support, lands }
  }, [deckDisplay, state.lockedCardIds])

  const laneCount = (items: DeckDisplayCard[]) => items.reduce((s, d) => s + d.quantity, 0)

  // Ambient mana tint gradient based on deck colors
  const TINT_MAP: Record<string, string> = {
    W: 'oklch(0.92 0.04 90 / 0.05)',
    U: 'oklch(0.55 0.18 250 / 0.05)',
    B: 'oklch(0.30 0.02 285 / 0.08)',
    R: 'oklch(0.58 0.22 25 / 0.05)',
    G: 'oklch(0.60 0.18 145 / 0.05)',
  }
  const ambientGradient = useMemo(() => {
    const colors = getActiveColors(state.colors)
    if (colors.length === 0) return undefined
    const primary = TINT_MAP[colors[0]] ?? 'transparent'
    const secondary = colors.length > 1 ? (TINT_MAP[colors[1]] ?? 'transparent') : primary
    return `radial-gradient(ellipse at 50% 0%, ${primary} 0%, ${secondary} 40%, transparent 80%)`
  }, [state.colors])

  function openLightbox(card: ScryfallCard) {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      setLightboxCards(allScryfallCards)
      setLightboxIndex(idx)
    }
  }

  // Card context menu handlers
  function handleToggleLock(scryfallId: string) {
    dispatch({ type: 'TOGGLE_LOCK', scryfallId })
  }

  function handleChangeQuantity(scryfallId: string, qty: number) {
    const updated = state.deckCards.map((c) =>
      c.scryfallId === scryfallId ? { ...c, quantity: qty } : c,
    )
    dispatch({ type: 'SET_DECK', cards: updated })
  }

  function handleRemoveCard(scryfallId: string) {
    const updated = state.deckCards.filter((c) => c.scryfallId !== scryfallId)
    dispatch({ type: 'SET_DECK', cards: updated })
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

  // Quick action chips for AI chat
  const quickActions = useMemo(() => {
    const actions: { label: string; message: string }[] = []
    if (mainCount > 0 && mainCount < 60) {
      actions.push({ label: t('chat.quickFill'), message: 'Fill the remaining slots to reach 60 cards while maintaining good balance and synergy.' })
    }
    if (analysis?.warnings.some((w) => w.message.toLowerCase().includes('land'))) {
      actions.push({ label: t('chat.quickFixMana'), message: 'Fix the mana base — adjust the land count and color distribution to match the spells.' })
    }
    if (analysis && analysis.cardTypeBreakdown.find((ct) => ct.type === 'Creature')?.count === 0 && mainCount > 10) {
      actions.push({ label: t('chat.quickAddCreatures'), message: 'Add creatures to the deck — it currently has none.' })
    }
    if (analysis?.suggestions.some((s) => s.toLowerCase().includes('removal'))) {
      actions.push({ label: t('chat.quickAddRemoval'), message: 'Add some removal spells to deal with opponent threats.' })
    }
    return actions.slice(0, 3)
  }, [mainCount, analysis, t])

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

  // Track which cards have already animated in (prevent re-animation on updates)
  const animatedCards = useRef(new Set<string>())
  const workspaceMounted = useRef(false)
  useEffect(() => { workspaceMounted.current = true }, [])

  // Collapsible lane component
  function DeckLane({ label, items, gridCols, heroSize, target }: {
    label: string
    items: DeckDisplayCard[]
    gridCols?: string
    heroSize?: boolean
    target?: number
  }) {
    const [collapsed, setCollapsed] = useState(false)
    const count = laneCount(items)
    if (items.length === 0) return null
    const fillPct = target ? Math.min(100, (count / target) * 100) : undefined
    return (
      <div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="mb-1 flex w-full items-center justify-between"
        >
          <span className="font-display text-sm font-bold text-surface-200">{label}</span>
          <span className="flex items-center gap-2">
            <span className={`rounded-full bg-surface-700 px-2 py-0.5 text-xs font-medium ${
              target && count > target ? 'text-mana-multi' : 'text-surface-400'
            }`}>
              {target ? `${count}/${target}` : count}
            </span>
            <span className={`text-xs text-surface-500 transition-transform duration-[--duration-quick] ${collapsed ? '' : 'rotate-90'}`}>▸</span>
          </span>
        </button>
        {fillPct !== undefined && (
          <div className="mb-2 h-0.5 rounded-full bg-accent/20">
            <div
              className="h-full rounded-full bg-accent transition-all duration-[--duration-smooth]"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        )}
        {!collapsed && (
          <div className={gridCols ?? 'grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4'}>
            {items.map(({ card, quantity, locked, scryfallId }, i) => {
              const shouldAnimate = !animatedCards.current.has(scryfallId)
              if (shouldAnimate) animatedCards.current.add(scryfallId)
              return (
                <div
                  key={scryfallId}
                  style={shouldAnimate ? { animation: `card-enter 300ms cubic-bezier(0.22, 1.2, 0.36, 1) both`, animationDelay: `${i * 60}ms` } : undefined}
                >
                  {heroSize ? (
                    <div className="ring-2 ring-mana-multi/50 rounded-lg">
                      <CardStack card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => openLightbox(card)} onToggleLock={() => handleToggleLock(scryfallId)} onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)} onRemove={() => handleRemoveCard(scryfallId)} />
                    </div>
                  ) : (
                    <CardStack card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => openLightbox(card)} onToggleLock={() => handleToggleLock(scryfallId)} onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)} onRemove={() => handleRemoveCard(scryfallId)} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

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

      {/* Deck cards — categorized lanes */}
      {deckDisplay.length > 0 ? (
        <div className="space-y-6">
          {hasActiveFilter ? (
            // When filters active, show flat grid (filtering breaks lane classification)
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {deckDisplay.map(({ card, quantity, locked, scryfallId }) => (
                <CardStack key={scryfallId} card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => openLightbox(card)} onToggleLock={() => handleToggleLock(scryfallId)} onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)} onRemove={() => handleRemoveCard(scryfallId)} />
              ))}
            </div>
          ) : (
            <>
              <DeckLane label={t('fill.laneCore')} items={lanes.core} heroSize />
              <DeckLane label={t('fill.laneCreatures')} items={lanes.creatures} target={16} />
              <DeckLane label={t('fill.laneSpells')} items={lanes.spells} target={10} />
              <DeckLane label={t('fill.laneSupport')} items={lanes.support} target={6} />
              <DeckLane label={t('fill.laneLands')} items={lanes.lands} target={24} gridCols="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6" />
            </>
          )}
        </div>
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
    <div className="relative">
      {/* Ambient mana tint overlay */}
      {ambientGradient && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-[600ms]"
          style={{ background: ambientGradient }}
        />
      )}
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
        <span
          className={`text-sm font-medium transition-colors duration-[--duration-smooth] ${mainCount === 60 ? 'text-mana-green' : 'text-mana-red'}`}
          style={mainCount === 60 ? { animation: 'celebrate 500ms cubic-bezier(0.34, 1.56, 0.64, 1)' } : undefined}
        >
          {t('fill.cardsCount', { count: mainCount })}
        </span>
      </div>

      {/* ========== MOBILE LAYOUT (< lg) ========== */}
      <div className="lg:hidden pb-28">
        {/* Mobile tab bar — Cards / Stats only (chat is bottom sheet) */}
        <div className="mb-3 flex rounded-lg border border-surface-600 p-0.5">
          {([
            { id: 'cards' as MobileTab, label: t('nav.cards') },
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

      {/* ========== MOBILE CHAT BOTTOM SHEET (< lg) — portaled to escape transforms ========== */}
      {createPortal(<div className="fixed bottom-[60px] left-0 right-0 z-10 lg:hidden">
        {/* Collapsed: just the input bar */}
        {!chatSheetOpen && (
          <div className="border-t border-surface-700 bg-surface-900/95 px-3 py-2 backdrop-blur-sm">
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                onFocus={() => setChatSheetOpen(true)}
                placeholder={chatLoading ? '...' : t('chat.inputPlaceholder')}
                className="flex-1 rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setChatSheetOpen(true)}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                {t('chat.send')}
              </button>
            </div>
          </div>
        )}

        {/* Expanded: half-sheet with full chat */}
        {chatSheetOpen && (
          <>
            <div className="fixed inset-0 z-[9] bg-black/40" onClick={() => setChatSheetOpen(false)} />
            <div
              className="relative z-[10] flex flex-col border-t border-surface-700 bg-surface-900"
              style={{ height: '50dvh', animation: 'card-enter 200ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
            >
              <div className="flex items-center justify-between border-b border-surface-700 px-3 py-2">
                <span className="text-xs font-medium text-surface-300">AI Chat</span>
                <button
                  type="button"
                  onClick={() => setChatSheetOpen(false)}
                  className="text-xs text-surface-500 hover:text-surface-300"
                >
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <AiChat
                  messages={messages}
                  pending={pending}
                  onSend={sendMessage}
                  onApply={applyChanges}
                  onDiscard={discardChanges}
                  isLoading={chatLoading || isGenerating}
                  quickActions={quickActions}
                />
              </div>
            </div>
          </>
        )}
      </div>, document.body)}

      {/* ========== DESKTOP LAYOUT (>= lg) ========== */}
      <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3" style={{ height: 'calc(100dvh - 240px)' }}>
        {/* Left: AI Chat */}
        <div
          className="min-h-0 flex flex-col lg:col-span-3"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '100ms' } : undefined}
        >
          {candidatesBar && <div className="mb-2">{candidatesBar}</div>}
          <div className="min-h-0 flex-1">
            <AiChat
              messages={messages}
              pending={pending}
              onSend={sendMessage}
              onApply={applyChanges}
              onDiscard={discardChanges}
              isLoading={chatLoading || isGenerating}
              quickActions={quickActions}
            />
          </div>
        </div>

        {/* Center: Card grid with search */}
        <div
          className="flex min-h-0 flex-col gap-2 lg:col-span-6"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '200ms' } : undefined}
        >
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
        <div
          className="min-h-0 overflow-y-auto lg:col-span-3"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '300ms' } : undefined}
        >
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

      {/* Fixed bottom nav — portaled to escape transforms */}
      {createPortal(
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
        </div>,
        document.body,
      )}

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
