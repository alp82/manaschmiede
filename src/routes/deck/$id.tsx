import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Layout } from '../../components/Layout'
import { DeckCardList } from '../../components/DeckCardList'
import { SimulationPanel } from '../../components/SimulationPanel'
import { DeckEditor } from '../../components/deck/DeckEditor'
import type { LaneStatus } from '../../components/deck/SectionLane'
import { DeckIntentPanel } from '../../components/deck/DeckIntentPanel'
import { ReopenComboPicker } from '../../components/deck/ReopenComboPicker'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { UndoRedoButtons } from '../../components/ui/UndoRedoButtons'
import { useToast } from '../../components/ui/Toast'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import type { PendingChanges } from '../../lib/useDeckChat'
import { loadDeck, persistDeck, pickFeaturedCardIds, type LocalDeck } from '../../lib/deck-storage'
import { emptyIntent, deriveIntentFilters, buildChatIntentContext, type DeckIntent } from '../../lib/deck-intent'
import { pickSectionForCard } from '../../lib/section-plan'
import { applySectionInheritance, buildSectionLabelMap } from '../../lib/section-assignment'
import { useStagedRederive, refillCountFor } from '../../lib/use-staged-rederive'
import { useDeckPending } from '../../lib/use-deck-pending'
import { sectionFillIntentFromDeck } from '../../lib/section-fill-intent'
import { BASIC_LAND_ID_SET } from '../../lib/basic-lands'
import { useDeckCardData } from '../../lib/use-deck-card-data'
import { useDeckHistory } from '../../lib/use-deck-history'
import { useSections, useSectionCards, useDeckDisplay } from '../../lib/use-deck-sections'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckZone } from '../../lib/deck-utils'
import { getTotalCards, copyDecklistToClipboard, mergeCardsIntoDeck, deriveLockedIds, deriveColorsFromCards, FORMAT_LABELS } from '../../lib/deck-utils'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'

export const Route = createFileRoute('/deck/$id')({
  // TODO: deck data lives in localStorage and loads post-mount, so a dynamic
  // title would require a route loader - static fallback for now.
  head: () => ({
    meta: [{ title: 'Deck — Manaschmiede' }],
  }),
  component: DeckPage,
})

