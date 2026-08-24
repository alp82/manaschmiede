import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { WizardNav } from './WizardNav'
import { ConfirmModal } from '../ConfirmModal'
import { DeckEditor } from '../deck/DeckEditor'
import { SimulationPanel } from '../SimulationPanel'
import { DeckCardList } from '../DeckCardList'
import { Button } from '../ui/Button'
import { UndoRedoButtons } from '../ui/UndoRedoButtons'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat, type ChatMessage as DeckChatMessage, type PendingChanges } from '../../lib/useDeckChat'
import { useSectionFill } from '../../lib/useSectionFill'
import { BASIC_LAND_ID_SET } from '../../lib/basic-lands'
import { pickSectionForCard } from '../../lib/section-plan'
import { buildSearchFilterSuffix } from '../../lib/trait-mappings'
import { useT, useI18n } from '../../lib/i18n'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../../lib/deck-utils'
import { isBasicLand, projectLocked, mergeCardsIntoDeck, getTotalCards } from '../../lib/deck-utils'
import { getCardName } from '../../lib/scryfall/types'
import type { DeckSection } from '../../lib/section-plan'
import type { WizardState, WizardAction } from '../../lib/wizard-state'
import { getActiveColors, getSelectedColors } from '../../lib/wizard-state'
import { buildChatIntentContext } from '../../lib/deck-intent'
import { sectionFillIntentFromWizard } from '../../lib/section-fill-intent'
import { applySectionInheritance, buildSectionLabelMap } from '../../lib/section-assignment'
import type { DeckFilters } from '../../lib/card-validation'
import { useDeckSounds } from '../../lib/sounds'
import { useDeckHistory } from '../../lib/use-deck-history'
import { useDeckCardData } from '../../lib/use-deck-card-data'
import { useSections, useSectionCards, useDeckDisplay } from '../../lib/use-deck-sections'

interface StepDeckFillProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onBack: () => void
  onFinish: (cardDataMap: Map<string, ScryfallCard>) => void
  onReset: () => void
}

