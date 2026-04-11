import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AiChat } from '../AiChat'
import { BalanceAdvisor } from '../BalanceAdvisor'
import { CardLightbox } from '../CardLightbox'
import { CardStack } from '../CardStack'
import { CardImage } from '../CardImage'
import { SearchInput } from '../SearchInput'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'
import { Kbd } from '../ui/Kbd'
import { LoadingDots } from '../ui/LoadingDots'
import { ErrorBox } from '../ui/ErrorBox'
import { Tabs } from '../ui/Tabs'
import { SectionLaneHeader } from '../ui/SectionLaneHeader'
import { cn } from '../../lib/utils'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat, type ChatMessage as DeckChatMessage } from '../../lib/useDeckChat'
import { useSectionFill } from '../../lib/useSectionFill'
import { BASIC_LAND_ID_SET } from '../../lib/basic-lands'
import { deriveSectionPlan, localizeDeckSection, pickSectionForCard } from '../../lib/section-plan'
import { searchCards } from '../../lib/scryfall/client'
import { buildSearchFilterSuffix } from '../../lib/trait-mappings'
import { useT } from '../../lib/i18n'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard } from '../../lib/deck-utils'
import { isBasicLand } from '../../lib/deck-utils'
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
  onReset: () => void
}

type MobileTab = 'cards' | 'chat' | 'stats'

