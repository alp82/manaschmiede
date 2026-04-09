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
import { useSectionFill } from '../../lib/useSectionFill'
import { BASIC_LAND_ID_SET } from '../../lib/basic-lands'
import { deriveSectionPlan, pickSectionForCard } from '../../lib/section-plan'
import { searchCards } from '../../lib/scryfall/client'
import { buildSearchFilterSuffix } from '../../lib/trait-mappings'
import { useT } from '../../lib/i18n'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard } from '../../lib/deck-utils'
import { copyDecklistToClipboard, isBasicLand } from '../../lib/deck-utils'
import { getCardName } from '../../lib/scryfall/types'
import type { DeckSection } from '../../lib/section-plan'
import type { WizardState, WizardAction } from '../../lib/wizard-state'
import { getActiveColors } from '../../lib/wizard-state'
import { useDeckSounds } from '../../lib/sounds'
import { useDeckHistory } from '../../lib/use-deck-history'

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
  const [lightboxCards, setLightboxCards] = useState<ScryfallCard[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')
  const [chatSheetOpen, setChatSheetOpen] = useState(false)

  // Desktop grid - compute height from position to avoid magic numbers
  const desktopGridRef = useRef<HTMLDivElement>(null)
  const [desktopGridHeight, setDesktopGridHeight] = useState('calc(100dvh - 280px)')
  useEffect(() => {
    const el = desktopGridRef.current
    if (!el) return
    const update = () => {
      const top = el.getBoundingClientRect().top
      // Leave 72px for the fixed bottom nav bar + breathing room
      setDesktopGridHeight(`${window.innerHeight - top - 72}px`)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Search & filter
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [cmcFilter, setCmcFilter] = useState<number | null>(null)

  // Candidates: cards the user wants to propose adding
  const [candidates, setCandidates] = useState<ScryfallCard[]>([])
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t) } }, [copied])
  const sounds = useDeckSounds()
  const history = useDeckHistory(state.deckCards, dispatch)

  // Ctrl+Z / Ctrl+Shift+Z for undo/redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [history])

  const selectedCombo = state.selectedComboIndex != null && state.selectedComboIndex >= 0
    ? state.coreCombos[state.selectedComboIndex]
    : null

  const lockedCardIds = useMemo(() => {
    const ids = new Set(state.lockedCardIds)
    if (selectedCombo && state.lockedCardIds.length === 0) {
      for (const card of selectedCombo.cards) {
        if (card.scryfallId) ids.add(card.scryfallId)
      }
    }
    return ids
  }, [state.lockedCardIds, selectedCombo])

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

  const handleSectionAssign = useCallback((sectionId: string, scryfallIds: string[]) => {
    dispatch({ type: 'ASSIGN_SECTION', sectionId, scryfallIds })
  }, [dispatch])

  // ─── Section Plan ────────────────────────────────────────────

  const coreCardCount = useMemo(() => {
    if (!selectedCombo) return 0
    return selectedCombo.cards.filter((c) => c.scryfallId).length * 4
  }, [selectedCombo])

  // Derive section plan on mount (or use persisted one)
  const sections = useMemo(() => {
    if (state.sectionPlan.length > 0) return state.sectionPlan
    return deriveSectionPlan(state.selectedArchetypes, state.selectedTraits, coreCardCount)
  }, [state.sectionPlan, state.selectedArchetypes, state.selectedTraits, coreCardCount])

  // Persist section plan
  useEffect(() => {
    if (state.sectionPlan.length === 0 && sections.length > 0) {
      dispatch({ type: 'SET_SECTION_PLAN', sections })
    }
  }, [sections, state.sectionPlan.length, dispatch])

  // Seed core cards on mount
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || state.deckCards.length > 0) return
    seeded.current = true

    if (selectedCombo) {
      const coreCards: DeckCard[] = []
      const coreIds: string[] = []
      for (const card of selectedCombo.cards) {
        if (card.scryfallId) {
          coreCards.push({ scryfallId: card.scryfallId, quantity: 4, zone: 'main', locked: true })
          dispatch({ type: 'TOGGLE_LOCK', scryfallId: card.scryfallId })
          if (card.scryfallCard) handleCardDataUpdate(card.scryfallCard)
          coreIds.push(card.scryfallId)
        }
      }
      if (coreCards.length > 0) {
        dispatch({ type: 'SET_DECK', cards: coreCards })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Section Fill ────────────────────────────────────────────

  const handleSectionDeckUpdate = useCallback((cards: DeckCard[]) => {
    dispatch({ type: 'SET_DECK', cards })
  }, [dispatch])

  const {
    getSectionState,
    fillSection: triggerFillSection,
    applySection,
    discardSection,
    fillLands,
    fillAllRemaining,
    fillProgress,
    cancelFillAll,
  } = useSectionFill({
    sections,
    deckCards: state.deckCards,
    cardDataMap,
    wizardState: state,
    onDeckUpdate: handleSectionDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    onSectionAssign: handleSectionAssign,
  })

  const handleFillSection = useCallback((sectionId: string) => {
    history.snapshot()
    triggerFillSection(sectionId)
    sounds.aiShuffle()
  }, [triggerFillSection, sounds, history])

  const handleApplySection = useCallback((sectionId: string) => {
    history.snapshot()
    applySection(sectionId)
    sounds.aiShuffle()
  }, [applySection, sounds, history])

  const handleFillAllRemaining = useCallback(async () => {
    history.snapshot()
    await fillAllRemaining()
    // Auto-fill lands: use the section plan's land target
    const landsSection = sections.find((s) => s.id === 'lands')
    if (landsSection && landsSection.targetCount > 0) {
      await fillLands(landsSection.targetCount)
    }
    sounds.deckComplete()
  }, [fillAllRemaining, fillLands, sections, sounds, history])

  const handleFillLands = useCallback(async () => {
    history.snapshot()
    // Remove existing basic lands so we can recalculate from scratch
    const withoutBasicLands = state.deckCards.filter((c) => !BASIC_LAND_ID_SET.has(c.scryfallId))
    const nonLandTotal = withoutBasicLands
      .filter((c) => c.zone === 'main')
      .reduce((s, c) => s + c.quantity, 0)
    const landTarget = Math.max(60 - nonLandTotal, 0)
    if (landTarget > 0) {
      dispatch({ type: 'SET_DECK', cards: withoutBasicLands })
      await fillLands(landTarget)
      sounds.aiShuffle()
    }
  }, [state.deckCards, fillLands, sounds, history, dispatch])

  // ─── Chat (for free-text refinement) ─────────────────────────

  const sectionLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const s of sections) labels[s.id] = s.label
    return labels
  }, [sections])

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
    sectionAssignments: state.sectionAssignments,
    sectionLabels,
    initialMessages: state.chatMessages,
    onMessagesChange: handleChatMessagesChange,
  })

  const applyChangesWithSound = useCallback(() => {
    history.snapshot()

    if (pending?.changes) {
      const removedIds = pending.changes.filter((c) => c.type === 'removed').map((c) => c.scryfallId)
      const addedChanges = pending.changes.filter((c) => c.type === 'added')
      const addedIds = addedChanges.map((c) => c.scryfallId)

      // Work on a mutable copy of the assignments so we can coordinate pairs,
      // target-section top-ups, and auto-picks in one pass before dispatching.
      const next: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(state.sectionAssignments)) {
        next[k] = [...v]
      }
      const placed = new Set<string>()

      // Swap pairs - new card inherits the removed card's section.
      if (removedIds.length > 0 && addedIds.length > 0) {
        const sectionForRemoved = new Map<string, string>()
        for (const rid of removedIds) {
          for (const [sectionId, ids] of Object.entries(next)) {
            if (ids.includes(rid)) sectionForRemoved.set(rid, sectionId)
          }
        }
        const pairCount = Math.min(removedIds.length, addedIds.length)
        for (let i = 0; i < pairCount; i++) {
          const sectionId = sectionForRemoved.get(removedIds[i])
          if (sectionId) {
            next[sectionId] = (next[sectionId] ?? [])
              .filter((id) => id !== removedIds[i])
              .concat(addedIds[i])
            placed.add(addedIds[i])
          }
        }
      }

      // Clean up any removed IDs still lingering in assignments (e.g. when
      // removals outnumber additions).
      for (const rid of removedIds) {
        for (const sectionId of Object.keys(next)) {
          next[sectionId] = next[sectionId].filter((id) => id !== rid)
        }
      }

      // Remaining additions: explicit target section first, then auto-pick
      // by role. Only falls through to "unassigned" when no section in the
      // plan matches the card type at all.
      for (const change of addedChanges) {
        const aid = change.scryfallId
        if (placed.has(aid)) continue

        if (pending.targetSection) {
          next[pending.targetSection] = [...(next[pending.targetSection] ?? []), aid]
          placed.add(aid)
          continue
        }

        const card = change.scryfallCard ?? cardDataMap.get(aid)
        if (!card) continue

        const pickedId = pickSectionForCard(card, sections)
        if (pickedId) {
          next[pickedId] = [...(next[pickedId] ?? []), aid]
          placed.add(aid)
        }
      }

      // Dispatch only sections whose assignments actually changed.
      for (const [sectionId, ids] of Object.entries(next)) {
        const before = state.sectionAssignments[sectionId] ?? []
        const changed = before.length !== ids.length || before.some((id, i) => ids[i] !== id)
        if (changed) {
          dispatch({ type: 'ASSIGN_SECTION', sectionId, scryfallIds: ids })
        }
      }
    }

    applyChanges()
    sounds.aiShuffle()
  }, [applyChanges, sounds, history, pending, state.sectionAssignments, dispatch, cardDataMap, sections])

  // ─── Card Data Fetching ──────────────────────────────────────

  useEffect(() => {
    const missing = state.deckCards.filter((dc) => !cardDataMap.has(dc.scryfallId))
    if (missing.length === 0) return

    let cancelled = false
    const fetchAll = async () => {
      const fetched = new Map<string, ScryfallCard>()
      for (const dc of missing) {
        try {
          const r = await fetch('https://api.scryfall.com/cards/' + dc.scryfallId, {
            headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
          })
          const card: ScryfallCard = await r.json()
          fetched.set(card.id, card)
        } catch { /* skip */ }
      }
      if (!cancelled && fetched.size > 0) {
        setCardDataMap((prev) => {
          const next = new Map(prev)
          for (const [id, card] of fetched) next.set(id, card)
          return next
        })
      }
    }
    fetchAll()
    return () => { cancelled = true }
  }, [state.deckCards.length])

  // ─── Search ──────────────────────────────────────────────────

  const searchSuffix = useMemo(() => {
    const activeColors = getActiveColors(state.colors)
    return buildSearchFilterSuffix(activeColors, {
      format: state.format,
      budgetLimit: state.budgetLimit,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetLimit, state.rarityFilter])

  useEffect(() => {
    if (search.length < 1) { setSearchResults([]); return }
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

  // ─── Computed Values ─────────────────────────────────────────

  const analysis = useMemo(() => {
    if (state.deckCards.length === 0) return null
    return analyzeDeck(state.deckCards, cardDataMap, state.format)
  }, [state.deckCards, cardDataMap, state.format])

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

  const newSearchResults = useMemo(() => {
    const deckIds = new Set(state.deckCards.map((c) => c.scryfallId))
    return searchResults.filter((c) => !deckIds.has(c.id))
  }, [searchResults, state.deckCards])

  const allScryfallCards = useMemo(() => deckDisplay.map((d) => d.card), [deckDisplay])

  const mainCount = state.deckCards
    .filter((c) => c.zone === 'main')
    .reduce((s, c) => s + c.quantity, 0)

  const prevMainCount = useRef(mainCount)
  useEffect(() => {
    if (mainCount === 60 && prevMainCount.current !== 60) {
      sounds.deckComplete()
    }
    prevMainCount.current = mainCount
  }, [mainCount, sounds])

  // Build section card assignments for display
  type DeckDisplayCard = (typeof deckDisplay)[number]
  const sectionCards = useMemo(() => {
    const assignments = state.sectionAssignments
    const coreIds = new Set(state.lockedCardIds)
    const result: Record<string, DeckDisplayCard[]> = {}

    // Core cards
    const core: DeckDisplayCard[] = []
    const assigned = new Set<string>()

    for (const d of deckDisplay) {
      if (coreIds.has(d.scryfallId)) {
        core.push(d)
        assigned.add(d.scryfallId)
      }
    }
    result['core'] = core

    // Section-assigned cards
    for (const section of sections) {
      if (section.id === 'lands') continue
      const sectionIds = new Set(assignments[section.id] ?? [])
      const cards: DeckDisplayCard[] = []
      for (const d of deckDisplay) {
        if (!assigned.has(d.scryfallId) && sectionIds.has(d.scryfallId)) {
          cards.push(d)
          assigned.add(d.scryfallId)
        }
      }
      result[section.id] = cards
    }

    // Lands
    const lands: DeckDisplayCard[] = []
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId) && d.card.type_line.toLowerCase().includes('land')) {
        lands.push(d)
        assigned.add(d.scryfallId)
      }
    }
    // Also include explicitly assigned land cards
    const landAssignIds = new Set(assignments['lands'] ?? [])
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId) && landAssignIds.has(d.scryfallId)) {
        lands.push(d)
        assigned.add(d.scryfallId)
      }
    }
    result['lands'] = lands

    // Unassigned cards (manually added, or from chat)
    const unassigned: DeckDisplayCard[] = []
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId)) {
        unassigned.push(d)
      }
    }
    result['unassigned'] = unassigned

    return result
  }, [deckDisplay, state.sectionAssignments, state.lockedCardIds, sections])

  const hasActiveFilter = typeFilter !== null || colorFilter !== null || cmcFilter !== null

  // Quick action chips for AI chat
  const quickActions = useMemo(() => {
    const actions: { label: string; message: string }[] = []
    if (mainCount > 0 && mainCount < 60) {
      actions.push({ label: t('chat.quickFill'), message: 'Fill the remaining slots to reach 60 cards while maintaining good balance and synergy.' })
    }
    if (analysis?.warnings.some((w) => w.message.toLowerCase().includes('land'))) {
      actions.push({ label: t('chat.quickFixMana'), message: 'Fix the mana base - adjust the land count and color distribution to match the spells.' })
    }
    if (analysis?.suggestions.some((s) => s.toLowerCase().includes('removal'))) {
      actions.push({ label: t('chat.quickAddRemoval'), message: 'Add some removal spells to deal with opponent threats.' })
    }
    return actions.slice(0, 3)
  }, [mainCount, analysis, t])

  // Count how many sections still need filling
  const unfilledCount = sections.filter((s) => {
    if (s.id === 'lands') return false
    const sState = getSectionState(s.id)
    if (sState.status !== 'idle') return false
    // Also check if the section already has cards (e.g. from core card selection)
    const sectionCardIds = new Set(state.sectionAssignments[s.id] ?? [])
    const sectionTotal = state.deckCards
      .filter((c) => c.zone === 'main' && sectionCardIds.has(c.scryfallId))
      .reduce((sum, c) => sum + c.quantity, 0)
    return sectionTotal < s.targetCount
  }).length

  // Check if "Adjust lands" would actually change anything
  const landsNeedAdjustment = useMemo(() => {
    const currentLands = state.deckCards.filter((c) => BASIC_LAND_ID_SET.has(c.scryfallId) && c.zone === 'main')
    if (currentLands.length === 0) return true // no lands yet - show "Auto-fill"
    const nonLandTotal = state.deckCards
      .filter((c) => c.zone === 'main' && !BASIC_LAND_ID_SET.has(c.scryfallId))
      .reduce((s, c) => s + c.quantity, 0)
    const targetTotal = Math.max(60 - nonLandTotal, 0)
    const currentTotal = currentLands.reduce((s, c) => s + c.quantity, 0)
    return currentTotal !== targetTotal
  }, [state.deckCards])

  // ─── Ambient Gradient ────────────────────────────────────────

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

  // ─── Handlers ────────────────────────────────────────────────

  function openLightbox(card: ScryfallCard) {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      setLightboxCards(allScryfallCards)
      setLightboxIndex(idx)
      sounds.cardOpen()
    }
  }

  const handleChangeQuantity = useCallback((scryfallId: string, qty: number) => {
    history.snapshot()
    const updated = state.deckCards.map((c) =>
      c.scryfallId === scryfallId ? { ...c, quantity: qty } : c,
    )
    dispatch({ type: 'SET_DECK', cards: updated })
  }, [state.deckCards, history, dispatch])

  const handleRemoveCard = useCallback((scryfallId: string) => {
    history.snapshot()
    const updated = state.deckCards.filter((c) => c.scryfallId !== scryfallId)
    dispatch({ type: 'SET_DECK', cards: updated })
  }, [state.deckCards, history, dispatch])

  const findCardSection = useCallback((scryfallId: string): string | null => {
    for (const [sectionId, ids] of Object.entries(state.sectionAssignments)) {
      if (ids.includes(scryfallId)) return sectionId
    }
    // Check core cards
    if (state.coreCombos.length > 0 && state.selectedComboIndex != null) {
      const combo = state.coreCombos[state.selectedComboIndex]
      if (combo?.cards.some((c) => c.scryfallId === scryfallId)) return 'core'
    }
    return null
  }, [state.sectionAssignments, state.coreCombos, state.selectedComboIndex])

  const suggestReplacement = useCallback((card: ScryfallCard) => {
    const name = getCardName(card)
    const section = findCardSection(card.id)
    const sectionLabel = section ? sections.find((s) => s.id === section)?.label ?? section : null
    setLightboxIndex(null)
    const sectionHint = sectionLabel ? ` It's in the "${sectionLabel}" section of the deck.` : ''
    sendMessage(
      `Suggest a replacement for ${name}.${sectionHint} Explain why the replacement is better and make the swap.`,
      { targetSection: section ?? undefined },
    )
    setChatSheetOpen(true)
  }, [sendMessage, findCardSection, sections])

  const renderLightboxActions = useCallback((card: ScryfallCard) => {
    const deckCard = state.deckCards.find((c) => c.scryfallId === card.id && c.zone === 'main')
    if (!deckCard) return null
    const isLand = isBasicLand(card)
    const locked = lockedCardIds.has(card.id)

    return (
      <div className="space-y-2">
        {/* Quantity + Remove */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-400">{t('fill.qty')}</span>
          <div className="flex items-center gap-1">
            {(isLand ? [1, 2, 3, 4, 6, 8, 10, 12] : [1, 2, 3, 4]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { handleChangeQuantity(card.id, n); sounds.uiClick() }}
                className={`flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors ${
                  n === deckCard.quantity ? 'bg-accent text-white' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {!locked && !isLand && (
            <button
              type="button"
              onClick={() => { handleRemoveCard(card.id); setLightboxIndex(null); sounds.uiClick() }}
              className="ml-auto rounded-lg px-3 py-1.5 text-xs text-mana-red hover:bg-mana-red/10 transition-colors"
            >
              {t('fill.remove')}
            </button>
          )}
        </div>

        {/* Suggest replacement */}
        {!isLand && (
          <button
            type="button"
            onClick={() => suggestReplacement(card)}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t('fill.suggestReplacement')}
          </button>
        )}
      </div>
    )
  }, [state.deckCards, lockedCardIds, suggestReplacement, handleChangeQuantity, handleRemoveCard, sounds, t])

  function handleToggleLock(scryfallId: string) {
    dispatch({ type: 'TOGGLE_LOCK', scryfallId })
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

  // Track which cards have already animated in
  const animatedCards = useRef(new Set<string>())
  const workspaceMounted = useRef(false)
  useEffect(() => { workspaceMounted.current = true }, [])

  // ─── Sub-components ──────────────────────────────────────────

  const laneCount = (items: DeckDisplayCard[]) => items.reduce((s, d) => s + d.quantity, 0)

  function SectionLane({ section, items, isCore }: {
    section: DeckSection
    items: DeckDisplayCard[]
    isCore?: boolean
  }) {
    const [collapsed, setCollapsed] = useState(false)
    const count = laneCount(items)
    const sState = getSectionState(section.id)
    const isLands = section.id === 'lands'
    const isFilling = sState.status === 'loading'
    const hasPreview = sState.status === 'preview'
    const isFilled = sState.status === 'applied' || items.length > 0
    const fillPct = Math.min(100, (count / section.targetCount) * 100)

    return (
      <div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="mb-1 flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <span className="font-display text-sm font-bold text-surface-200">{section.label}</span>
            {section.description && !isCore && (
              <span className="hidden text-[10px] text-surface-500 sm:inline">{section.description}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className={`rounded-full bg-surface-700 px-2 py-0.5 text-xs font-medium ${
              count > section.targetCount ? 'text-mana-multi' : count === section.targetCount ? 'text-mana-green' : 'text-surface-400'
            }`}>
              {count}/{section.targetCount}
            </span>
            <span className={`text-xs text-surface-500 transition-transform duration-[--duration-quick] ${collapsed ? '' : 'rotate-90'}`}>▸</span>
          </span>
        </button>

        {/* Progress bar */}
        <div className="mb-2 h-0.5 rounded-full bg-accent/20">
          <div
            className={`h-full rounded-full transition-all duration-[--duration-smooth] ${
              fillPct >= 100 ? 'bg-mana-green' : 'bg-accent'
            }`}
            style={{ width: `${fillPct}%` }}
          />
        </div>

        {!collapsed && (
          <>
            {/* Cards */}
            {items.length > 0 && (
              <div className={isLands
                ? 'grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6'
                : isCore
                  ? 'grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4'
                  : 'grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4'
              }>
                {items.map(({ card, quantity, locked, scryfallId }, i) => {
                  const shouldAnimate = !animatedCards.current.has(scryfallId)
                  if (shouldAnimate) animatedCards.current.add(scryfallId)
                  return (
                    <div
                      key={scryfallId}
                      style={shouldAnimate ? { animation: `card-enter 300ms cubic-bezier(0.22, 1.2, 0.36, 1) both`, animationDelay: `${i * 60}ms` } : undefined}
                    >
                      {isCore ? (
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

            {/* Preview cards */}
            {hasPreview && sState.previewCards && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-3 gap-2 opacity-70 sm:grid-cols-3 md:grid-cols-4">
                  {sState.previewCards.map((pc) => (
                    pc.scryfallCard && (
                      <div key={pc.scryfallId} className="ring-1 ring-accent/40 rounded-lg">
                        <CardStack card={pc.scryfallCard} quantity={pc.quantity} onClick={() => pc.scryfallCard && openLightbox(pc.scryfallCard)} />
                      </div>
                    )
                  ))}
                </div>
                {sState.explanation && (
                  <p className="text-xs text-surface-400 italic">{sState.explanation}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplySection(section.id)}
                    className="rounded bg-mana-green/20 px-3 py-1 text-xs font-medium text-mana-green transition-colors hover:bg-mana-green/30"
                  >
                    {t('chat.apply')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFillSection(section.id)}
                    className="rounded bg-surface-700 px-3 py-1 text-xs text-surface-400 transition-colors hover:bg-surface-600"
                  >
                    {t('core.suggestDifferent')}
                  </button>
                  <button
                    type="button"
                    onClick={() => discardSection(section.id)}
                    className="rounded bg-surface-700 px-3 py-1 text-xs text-surface-400 transition-colors hover:bg-surface-600"
                  >
                    {t('chat.discard')}
                  </button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {isFilling && (
              <div className="flex items-center gap-2 py-4">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-surface-500">{t('fill.building')}</span>
              </div>
            )}

            {/* Error state */}
            {sState.status === 'error' && (
              <div className="rounded-lg bg-mana-red/10 p-3">
                <p className="text-xs text-mana-red">{sState.error}</p>
                <button
                  type="button"
                  onClick={() => handleFillSection(section.id)}
                  className="mt-2 rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  {t('core.tryAgain')}
                </button>
              </div>
            )}

            {/* Fill button */}
            {!isFilling && !hasPreview && !isCore && (
              <>
                {isLands ? (landsNeedAdjustment && (
                  <button
                    type="button"
                    onClick={handleFillLands}
                    disabled={!!fillProgress}
                    className="mt-2 w-full rounded-lg border border-dashed border-surface-600 py-3 text-sm text-surface-400 transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
                  >
                    {isFilled ? t('fill.topUpLands') : t('fill.autoFillLands')}
                  </button>
                )) : count < section.targetCount && (
                  isFilled ? (
                    <button
                      type="button"
                      onClick={() => {
                        const needed = section.targetCount - count
                        sendMessage(
                          `Add ${needed} more cards to the "${section.label}" section. Keep the existing cards and add cards that fit the section's role: ${section.description ?? section.label}.`,
                          { targetSection: section.id },
                        )
                        setChatSheetOpen(true)
                      }}
                      disabled={chatLoading}
                      className="mt-2 w-full rounded-lg border border-dashed border-surface-600 py-3 text-sm text-surface-400 transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
                    >
                      {`${t('fill.topUp')} (+${section.targetCount - count})`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleFillSection(section.id)}
                      disabled={!!fillProgress}
                      className="mt-2 w-full rounded-lg border border-dashed border-surface-600 py-3 text-sm text-surface-400 transition-colors hover:border-accent hover:text-accent disabled:opacity-30"
                    >
                      {`${t('fill.fillSection')} (${section.targetCount} cards)`}
                    </button>
                  )
                )}
              </>
            )}
          </>
        )}
      </div>
    )
  }

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

  // ─── Card Grid Content ───────────────────────────────────────

  const nonLandSections = sections.filter((s) => s.id !== 'lands')
  const landsSection = sections.find((s) => s.id === 'lands')

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

      {/* Fill All button */}
      {unfilledCount > 0 && !fillProgress && (
        <button
          type="button"
          onClick={handleFillAllRemaining}
          className="mb-4 w-full rounded-lg bg-accent py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('fill.fillAll')} ({unfilledCount} {unfilledCount === 1 ? 'section' : 'sections'})
        </button>
      )}

      {/* Fill All progress */}
      {fillProgress && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-sm text-accent">
              {t('fill.fillingProgress', { current: fillProgress.current, total: fillProgress.total })} - {fillProgress.currentSection}
            </span>
          </div>
          <button
            type="button"
            onClick={cancelFillAll}
            className="text-xs text-surface-400 hover:text-surface-200"
          >
            {t('fill.cancel')}
          </button>
        </div>
      )}

      {/* Deck sections */}
      {hasActiveFilter ? (
        // When filters active, show flat grid
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {deckDisplay.map(({ card, quantity, locked, scryfallId }) => (
            <CardStack key={scryfallId} card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => openLightbox(card)} onToggleLock={() => handleToggleLock(scryfallId)} onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)} onRemove={() => handleRemoveCard(scryfallId)} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Core section */}
          {sectionCards['core']?.length > 0 && selectedCombo && (
            <>
              <div className="rounded-lg border border-mana-multi/20 bg-mana-multi/5 px-3 py-2">
                <p className="font-display text-sm font-bold text-mana-multi">{selectedCombo.name}</p>
                <p className="mt-0.5 text-xs text-surface-400">{selectedCombo.explanation}</p>
              </div>
              <SectionLane
                section={{ id: 'core', label: t('fill.laneCore'), description: '', targetCount: coreCardCount, role: 'creatures', scryfallHints: [] }}
                items={sectionCards['core']}
                isCore
              />
            </>
          )}

          {/* Dynamic sections */}
          {nonLandSections.map((section) => (
            <SectionLane
              key={section.id}
              section={section}
              items={sectionCards[section.id] ?? []}
            />
          ))}

          {/* Unassigned cards - shown above lands so they're visible and not
              buried at the bottom of the deck view. */}
          {(sectionCards['unassigned']?.length ?? 0) > 0 && (
            <div>
              <h4 className="mb-1 font-display text-sm font-bold text-surface-200">{t('fill.unassigned')}</h4>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {sectionCards['unassigned']!.map(({ card, quantity, locked, scryfallId }) => (
                  <CardStack key={scryfallId} card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => openLightbox(card)} onToggleLock={() => handleToggleLock(scryfallId)} onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)} onRemove={() => handleRemoveCard(scryfallId)} />
                ))}
              </div>
            </div>
          )}

          {/* Lands */}
          {landsSection && (
            <SectionLane
              section={landsSection}
              items={sectionCards['lands'] ?? []}
            />
          )}
        </div>
      )}

      {/* Empty state */}
      {deckDisplay.length === 0 && !selectedCombo && unfilledCount > 0 && (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-surface-500">
          <p className="text-sm">{t('fill.emptyPrompt')}</p>
        </div>
      )}
    </>
  )

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="relative lg:-mb-20">
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
        <div className="flex items-center gap-2">
          {mainCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => { history.undo(); sounds.uiClick() }}
                disabled={!history.canUndo}
                className="rounded-lg border border-surface-600 px-2 py-1 text-xs text-surface-400 hover:border-surface-500 hover:text-surface-200 disabled:opacity-20 disabled:cursor-default transition-colors"
                title="Undo (Ctrl+Z)"
              >
                ↩
              </button>
              <button
                type="button"
                onClick={() => { history.redo(); sounds.uiClick() }}
                disabled={!history.canRedo}
                className="rounded-lg border border-surface-600 px-2 py-1 text-xs text-surface-400 hover:border-surface-500 hover:text-surface-200 disabled:opacity-20 disabled:cursor-default transition-colors"
                title="Redo (Ctrl+Shift+Z)"
              >
                ↪
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyDecklistToClipboard(state.deckCards, cardDataMap)
                  if (ok) { setCopied(true); sounds.uiClick() }
                }}
                className="rounded-lg border border-surface-600 px-2.5 py-1 text-xs text-surface-400 hover:border-surface-500 hover:text-surface-200 transition-colors"
              >
                {copied ? '\u2713 Copied' : '\u{1F4CB} Copy'}
              </button>
            </>
          )}
          <span
            className={`text-sm font-medium transition-colors duration-[--duration-smooth] ${mainCount === 60 ? 'text-mana-green' : 'text-mana-red'}`}
            style={mainCount === 60 ? { animation: 'celebrate 500ms cubic-bezier(0.34, 1.56, 0.64, 1)' } : undefined}
          >
            {t('fill.cardsCount', { count: mainCount })}
          </span>
        </div>
      </div>

      {/* ========== MOBILE LAYOUT (< lg) ========== */}
      <div className="lg:hidden pb-28">
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

        {candidatesBar && <div className="mb-3">{candidatesBar}</div>}

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

      {/* ========== MOBILE CHAT BOTTOM SHEET ========== */}
      {createPortal(<div className="fixed bottom-[60px] left-0 right-0 z-10 lg:hidden">
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
                  onApply={applyChangesWithSound}
                  onDiscard={discardChanges}
                  isLoading={chatLoading}
                  quickActions={quickActions}
                />
              </div>
            </div>
          </>
        )}
      </div>, document.body)}

      {/* ========== DESKTOP LAYOUT (>= lg) ========== */}
      <div ref={desktopGridRef} className="hidden lg:grid lg:grid-cols-12 lg:gap-3" style={{ height: desktopGridHeight }}>
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
              onApply={applyChangesWithSound}
              onDiscard={discardChanges}
              isLoading={chatLoading}
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

      {/* Fixed bottom nav */}
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
          renderActions={renderLightboxActions}
        />
      )}
    </div>
  )
}