export function StepDeckFill({ state, dispatch, onBack, onFinish, onReset }: StepDeckFillProps) {
  const t = useT()
  const { scryfallLang } = useI18n()
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [finishBlockedOpen, setFinishBlockedOpen] = useState(false)
  const sounds = useDeckSounds()
  const history = useDeckHistory(state.deckCards, (cards) => dispatch({ type: 'SET_DECK', cards }), { persist: true })

  const selectedCombo = state.selectedComboIndex != null
    ? state.coreCombos[state.selectedComboIndex] ?? null
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

  const cards = useMemo(() => projectLocked(state.deckCards, lockedCardIds), [state.deckCards, lockedCardIds])

  const handleDeckUpdate = useCallback((proposal: PendingChanges) => {
    dispatch({
      type: 'SET_DECK',
      cards: projectLocked(proposal.resolvedCards, lockedCardIds),
      name: proposal.deckName,
      description: proposal.description,
    })
  }, [dispatch, lockedCardIds])

  const handleCardDataUpdate = useCallback((card: ScryfallCard) => {
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
  }, [])

  const handleChatMessagesChange = useCallback((messages: DeckChatMessage[]) => {
    dispatch({ type: 'SET_CHAT_MESSAGES', messages })
  }, [dispatch])

  // Replace, not merge — see mergeSectionFill in section-assignment.ts. The
  // wholesale overwrite is what lets applySectionInheritance shrink a section
  // when ids are purged; the section-fill hook unions prior ids in for the
  // additive paths before it calls this.
  const replaceSectionAssignment = useCallback((sectionId: string, scryfallIds: string[]) => {
    dispatch({ type: 'ASSIGN_SECTION', sectionId, scryfallIds })
  }, [dispatch])

  // ─── Section Plan ────────────────────────────────────────────

  const coreCardCount = useMemo(() => {
    if (!selectedCombo) return 0
    return selectedCombo.cards.filter((c) => c.scryfallId).length * 4
  }, [selectedCombo])

  // Derive section plan on mount (or use persisted one). Persisted plans are
  // re-localized against the current locale so labels and descriptions follow
  // language switches after the plan was stored.
  const deriveArgs = useMemo(
    () => ({
      archetypes: state.selectedArchetypes,
      traits: state.selectedTraits,
      coreCardCount,
      colors: getActiveColors(state.colors),
    }),
    [state.selectedArchetypes, state.selectedTraits, coreCardCount, state.colors],
  )
  const sections = useSections({ sectionPlan: state.sectionPlan, t, deriveArgs })

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
      for (const card of selectedCombo.cards) {
        if (card.scryfallId) {
          coreCards.push({ scryfallId: card.scryfallId, quantity: 4, zone: 'main' })
          dispatch({ type: 'TOGGLE_LOCK', scryfallId: card.scryfallId })
          if (card.scryfallCard) handleCardDataUpdate(card.scryfallCard)
        }
      }
      if (coreCards.length > 0) {
        dispatch({ type: 'SET_DECK', cards: coreCards })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Section Fill ────────────────────────────────────────────

  const handleSectionDeckUpdate = useCallback((updated: DeckCard[]) => {
    dispatch({ type: 'SET_DECK', cards: updated })
  }, [dispatch])

  const fillIntent = useMemo(() => sectionFillIntentFromWizard(state), [state])

  const {
    canFillLands,
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
    intent: fillIntent,
    onDeckUpdate: handleSectionDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    replaceSectionAssignment,
    lockedCardIds,
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
    // Bail before stripping anything — a no-op fillLands after the strip would
    // leave the deck with no lands at all. The button is disabled in the same
    // condition, so this is the backstop, not the user-facing signal.
    if (!canFillLands) return
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
  }, [state.deckCards, canFillLands, fillLands, sounds, history, dispatch])

  // ─── Chat (for free-text refinement) ─────────────────────────

  const sectionLabels = useMemo(() => buildSectionLabelMap(sections), [sections])

  // Allowed colors for AI enforcement = committed (selected) colors; fall back
  // to active colors (selected + maybe) only when nothing is committed, so the
  // wizard chat isn't fully unconstrained while colors are still being chosen.
  const intentFilters = useMemo((): DeckFilters => {
    const selected = getSelectedColors(state.colors)
    const colors = selected.length > 0 ? selected : getActiveColors(state.colors)
    return {
      colors,
      format: state.format,
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      rarities: state.rarityFilter,
    }
  }, [state.colors, state.format, state.budgetMin, state.budgetMax, state.rarityFilter])

  const intentContext = useMemo(
    () => buildChatIntentContext(
      intentFilters.colors,
      state.selectedArchetypes,
      state.selectedTraits,
      {
        customStrategy: state.customStrategy || undefined,
        format: state.format,
        budgetMin: state.budgetMin,
        budgetMax: state.budgetMax,
      },
    ),
    [intentFilters.colors, state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.format, state.budgetMin, state.budgetMax],
  )

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
    intentFilters,
    intentContext,
  })

  const applyChangesWithSound = useCallback(() => {
    history.snapshot()

    if (pending?.changes) {
      const next = applySectionInheritance(state.sectionAssignments, pending.changes, {
        targetSection: pending.targetSection,
        resolveCard: (id) => cardDataMap.get(id),
        sections,
      })

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

  const { cardsLoading } = useDeckCardData(state.deckCards, cardDataMap, setCardDataMap, { scryfallLang })

  // ─── Search suffix ───────────────────────────────────────────

  const searchSuffix = useMemo(() => {
    const activeColors = getActiveColors(state.colors)
    return buildSearchFilterSuffix(activeColors, {
      format: state.format,
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetMin, state.budgetMax, state.rarityFilter])

  // ─── Computed Values ─────────────────────────────────────────

  const analysis = useMemo(() => {
    if (state.deckCards.length === 0) return null
    return analyzeDeck(state.deckCards, cardDataMap, state.format, t)
  }, [state.deckCards, cardDataMap, state.format, t])

  const deckDisplay = useDeckDisplay(cards, cardDataMap)

  const mainCount = getTotalCards(state.deckCards, 'main')

  const prevMainCount = useRef(mainCount)
  useEffect(() => {
    if (mainCount === 60 && prevMainCount.current !== 60) {
      sounds.deckComplete()
    }
    prevMainCount.current = mainCount
  }, [mainCount, sounds])

  const handleFinishClick = () => {
    if (mainCount !== 60) {
      setFinishBlockedOpen(true)
      return
    }
    onFinish(cardDataMap)
  }

  // Build section card assignments for display. The core lane is synthesized
  // here (target = coreCardCount) so DeckEditor can show its progress.
  const coreSource = useMemo(() => new Set(state.lockedCardIds), [state.lockedCardIds])
  const sectionCards = useSectionCards({
    deckDisplay,
    sections,
    sectionAssignments: state.sectionAssignments,
    lockedSource: coreSource,
    fallbackByType: false,
  })

  const editorSections = useMemo((): DeckSection[] => {
    if (!selectedCombo) return sections
    const coreSection: DeckSection = {
      id: 'core',
      label: t('fill.laneCore'),
      description: '',
      targetCount: coreCardCount,
      role: 'creatures',
      scryfallHints: [],
    }
    return [coreSection, ...sections]
  }, [selectedCombo, sections, coreCardCount, t])

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

  // ─── Adapter callbacks ───────────────────────────────────────

  const handleAddCard = useCallback((card: ScryfallCard) => {
    history.snapshot()
    handleCardDataUpdate(card)
    const { merged, addedIds } = mergeCardsIntoDeck(
      projectLocked(state.deckCards, lockedCardIds),
      [{ scryfallId: card.id, quantity: 1 }],
      (id) => BASIC_LAND_ID_SET.has(id),
    )
    dispatch({ type: 'SET_DECK', cards: merged })
    // Auto-assign to its best-fit section so it doesn't fall into "unassigned".
    if (addedIds.includes(card.id) && sections.length > 0) {
      const sectionId = pickSectionForCard(card, sections)
      if (sectionId) {
        const current = state.sectionAssignments[sectionId] ?? []
        if (!current.includes(card.id)) {
          dispatch({ type: 'ASSIGN_SECTION', sectionId, scryfallIds: [...current, card.id] })
        }
      }
    }
  }, [state.deckCards, state.sectionAssignments, sections, dispatch, history, handleCardDataUpdate])

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

  const handleToggleLock = useCallback((scryfallId: string) => {
    dispatch({ type: 'TOGGLE_LOCK', scryfallId })
  }, [dispatch])

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
    const sectionHint = sectionLabel ? ` It's in the "${sectionLabel}" section of the deck.` : ''
    sendMessage(
      `Suggest a replacement for ${name}.${sectionHint} Explain why the replacement is better and make the swap.`,
      { targetSection: section ?? undefined },
    )
  }, [sendMessage, findCardSection, sections])

  const renderExtraLightboxActions = useCallback((card: ScryfallCard, close: () => void) => {
    if (isBasicLand(card)) return null
    const inDeck = state.deckCards.some((c) => c.scryfallId === card.id && c.zone === 'main')
    if (!inDeck) return null
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => { close(); suggestReplacement(card) }}
        className="w-full"
      >
        {t('fill.suggestReplacement')}
      </Button>
    )
  }, [state.deckCards, suggestReplacement, t])

  const ambientColors = useMemo(() => getActiveColors(state.colors), [state.colors])

  // ─── Stats rail (Simulation + flat card list) ────────────────

  // DeckCardList is zone-aware; the wizard's mutators are zone-agnostic (main
  // only), so adapt them the way the edit route does (changeQuantityMain etc.).
  const slotUpdateQuantity = useCallback((scryfallId: string, _zone: DeckZone, qty: number) => {
    handleChangeQuantity(scryfallId, qty)
  }, [handleChangeQuantity])

  const slotRemoveCard = useCallback((scryfallId: string, _zone: DeckZone) => {
    handleRemoveCard(scryfallId)
  }, [handleRemoveCard])

  // Both panels read the projected `cards` (carry `locked`) so DeckCardList can
  // render the lock slab; raw state.deckCards don't carry that flag. deckId=""
  // is a safe sentinel since the unsaved wizard deck isn't in storage.
  const cardListSlot = (
    <>
      <SimulationPanel deckId="" deckName={state.deckName} cards={cards} cardDataMap={cardDataMap} />
      <div className="mt-3 border border-hairline bg-ash-800/40 p-3">
        <p className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">{t('deck.cardList')}</p>
        <DeckCardList
          cards={cards}
          cardData={cardDataMap}
          zone="main"
          onUpdateQuantity={slotUpdateQuantity}
          onRemoveCard={slotRemoveCard}
          onToggleLock={handleToggleLock}
        />
      </div>
    </>
  )

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="relative lg:-mb-20">
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
          <UndoRedoButtons
            show={mainCount > 0}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => { history.undo(); sounds.uiClick() }}
            onRedo={() => { history.redo(); sounds.uiClick() }}
            undoLabel={t('action.undo')}
            redoLabel={t('action.redo')}
          />
        </div>
      </header>

      <DeckEditor
        editing
        cards={cards}
        cardDataMap={cardDataMap}
        sections={editorSections}
        sectionCards={sectionCards}
        lockedCardIds={lockedCardIds}
        onAddCard={handleAddCard}
        onToggleLock={handleToggleLock}
        onChangeQuantity={handleChangeQuantity}
        onRemoveCard={handleRemoveCard}
        onUndo={history.undo}
        onRedo={history.redo}
        analysis={analysis}
        cardsLoading={cardsLoading}
        cardListSlot={cardListSlot}
        ambientColors={ambientColors}
        searchSuffix={searchSuffix}
        desktopBottomGap={72}
        renderExtraLightboxActions={renderExtraLightboxActions}
        chat={{
          messages,
          pending,
          isLoading: chatLoading,
          newCardIds,
          sendMessage,
          onApply: applyChangesWithSound,
          onDiscard: discardChanges,
        }}
        fill={{
          getSectionState,
          onFillSection: handleFillSection,
          onApplySection: handleApplySection,
          onDiscardSection: discardSection,
          onFillLands: handleFillLands,
          canFillLands,
          onFillAllRemaining: handleFillAllRemaining,
          fillProgress,
          onCancelFillAll: cancelFillAll,
          landsNeedAdjustment,
          unfilledCount,
        }}
      />

      {/* Fixed bottom nav */}
      <WizardNav wide>
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="lg" onClick={onBack}>
            {t('wizard.back')}
          </Button>
          <div className="flex items-center gap-4">
            <span className={`font-mono text-mono-marginal tabular-nums ${mainCount === 60 ? 'text-cream-100' : 'text-cream-400'}`}>
              {t('wizard.cardCountOfTarget', { count: mainCount })}
            </span>
            <Button variant="primary" size="lg" onClick={handleFinishClick}>
              {t('fill.finishOpen')}
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-center">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('wizard.reset')}
          </Button>
        </div>
      </WizardNav>

      <ConfirmModal
        open={finishBlockedOpen}
        title={t('wizard.finishBlockedTitle')}
        body={t('wizard.finishBlockedBody', { count: mainCount })}
        confirmLabel={t('wizard.finishBlockedContinueEditing')}
        cancelLabel={t('wizard.finishBlockedContinueEditing')}
        confirmVariant="primary"
        showCancel={false}
        onConfirm={() => setFinishBlockedOpen(false)}
        onCancel={() => setFinishBlockedOpen(false)}
      />
    </div>
  )
}