function DeckPage() {
  const t = useT()
  const sounds = useDeckSounds()
  const navigate = useNavigate()
  const toast = useToast()
  const { scryfallLang } = useI18n()
  const queryClient = useQueryClient()
  const { id } = Route.useParams()
  const [deck, setDeck] = useState<LocalDeck | null>(() => loadDeck(id))
  const [deckName, setDeckName] = useState(() => loadDeck(id)?.name ?? '')
  const [deckDescription, setDeckDescription] = useState(() => loadDeck(id)?.description ?? '')
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [pdfGenerating, setPdfGenerating] = useState(false)

  // In-memory undo/redo for edit mode (no aux persistence - `persist: false`).
  const history = useDeckHistory(
    deck?.cards ?? [],
    (cards) => setDeck((d) => (d ? { ...d, cards, updatedAt: Date.now() } : d)),
    { persist: false },
  )

  // Auto-save
  useEffect(() => {
    if (!deck) return
    const timer = setTimeout(() => {
      persistDeck({ ...deck, featuredCardIds: pickFeaturedCardIds(deck.cards, cardDataMap) })
    }, 500)
    return () => clearTimeout(timer)
  }, [deck, cardDataMap])

  // Derive deck colors from card data when all cards are resolved
  useEffect(() => {
    if (!deck || deck.cards.length === 0 || cardDataMap.size === 0) return
    const allResolved = deck.cards.every((dc) => cardDataMap.has(dc.scryfallId))
    if (!allResolved) return
    const derived = deriveColorsFromCards(deck.cards, cardDataMap)
    const prev = deck.colors ?? []
    if (derived.length !== prev.length || derived.some((c, i) => c !== prev[i])) {
      setDeck((d) => (d ? { ...d, colors: derived.length > 0 ? derived : undefined } : d))
    }
  }, [deck?.cards, cardDataMap])

  // Fetch card data - one batched /cards/collection request for default
  // prints, then per-card localization upgrades in the background. Results
  // are mirrored into React Query's cache so remounts are instant.
  const { cardsLoading } = useDeckCardData(deck?.cards ?? [], cardDataMap, setCardDataMap, {
    queryClient,
    scryfallLang,
  })

  // ─── Deck Mutations ──────────────────────────────────────────

  const addCard = useCallback((card: ScryfallCard) => {
    if (!deck) return
    history.snapshot()
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
    setDeck((prev) => {
      if (!prev) return prev
      const { merged, addedIds } = mergeCardsIntoDeck(
        prev.cards,
        [{ scryfallId: card.id, quantity: 1 }],
        (id) => BASIC_LAND_ID_SET.has(id),
      )
      // Auto-assign the card to its best-fit section so it doesn't land in the
      // "unassigned" bucket - but only when the addition actually stuck (the
      // 4-copy cap can drop it) and a section plan exists.
      const plan = prev.sectionPlan ?? []
      let sectionAssignments = prev.sectionAssignments
      if (addedIds.includes(card.id) && plan.length > 0) {
        const sectionId = pickSectionForCard(card, plan)
        if (sectionId) {
          const current = sectionAssignments?.[sectionId] ?? []
          if (!current.includes(card.id)) {
            sectionAssignments = { ...sectionAssignments, [sectionId]: [...current, card.id] }
          }
        }
      }
      return { ...prev, cards: merged, sectionAssignments, updatedAt: Date.now() }
    })
  }, [deck, history])

  const updateQuantity = useCallback((scryfallId: string, zone: DeckZone, quantity: number) => {
    history.snapshot()
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId && c.zone === zone ? { ...c, quantity } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [history])

  const removeCard = useCallback((scryfallId: string, zone: DeckZone) => {
    history.snapshot()
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.filter((c) => !(c.scryfallId === scryfallId && c.zone === zone))
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [history])

  // DeckEditor's quantity/remove callbacks are zone-agnostic (main zone only);
  // adapt them onto the zone-aware mutators the DeckCardList slot also uses.
  const changeQuantityMain = useCallback((scryfallId: string, qty: number) => {
    updateQuantity(scryfallId, 'main', qty)
  }, [updateQuantity])

  const removeCardMain = useCallback((scryfallId: string) => {
    removeCard(scryfallId, 'main')
  }, [removeCard])

  const updateDeckName = useCallback((name: string) => {
    setDeckName(name)
    setDeck((prev) => (prev ? { ...prev, name, updatedAt: Date.now() } : prev))
  }, [])

  const updateDeckDescription = useCallback((description: string) => {
    setDeckDescription(description)
    setDeck((prev) => (prev ? { ...prev, description, updatedAt: Date.now() } : prev))
  }, [])

  const toggleLock = useCallback((scryfallId: string) => {
    history.snapshot()
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId ? { ...c, locked: !c.locked } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [history])

  // ─── AI Chat (edit mode) ────────────────────────────────────

  const handleDeckUpdate = useCallback(
    (proposal: PendingChanges) => {
      const { resolvedCards, deckName, description, changes, targetSection } = proposal
      setDeck((prev) => {
        if (!prev) return prev

        // Inherit section assignments for the applied change set via the shared
        // helper: a swap's added card takes the removed card's section, removed
        // ids are purged, and remaining adds go to the lane the caller targeted
        // (a re-fill or top-up) or else are routed by pickSectionForCard.
        // Skip entirely when no plan exists — applySectionInheritance with an
        // empty `sections` would drop every add into unassigned; the prior
        // direct sectionAssignments is the correct no-plan fallback.
        let sectionAssignments = prev.sectionAssignments
        const plan = prev.sectionPlan ?? []
        if (changes.length > 0 && plan.length > 0) {
          sectionAssignments = applySectionInheritance(
            sectionAssignments ?? {},
            changes,
            {
              targetSection,
              resolveCard: (cid) => cardDataMap.get(cid),
              sections: plan,
            },
          )
        }

        return {
          ...prev,
          cards: resolvedCards,
          sectionAssignments,
          name: deckName || prev.name,
          description: description || prev.description,
          updatedAt: Date.now(),
        }
      })
      if (deckName) setDeckName(deckName)
      if (description) setDeckDescription(description)
    },
    [cardDataMap],
  )

  const handleCardDataUpdate = useCallback((card: ScryfallCard) => {
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
  }, [])

  const lockedCardIds = useMemo(() => deriveLockedIds(deck?.cards ?? []), [deck?.cards])

  // ─── Deck Intent ────────────────────────────────────────────
  // Persistent, user-authored, inert: the single source of truth for AI
  // color/budget/rarity enforcement. Legacy decks (intent undefined) fall
  // back to an empty intent and pre-seed from card colors in the panel.
  const hasStoredIntent = deck?.intent != null
  const intent = useMemo<DeckIntent>(() => deck?.intent ?? emptyIntent(), [deck?.intent])
  const fallbackColors = useMemo(
    () => deriveColorsFromCards(deck?.cards ?? [], cardDataMap),
    [deck?.cards, cardDataMap],
  )
  // Single source of truth for intent edits. Functional setState so the
  // colors-derivation effect can't clobber an in-flight edit; flows through
  // the existing 500ms autosave.
  const updateIntent = useCallback((next: DeckIntent) => {
    setDeck((prev) => (prev ? { ...prev, intent: next, updatedAt: Date.now() } : prev))
  }, [])

  const intentFilters = useMemo(
    () => ({ ...deriveIntentFilters(intent, fallbackColors), format: deck?.format }),
    [intent, fallbackColors, deck?.format],
  )
  // Fill intent driven by the deck's committed colors — backs the reopen-combo
  // picker. `getFillColors().ready` gates the affordance (SMOKE-2): false when
  // neither committed colors nor a card-derived fallback have resolved.
  const reopenFillIntent = useMemo(
    () => sectionFillIntentFromDeck(intent, fallbackColors, deck?.sectionAssignments ?? {}),
    [intent, fallbackColors, deck?.sectionAssignments],
  )
  const reopenComboReady = reopenFillIntent.getFillColors().ready
  const intentContext = useMemo(
    () => buildChatIntentContext(
      intentFilters.colors,
      intent.archetypes,
      intent.traits,
      {
        customStrategy: intent.customStrategy || undefined,
        format: deck?.format,
        budgetMin: intent.budgetMin,
        budgetMax: intent.budgetMax,
      },
    ),
    [intentFilters.colors, intent.archetypes, intent.traits, intent.customStrategy, intent.budgetMin, intent.budgetMax, deck?.format],
  )

  // ─── Per-deck pending slot (persistence) ────────────────────
  // Backs the mid-review transient state (staged re-derive plan + offered
  // combos + re-fill chat) so a reload resumes it. The slot records the
  // committed-intent fingerprint it was derived against; a structural intent
  // change evicts the stale staged layer on mount. Nothing here touches the
  // curated 60 (manaschmiede-decks) — the slot is separate, cleared on Apply.
  const { pending: deckPending, setStagedPlan, setOfferedCombos, setRefillChat, clearCardLevelPending } =
    useDeckPending(id, intent)

  const deckDisplay = useDeckDisplay(deck?.cards ?? [], cardDataMap)

  const resolveCard = useCallback((cid: string) => cardDataMap.get(cid), [cardDataMap])

  // ─── Staged re-derive (persistence-backed) ──────────────────
  // A structural intent change stages a re-derived section plan in its OWN
  // layer (NOT useDeckChat.pending). It never writes to deck.cards / triggers
  // autosave until acceptPlan, which rewrites sectionPlan + re-buckets
  // sectionAssignments only. The deck (and its autosave/color/PDF effects) stays
  // bound to the committed deck the whole time. The staged plan rehydrates from
  // (and persists to) the pending slot so a mid-review reload resumes it.
  const {
    stagedPlan,
    staleLaneIds,
    deficitFor,
    resumed: stagedPlanResumed,
    stage: stageRederive,
    acceptPlan,
    discardPlan,
  } = useStagedRederive({
    displayCards: deckDisplay,
    t,
    setDeck,
    resolveCard,
    initialPlan: deckPending.stagedPlan,
    onStagedChange: setStagedPlan,
    committedPlan: deck?.sectionPlan ?? [],
  })

  // Localized section plan — a staged re-derive (when present) takes precedence
  // over the persisted plan; both re-localize against the active locale.
  const localizedPlan = useSections({
    sectionPlan: deck?.sectionPlan ?? [],
    stagedPlan: stagedPlan ?? undefined,
    t,
  })

  // Section labels for the AI deck snapshot. Read off the SAME localizedPlan
  // that refillLane names the lane from, so "add N more cards to <lane>"
  // and the cards the model is handed speak one vocabulary — including for a
  // staged, not-yet-accepted lane, whose label can differ from the committed
  // one (a tribal lane keeps its id across a tribe switch).
  const chatSectionLabels = useMemo(() => buildSectionLabelMap(localizedPlan), [localizedPlan])

  const {
    messages,
    isLoading: chatLoading,
    pending,
    newCardIds,
    sendMessage,
    stageChanges,
    applyChanges,
    discardChanges,
  } = useDeckChat({
    cards: deck?.cards ?? [],
    cardDataMap,
    deckDescription,
    onDeckUpdate: handleDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    lockedCardIds,
    sectionAssignments: deck?.sectionAssignments ?? {},
    sectionLabels: chatSectionLabels,
    intentFilters,
    intentContext,
    initialMessages: deckPending.refillChat,
    onMessagesChange: setRefillChat,
  })

  // Wrap the chat ledger's applyChanges so that applying a proposal also evicts
  // the offered-combos + re-fill-chat from the pending slot ("cleared on Apply"
  // contract). The staged PLAN is intentionally left alone — it is its own
  // staging layer, cleared only by acceptPlan / discardPlan (decision 4).
  const handleApplyChanges = useCallback(() => {
    applyChanges()
    clearCardLevelPending()
  }, [applyChanges, clearCardLevelPending])

  // Card data must be fully loaded before a send is allowed: a delta fired
  // against a partially-played cardDataMap maps unresolved cards to their raw
  // Scryfall UUID, causing resolveRemoveIds to silently drop the removal.
  const chatIsLoading = chatLoading || cardsLoading

  // ─── PDF ─────────────────────────────────────────────────────

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
      toast.success('PDF ready')
    } catch (err) {
      console.error('PDF generation failed:', err)
      toast.error('PDF generation failed')
    } finally {
      setPdfGenerating(false)
    }
  }, [deck, cardDataMap, toast])

  // ─── Computed ────────────────────────────────────────────────

  const analysis = useMemo(() => {
    if (!deck || deck.cards.length === 0) return null
    return analyzeDeck(deck.cards, cardDataMap, 'casual', t)
  }, [deck?.cards, cardDataMap, t])

  // Build section-based card groups
  const sectionCards = useSectionCards({
    deckDisplay,
    sections: localizedPlan,
    sectionAssignments: deck?.sectionAssignments ?? {},
    lockedSource: lockedCardIds,
    fallbackByType: true,
  })

  // Per-lane re-fill (deck-view re-derive). The intent-driven fill request
  // routes through the EXISTING single chat ledger (decision 7, last-wins) — a
  // targeted "add N more cards to <lane>" message whose preview lands in
  // useDeckChat.pending. Gated on !chatIsLoading so it can't fire against a
  // partially-loaded cardDataMap (chatIsLoading folds in cardsLoading — C2 guard).
  const refillLane = useCallback(
    (laneId: string) => {
      if (chatIsLoading) return
      const section = localizedPlan.find((s) => s.id === laneId)
      if (!section) return
      // Decision 5: ask for the DEFICIT, never a targetCount fallback. A lane
      // stale from a shrinking target sits at deficit 0 with nothing to fill.
      const needed = refillCountFor(deficitFor(laneId))
      if (needed === null) return
      sendMessage(
        `Add ${needed} more cards to the "${section.label}" section. Keep the existing cards and add cards that fit the section's role: ${section.description || section.label}.`,
        { targetSection: laneId },
      )
    },
    [chatIsLoading, localizedPlan, deficitFor, sendMessage],
  )

  // Resolve per-lane stale status for DeckEditor's SectionLane render: stale
  // lanes (from the staged re-derive) dim + show the inline re-fill prompt.
  const staleLaneSet = useMemo(() => new Set(staleLaneIds), [staleLaneIds])
  const resolveLaneStatus = useCallback(
    (laneId: string): LaneStatus | undefined => {
      if (!staleLaneSet.has(laneId)) return undefined
      // A lane with no deficit (its target shrank) still dims, but offers no
      // re-fill — SectionLane hides the prompt when onRefill is absent.
      const needed = refillCountFor(deficitFor(laneId))
      return {
        stale: true,
        onRefill: needed === null ? undefined : () => refillLane(laneId),
        refillDeficit: needed ?? 0,
        refilling: chatIsLoading,
      }
    },
    [staleLaneSet, refillLane, deficitFor, chatIsLoading],
  )

  // "Forge with this card" - opens a fresh wizard seeded by this card. Used by
  // the DeckEditor lightbox.
  const forgeWithCard = useCallback((card: ScryfallCard) => {
    sounds.uiClick()
    navigate({ to: '/deck/new', search: { seed: card.id } })
  }, [navigate, sounds])

  const renderEditLightboxActions = useCallback(
    (card: ScryfallCard, close: () => void) => (
      <Button variant="primary" size="md" className="w-full" onClick={() => { close(); forgeWithCard(card) }}>
        {t('wizard.forgeWithCard')}
      </Button>
    ),
    [forgeWithCard, t],
  )

  if (!deck) {
    return (
      <Layout>
        <EmptyState title={t('deck.deckNotFound')} className="py-24" />
      </Layout>
    )
  }

  const mainCount = getTotalCards(deck.cards, 'main')

  // Edit-only rail: shaker + flat card list, fed to DeckEditor's cardListSlot.
  const cardListSlot = (
    <>
      <SimulationPanel deckId={id} deckName={deckName} cards={deck.cards} cardDataMap={cardDataMap} />
      <div className="mt-3 border border-hairline bg-ash-800/40 p-3">
        <p className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">{t('deck.cardList')}</p>
        <DeckCardList
          cards={deck.cards}
          cardData={cardDataMap}
          zone="main"
          onUpdateQuantity={updateQuantity}
          onRemoveCard={removeCard}
          onToggleLock={toggleLock}
        />
      </div>
    </>
  )

  // ─── Render ──────────────────────────────────────────────────
  // One always-capable working-mode surface (no view↔edit toggle): an
  // always-editable masthead, the collapsible intent strip, the staged-plan
  // accept/discard layer, and the dense lanes + chat/fill rail (DeckEditor).

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        {/* ─── MASTHEAD ──────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
              {FORMAT_LABELS[deck.format]}
            </span>
            <input
              type="text"
              value={deckName}
              onChange={(e) => updateDeckName(e.target.value)}
              onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
              className="mt-2 w-full border-0 border-b border-hairline bg-transparent font-display text-2xl uppercase tracking-display text-cream-100 focus:border-cream-200 focus:outline-none sm:text-display-section"
              placeholder={t('deck.namePlaceholder')}
              aria-label={t('deck.namePlaceholder')}
            />
            <input
              type="text"
              value={deckDescription}
              onChange={(e) => updateDeckDescription(e.target.value)}
              onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
              className="mt-3 w-full border-0 border-b border-hairline bg-transparent font-body text-sm italic text-cream-400 focus:border-cream-200 focus:outline-none"
              placeholder={t('deck.descriptionPlaceholder')}
              aria-label={t('deck.descriptionPlaceholder')}
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
            <span className="font-mono text-mono-num tabular-nums">
              <span className={mainCount > 60 ? 'text-ink-red-bright' : 'text-cream-300'}>
                {t('deck.cards', { count: mainCount })}
              </span>
              {mainCount > 60 && (
                <span className="ml-1 font-mono text-mono-marginal text-ink-red">
                  {t('deck.trimOver', { count: mainCount - 60 })}
                </span>
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const ok = await copyDecklistToClipboard(deck.cards, cardDataMap)
                if (ok) toast.info('Decklist copied to clipboard')
                else toast.error('Could not copy decklist')
              }}
            >
              {t('action.copy')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={pdfGenerating || mainCount === 0}
            >
              {pdfGenerating ? t('deck.pdfGenerating') : t('deck.pdf')}
            </Button>
          </div>
        </header>

        {/* ─── Collapsible intent strip ──────────────────────── */}
        <DeckIntentPanel
          intent={intent}
          format={deck.format}
          onChange={updateIntent}
          seedColors={fallbackColors}
          hasStoredIntent={hasStoredIntent}
          onStructuralCommit={stageRederive}
        />

        {/* ─── Reopen-combo picker (additive-only) ───────────── */}
        {reopenComboReady && (
          <ReopenComboPicker
            intent={reopenFillIntent}
            deckCards={deck.cards}
            onStage={(proposal) => { stageChanges(proposal); setOfferedCombos(undefined) }}
            disabled={chatIsLoading}
            initialCombos={deckPending.offeredCombos}
            onCombosChange={setOfferedCombos}
          />
        )}

        {/* ─── Staged-plan accept/discard layer ──────────────── */}
        {stagedPlan && (
          <div className="border-t border-hairline pt-4">
            <p className="font-mono text-mono-label uppercase tracking-mono-label text-ink-red-bright">
              {t('intent.stagedPlanTitle')}
            </p>
            <p className="mt-2 font-body text-sm text-cream-400">{t(stagedPlanResumed ? 'intent.stagedPlanBodyResumed' : 'intent.stagedPlanBody')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => { acceptPlan(); sounds.uiClick() }}>
                {t('intent.acceptPlan')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { discardPlan(); sounds.uiClick() }}>
                {t('intent.discardPlan')}
              </Button>
            </div>
          </div>
        )}

        {/* ─── Lanes + chat/fill rail ────────────────────────── */}
        <DeckEditor
          editing
          cards={deck.cards}
          cardDataMap={cardDataMap}
          sections={localizedPlan}
          sectionCards={sectionCards}
          lockedCardIds={lockedCardIds}
          onAddCard={addCard}
          onToggleLock={toggleLock}
          onChangeQuantity={changeQuantityMain}
          onRemoveCard={removeCardMain}
          onUndo={history.undo}
          onRedo={history.redo}
          analysis={analysis}
          cardsLoading={cardsLoading}
          cardListSlot={cardListSlot}
          renderExtraLightboxActions={renderEditLightboxActions}
          resolveLaneStatus={resolveLaneStatus}
          chat={{
            messages,
            pending,
            isLoading: chatIsLoading,
            newCardIds,
            sendMessage,
            onApply: handleApplyChanges,
            onDiscard: discardChanges,
          }}
        />
      </div>
    </Layout>
  )
}