export function StepDeckFill({ state, dispatch, onBack, onFinish, onReset }: StepDeckFillProps) {
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

  // Derive section plan on mount (or use persisted one).
  // Persisted plans are re-localized against the current locale so labels
  // and descriptions follow language switches after the plan was stored.
  const sections = useMemo(() => {
    if (state.sectionPlan.length > 0) {
      return state.sectionPlan.map((s) => localizeDeckSection(s, t))
    }
    const activeColors = getActiveColors(state.colors)
    return deriveSectionPlan(state.selectedArchetypes, state.selectedTraits, coreCardCount, activeColors, t)
  }, [state.sectionPlan, state.selectedArchetypes, state.selectedTraits, state.colors, coreCardCount, t])

  // Persist section plan
  useEffect(() => {
    if (state.sectionPlan.length === 0 && sections.length > 0) {
      dispatch({ type: 'SET_SECTION_PLAN', sections })
    }
  }, [sections, state.sectionPlan.length, dispatch])

  // Backfill deck metadata from the selected combo for wizards that were
  // persisted before the combo→metadata wiring landed. New wizards get
  // metadata populated on SELECT_COMBO, so this only fires for resumed
  // sessions where deckName ended up empty.
  useEffect(() => {
    if (!selectedCombo) return
    if (state.deckName || state.deckDescription) return
    dispatch({
      type: 'SET_DECK_METADATA',
      name: selectedCombo.name,
      description: selectedCombo.explanation,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetMin, state.budgetMax, state.rarityFilter])

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
    return analyzeDeck(state.deckCards, cardDataMap, state.format, t)
  }, [state.deckCards, cardDataMap, state.format, t])

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
    if (analysis?.warnings.some((w) => w.message.toLowerCase().includes('land'))) {
      actions.push({ label: t('chat.quickFixMana'), message: 'Fix the mana base - adjust the land count and color distribution to match the spells.' })
    }
    if (analysis?.suggestions.some((s) => s.toLowerCase().includes('removal'))) {
      actions.push({ label: t('chat.quickAddRemoval'), message: 'Add some removal spells to deal with opponent threats.' })
    }
    return actions.slice(0, 3)
  }, [analysis, t])

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
      <div className="space-y-3">
        {/* Quantity + Remove */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
            {t('fill.qty')}
          </span>
          <div className="flex items-center gap-1">
            {(isLand ? [1, 2, 3, 4, 6, 8, 10, 12] : [1, 2, 3, 4]).map((n) => (
              <Pill
                key={n}
                size="sm"
                selected={n === deckCard.quantity}
                onClick={() => { handleChangeQuantity(card.id, n); sounds.uiClick() }}
                className="h-8 w-8 p-0 tabular-nums"
              >
                {n}
              </Pill>
            ))}
          </div>
          {!locked && !isLand && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { handleRemoveCard(card.id); setLightboxIndex(null); sounds.uiClick() }}
              className="ml-auto"
            >
              {t('fill.remove')}
            </Button>
          )}
        </div>

        {/* Suggest replacement */}
        {!isLand && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => suggestReplacement(card)}
            className="w-full"
          >
            {t('fill.suggestReplacement')}
          </Button>
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

  function SectionLane({ section, items, isCore, sectionLetter }: {
    section: DeckSection
    items: DeckDisplayCard[]
    isCore?: boolean
    sectionLetter?: string
  }) {
    const [collapsed, setCollapsed] = useState(false)
    const count = laneCount(items)
    const sState = getSectionState(section.id)
    const isLands = section.id === 'lands'
    const isFilling = sState.status === 'loading'
    const hasPreview = sState.status === 'preview'
    const isFilled = sState.status === 'applied' || items.length > 0
    const fillPct = Math.min(100, (count / section.targetCount) * 100)
    const overFilled = count > section.targetCount
    const underFilled = count < section.targetCount

    return (
      <div className={cn('relative', isCore && 'pl-3')}>
        {/* Core section marker — ink-red slab on left edge */}
        {isCore && (
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-0 top-2 w-[3px] bg-ink-red"
          />
        )}

        <SectionLaneHeader
          letter={sectionLetter}
          label={section.label}
          description={!isCore ? section.description : undefined}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          progressPct={fillPct}
          progressOver={overFilled}
          count={
            <span
              className={cn(
                'tabular-nums',
                overFilled
                  ? 'text-ink-red-bright'
                  : underFilled
                    ? 'text-cream-400'
                    : 'text-cream-100',
              )}
            >
              {count} / {section.targetCount}
            </span>
          }
        />

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
                      <CardStack
                        card={card}
                        quantity={quantity}
                        locked={locked}
                        isNew={newCardIds.has(scryfallId)}
                        onClick={() => openLightbox(card)}
                        onToggleLock={() => handleToggleLock(scryfallId)}
                        onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)}
                        onRemove={() => handleRemoveCard(scryfallId)}
                      />
                    </div>
                  )
                })}
              </div>
            )}

            {/* Preview cards — hairline-framed ink-red preview state */}
            {hasPreview && sState.previewCards && (
              <div className="mt-4 border border-ink-red bg-ash-800/40 p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
                    {t('deck.previewLabel')}
                  </span>
                  <span className="font-mono text-mono-tag tabular-nums tracking-mono-tag text-cream-400">
                    {t('fill.suggestionCount', { count: sState.previewCards.length })}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 opacity-90 sm:grid-cols-3 md:grid-cols-4">
                  {sState.previewCards.map((pc) => (
                    pc.scryfallCard && (
                      <CardStack
                        key={pc.scryfallId}
                        card={pc.scryfallCard}
                        quantity={pc.quantity}
                        onClick={() => pc.scryfallCard && openLightbox(pc.scryfallCard)}
                      />
                    )
                  ))}
                </div>
                {sState.explanation && (
                  <p className="mt-3 font-body text-sm italic text-cream-300">{sState.explanation}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => handleApplySection(section.id)}>
                    {t('chat.apply')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleFillSection(section.id)}>
                    {t('core.suggestDifferent')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => discardSection(section.id)}>
                    {t('chat.discard')}
                  </Button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {isFilling && (
              <div className="mt-3 flex items-center gap-3 py-3">
                <LoadingDots size="md" tone="bright" />
                <span className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400">
                  {t('fill.building')}
                </span>
              </div>
            )}

            {/* Error state */}
            {sState.status === 'error' && (
              <ErrorBox
                className="mt-3"
                message={sState.error ?? ''}
                onRetry={() => handleFillSection(section.id)}
                retryLabel={t('core.tryAgain')}
              />
            )}

            {/* Fill button */}
            {!isFilling && !hasPreview && !isCore && (
              <>
                {isLands ? (landsNeedAdjustment && (
                  <button
                    type="button"
                    onClick={handleFillLands}
                    disabled={!!fillProgress}
                    className="mt-3 w-full border border-dashed border-hairline-strong py-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:border-ink-red hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
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
                      className="mt-3 w-full border border-dashed border-hairline-strong py-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:border-ink-red hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {`${t('fill.topUp')} (+${section.targetCount - count})`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleFillSection(section.id)}
                      disabled={!!fillProgress}
                      className="mt-3 w-full border border-dashed border-hairline-strong py-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:border-ink-red hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {`${t('fill.fillSection')} (${t('fill.cardsCountShort', { count: section.targetCount })})`}
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
    <div className="flex flex-wrap items-center gap-2 border border-ink-red bg-ash-800/40 p-3">
      <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
        {t('fill.candidates')}
      </span>
      {candidates.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1.5 border border-hairline-strong bg-ash-900 px-2 py-1 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-100"
        >
          {c.name}
          <button
            type="button"
            onClick={() => removeCandidate(c.id)}
            className="text-cream-500 transition-colors hover:text-ink-red-bright focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
            aria-label="Remove"
          >
            {'\u00D7'}
          </button>
        </span>
      ))}
      <div className="ml-auto">
        <Button variant="primary" size="sm" onClick={sendCandidates}>
          {t('fill.addToDeck')}
        </Button>
      </div>
    </div>
  )

  // ─── Card Grid Content ───────────────────────────────────────

  const nonLandSections = sections.filter((s) => s.id !== 'lands')
  const landsSection = sections.find((s) => s.id === 'lands')

  const cardGridContent = (
    <>
      {/* Search results: new cards to add */}
      {newSearchResults.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('fill.addToDeck')}
          </h4>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {newSearchResults.map((card) => {
              const isCandidate = !!candidates.find((c) => c.id === card.id)
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => addCandidate(card)}
                  className={cn(
                    'group relative overflow-hidden border transition-all hover:-translate-y-1',
                    isCandidate
                      ? 'border-ink-red'
                      : 'border-hairline opacity-80 hover:border-hairline-strong hover:opacity-100',
                  )}
                >
                  <CardImage card={card} size="normal" />
                  <span
                    className={cn(
                      'absolute inset-x-0 bottom-0 bg-ink-red py-1.5 text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-100 transition-transform duration-150',
                      isCandidate ? 'translate-y-0' : 'translate-y-full group-hover:translate-y-0',
                    )}
                  >
                    {isCandidate ? `\u2713 ${t('deck.queued')}` : `+ ${t('deckPage.addOverlay')}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {searching && (
        <p className="py-4 text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
          {t('search.searching')}
        </p>
      )}

      {/* Fill All button */}
      {unfilledCount > 0 && !fillProgress && (
        <div className="mb-6">
          <Button
            variant="primary"
            size="lg"
            onClick={handleFillAllRemaining}
            className="w-full"
          >
            {t('fill.fillAll')} ({t('fill.sectionCount', { count: unfilledCount })})
          </Button>
        </div>
      )}

      {/* Fill All progress */}
      {fillProgress && (
        <div className="mb-6 flex items-center justify-between border border-ink-red bg-ash-800/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <LoadingDots size="md" tone="bright" />
            <span className="font-mono text-mono-label uppercase tabular-nums tracking-mono-label text-cream-100">
              {t('fill.fillingProgress', { current: fillProgress.current, total: fillProgress.total })}
              <span className="ml-2 text-cream-400">&mdash; {fillProgress.currentSection}</span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={cancelFillAll}>
            {t('fill.cancel')}
          </Button>
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
        <div className="[&>*+*]:mt-16 [&>*+*]:border-t-2 [&>*+*]:border-cream-500 [&>*+*]:pt-16">
          {/* Core section */}
          {sectionCards['core']?.length > 0 && selectedCombo && (
            <div>
              <div className="mb-6 border border-hairline bg-ash-800/40 px-4 py-3">
                <p className="font-display text-display-eyebrow uppercase tracking-eyebrow text-cream-100">
                  {selectedCombo.name}
                </p>
                <p className="mt-1 font-body text-sm italic text-cream-400">
                  {selectedCombo.explanation}
                </p>
              </div>
              <SectionLane
                section={{ id: 'core', label: t('fill.laneCore'), description: '', targetCount: coreCardCount, role: 'creatures', scryfallHints: [] }}
                items={sectionCards['core']}
                isCore
                sectionLetter="A"
              />
            </div>
          )}

          {/* Dynamic sections */}
          {nonLandSections.map((section, i) => (
            <SectionLane
              key={section.id}
              section={section}
              items={sectionCards[section.id] ?? []}
              sectionLetter={String.fromCharCode(66 + i)}
            />
          ))}

          {/* Unassigned cards — shown above lands so they're visible */}
          {(sectionCards['unassigned']?.length ?? 0) > 0 && (
            <div>
              <div className="mb-3 flex items-baseline justify-between border-b border-hairline pb-2">
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-400">
                    U
                  </span>
                  <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-100">
                    {t('fill.unassigned')}
                  </span>
                </span>
                <span className="whitespace-nowrap font-mono text-mono-label tabular-nums tracking-mono-label text-cream-300">
                  {sectionCards['unassigned']!.reduce((s, d) => s + d.quantity, 0)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {sectionCards['unassigned']!.map(({ card, quantity, locked, scryfallId }) => (
                  <CardStack
                    key={scryfallId}
                    card={card}
                    quantity={quantity}
                    locked={locked}
                    isNew={newCardIds.has(scryfallId)}
                    onClick={() => openLightbox(card)}
                    onToggleLock={() => handleToggleLock(scryfallId)}
                    onChangeQuantity={(qty) => handleChangeQuantity(scryfallId, qty)}
                    onRemove={() => handleRemoveCard(scryfallId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Lands */}
          {landsSection && (
            <SectionLane
              section={landsSection}
              items={sectionCards['lands'] ?? []}
              sectionLetter="L"
            />
          )}
        </div>
      )}

      {/* Empty state */}
      {/* TODO: migrate to <EmptyState> once an i18n title key exists — current
          prompt is description-only and the primitive requires a title. */}
      {deckDisplay.length === 0 && !selectedCombo && unfilledCount > 0 && (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 py-12 text-center">
          <p className="font-body text-sm italic text-cream-400">{t('fill.emptyPrompt')}</p>
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
      <header className="mb-6 flex flex-col gap-4 border-b border-hairline pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-ink-red-bright">
            {state.format.toUpperCase()}
          </span>
          <input
            type="text"
            value={state.deckName}
            onChange={(e) => dispatch({ type: 'SET_DECK_METADATA', name: e.target.value })}
            onKeyDown={(e) => { if (e.key.length === 1) sounds.typing() }}
            placeholder={t('deck.namePlaceholder')}
            aria-label={t('deck.namePlaceholder')}
            className="mt-2 w-full border-0 border-b border-hairline bg-transparent font-display text-2xl uppercase leading-tight tracking-display text-cream-100 placeholder-cream-500 focus:border-cream-200 focus:outline-none sm:text-display-section"
          />
          <input
            type="text"
            value={state.deckDescription}
            onChange={(e) => dispatch({ type: 'SET_DECK_METADATA', description: e.target.value })}
            onKeyDown={(e) => { if (e.key.length === 1) sounds.typing() }}
            placeholder={t('deck.descriptionPlaceholder')}
            aria-label={t('deck.descriptionPlaceholder')}
            className="mt-3 w-full border-0 border-b border-hairline bg-transparent font-body text-sm italic text-cream-400 placeholder-cream-500 focus:border-cream-200 focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {mainCount > 0 && (
            <>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => { history.undo(); sounds.uiClick() }}
                  disabled={!history.canUndo}
                  className="flex h-8 items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
                  title={t('action.undo')}
                >
                  <span aria-hidden="true" className="text-base leading-none">{'\u21A9'}</span>
                  {t('action.undo')}
                </button>
                <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <Kbd>{'\u2318Z'}</Kbd>
                </div>
              </div>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => { history.redo(); sounds.uiClick() }}
                  disabled={!history.canRedo}
                  className="flex h-8 items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
                  title={t('action.redo')}
                >
                  <span aria-hidden="true" className="text-base leading-none">{'\u21AA'}</span>
                  {t('action.redo')}
                </button>
                <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <Kbd>{'\u2318\u21E7Z'}</Kbd>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ========== MOBILE LAYOUT (< lg) ========== */}
      <div className="lg:hidden pb-28">
        <Tabs
          className="mb-6"
          value={mobileTab}
          onChange={(id) => setMobileTab(id as MobileTab)}
          items={[
            { id: 'cards', label: t('deck.paneCards'), panelId: 'fill-tabpanel-cards' },
            { id: 'stats', label: t('deck.paneStats'), panelId: 'fill-tabpanel-stats' },
          ]}
        />

        {candidatesBar && <div className="mb-4">{candidatesBar}</div>}

        {mobileTab === 'cards' && (
          <div id="fill-tabpanel-cards" role="tabpanel" aria-labelledby="tab-cards" className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
              </div>
              {hasActiveFilter && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setTypeFilter(null); setColorFilter(null); setCmcFilter(null) }}
                >
                  {t('fill.clearFilters')}
                </Button>
              )}
            </div>
            {cardGridContent}
          </div>
        )}

        {mobileTab === 'stats' && (
          <div id="fill-tabpanel-stats" role="tabpanel" aria-labelledby="tab-stats" className="space-y-4">
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
          <div className="border-t border-hairline bg-ash-900/95 px-3 py-3 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center border border-hairline-strong bg-ash-800 px-3 py-2">
                <input
                  type="text"
                  readOnly
                  onFocus={() => setChatSheetOpen(true)}
                  placeholder={chatLoading ? '...' : t('chat.inputPlaceholder')}
                  className="flex-1 bg-transparent font-mono text-mono-label text-cream-100 placeholder-cream-400 focus:outline-none"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setChatSheetOpen(true)}
              >
                {t('chat.send')}
              </Button>
            </div>
          </div>
        )}

        {chatSheetOpen && (
          <>
            <div className="fixed inset-0 z-[9] bg-ash-900/80" onClick={() => setChatSheetOpen(false)} />
            <div
              className="relative z-[10] flex flex-col border-t border-hairline-strong bg-ash-900"
              style={{ height: '50dvh', animation: 'card-enter 200ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
            >
              <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                  {t('deck.paneChat')}
                </span>
                <button
                  type="button"
                  onClick={() => setChatSheetOpen(false)}
                  className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-ink-red-bright focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
                  aria-label={t('action.close')}
                >
                  {t('action.close')}
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
      <div ref={desktopGridRef} className="hidden lg:grid lg:grid-cols-12 lg:gap-4" style={{ height: desktopGridHeight }}>
        {/* Left: AI Chat */}
        <div
          className="flex min-h-0 flex-col lg:col-span-3"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '100ms' } : undefined}
        >
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneChat')}
          </span>
          {candidatesBar && <div className="mb-3">{candidatesBar}</div>}
          <div className="min-h-0 flex-1 border border-hairline bg-ash-800/40">
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
          className="flex min-h-0 flex-col lg:col-span-6"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '200ms' } : undefined}
        >
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneCards')}
          </span>
          <div className="mb-3 flex gap-2">
            <div className="flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
            </div>
            {hasActiveFilter && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setTypeFilter(null); setColorFilter(null); setCmcFilter(null) }}
              >
                {t('fill.clearFilters')}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border border-hairline bg-ash-800/40 p-4">
            {cardGridContent}
          </div>
        </div>

        {/* Right: Balance advisor */}
        <div
          className="flex min-h-0 flex-col lg:col-span-3"
          style={!workspaceMounted.current ? { animation: 'card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: '300ms' } : undefined}
        >
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneBalance')}
          </span>
          <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>

      {/* Fixed bottom nav */}
      {createPortal(
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-hairline bg-ash-900/95 px-4 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="lg" onClick={onBack}>
                {t('wizard.back')}
              </Button>
              <Button variant="ghost" size="md" onClick={onReset}>
                {t('wizard.reset')}
              </Button>
            </div>
            <Button variant="primary" size="lg" onClick={onFinish} disabled={mainCount === 0}>
              {t('fill.finishOpen')}
            </Button>
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
