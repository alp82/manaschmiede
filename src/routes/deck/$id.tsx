import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Layout } from '../../components/Layout'
import { DeckCardList } from '../../components/DeckCardList'
import { DeckCardSkeleton } from '../../components/ui/DeckCardSkeleton'
import { SimulationPanel } from '../../components/SimulationPanel'
import { DeckEditor } from '../../components/deck/DeckEditor'
import { DeckIntentPanel } from '../../components/deck/DeckIntentPanel'
import { ReopenComboPicker } from '../../components/deck/ReopenComboPicker'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { UndoRedoButtons } from '../../components/ui/UndoRedoButtons'
import { useToast } from '../../components/ui/Toast'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import { pickFeaturedCardIds, type Deck } from '../../lib/deck'
import { deckStore } from '../../lib/storage/deck-store'
import { emptyIntent, deriveIntentFilters, buildChatIntentContext, type DeckIntent } from '../../lib/deck-intent'
import { buildSectionLabelMap } from '../../lib/section-assignment'
import { deckSurfaceFromSavedDeck } from '../../lib/deck-surface'
import { useStagedRederive } from '../../lib/use-staged-rederive'
import { useDeckPending } from '../../lib/use-deck-pending'
import { sectionFillIntentFromDeck } from '../../lib/section-fill-intent'
import { useDeckCardData } from '../../lib/use-deck-card-data'
import { TARGET_DECK_SIZE } from '../../../convex/lib/deckRules'
import { useDeckHistory } from '../../lib/use-deck-history'
import { useSections, useSectionCards, useDeckDisplay } from '../../lib/use-deck-sections'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getTotalCards, copyDecklistToClipboard, deriveLockedIds, deriveColorsFromCards } from '../../lib/deck-utils'
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
  // `undefined` = not yet read from storage, `null` = read and there's no such
  // deck. Reading `deckStore.load` in a `useState` initializer would run it
  // during SSR too, where `localStorage` doesn't exist, so the server would
  // always render "not found" while the client's first render (which does
  // have `localStorage`) renders the real deck — a hydration mismatch. Instead
  // both server and client render the `undefined` (loading) branch, and the
  // actual read happens client-only in the effect below.
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined)
  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [pdfGenerating, setPdfGenerating] = useState(false)

  // Client-only load, keyed on `id` so navigating between decks re-reads.
  useEffect(() => {
    const loaded = deckStore.load(id)
    setDeck(loaded)
    setDeckName(loaded?.name ?? '')
    setDeckDescription(loaded?.description ?? '')
  }, [id])

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
      deckStore.save({ ...deck, featuredCardIds: pickFeaturedCardIds(deck.cards, cardDataMap) })
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

  // ─── AI Chat ────────────────────────────────────────────────

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
    () => deriveIntentFilters(intent, fallbackColors),
    [intent, fallbackColors],
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
        budgetMin: intent.budgetMin,
        budgetMax: intent.budgetMax,
      },
    ),
    [intentFilters.colors, intent.archetypes, intent.traits, intent.customStrategy, intent.budgetMin, intent.budgetMax],
  )

  // ─── Per-deck pending slot (persistence) ────────────────────
  // Backs the mid-review transient state (staged re-derive plan + offered
  // combos + re-fill chat) so a reload resumes it. The slot records the
  // committed-intent fingerprint it was derived against; a structural intent
  // change evicts the stale staged layer, on mount and again on any later
  // fingerprint move within the session. Nothing here touches the
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
  // Stable identity for the committed plan: it is the baseline every stale-lane
  // diff is measured against, and a fresh `[]` per render would re-bucket the
  // whole deck on every one.
  const committedPlan = useMemo(() => deck?.sectionPlan ?? [], [deck?.sectionPlan])

  // Which lane has a re-fill in flight. The chat ledger is global, so the lane
  // that asked has to be remembered here — LaneStatus.refilling is per-lane.
  const [refillingLaneId, setRefillingLaneId] = useState<string | null>(null)
  // `refillLane` is declared after the hook (it needs the localized plan the
  // hook feeds), so the hook reaches it through a stable bridge rather than a
  // circular declaration.
  const refillLaneRef = useRef<(laneId: string, count: number) => void>(() => {})
  const bridgeRefillLane = useCallback(
    (laneId: string, count: number) => refillLaneRef.current(laneId, count),
    [],
  )

  // `deck` carries a third, load-pending `undefined` state that these two
  // callers (and their `Deck | null` prop types) predate — narrow it here
  // rather than widen every downstream consumer for a state that's gone by
  // the time a user can interact with them.
  const setDeckOrNull = useCallback(
    (updater: (prev: Deck | null) => Deck | null) => setDeck((prev) => updater(prev ?? null)),
    [],
  )

  const {
    stagedPlan,
    stagedAssignments,
    resumed: stagedPlanResumed,
    stage: stageRederive,
    acceptPlan,
    discardPlan,
    laneStatus,
  } = useStagedRederive({
    displayCards: deckDisplay,
    t,
    setDeck: setDeckOrNull,
    committedPlan,
    initialPlan: deckPending.stagedPlan,
    onStagedChange: setStagedPlan,
    onRefillLane: bridgeRefillLane,
    refillingLaneId,
    cardsReady: !cardsLoading,
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

  // Build section-based card groups
  // While a plan is staged the lanes on screen are the PROPOSAL's, so they are
  // bucketed with the proposal's own assignments — otherwise the header count
  // reads the committed filing while the deficit right below it reads the
  // proposal, and the two disagree (#42). With nothing staged this is the
  // deck's committed filing, unchanged.
  const sectionCards = useSectionCards({
    deckDisplay,
    sections: localizedPlan,
    sectionAssignments: stagedAssignments ?? deck?.sectionAssignments ?? {},
    lockedSource: lockedCardIds,
    fallbackByType: true,
  })

  // ─── Deck surface ───────────────────────────────────────────
  // The one seam the editor and the chat ledger both write through. Every
  // mutator writes functionally and reads `prev`: useStagedRederive is the
  // other writer of sectionPlan / sectionAssignments, so a closure read here
  // could silently undo an accepted plan.

  const surface = useMemo(
    () => deckSurfaceFromSavedDeck({
      deck: deck ?? null,
      setDeck: setDeckOrNull,
      history,
      lockedCardIds,
      sections: localizedPlan,
      sectionCards,
      cardDataMap,
      cardsLoading,
      onCardData: handleCardDataUpdate,
      name: deckName,
      description: deckDescription,
      onNameChange: setDeckName,
      onDescriptionChange: setDeckDescription,
    }),
    [deck, history, lockedCardIds, localizedPlan, sectionCards, cardDataMap, cardsLoading, handleCardDataUpdate, deckName, deckDescription],
  )

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
    onDeckUpdate: surface.applyProposal,
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
    return analyzeDeck(deck.cards, cardDataMap, t)
  }, [deck?.cards, cardDataMap, t])

  // Per-lane re-fill (deck-view re-derive). The intent-driven fill request
  // routes through the EXISTING single chat ledger (decision 7, last-wins) — a
  // targeted "add N more cards to <lane>" message whose preview lands in
  // useDeckChat.pending. `count` is the lane's deficit, already resolved by
  // useStagedRederive; a lane with nothing to fill never gets a button.
  // Gated on !chatIsLoading so it can't fire against a partially-loaded
  // cardDataMap (chatIsLoading folds in cardsLoading — C2 guard).
  const refillLane = useCallback(
    (laneId: string, count: number) => {
      if (chatIsLoading) return
      const section = localizedPlan.find((s) => s.id === laneId)
      if (!section) return
      setRefillingLaneId(laneId)
      sendMessage(
        `Add ${count} more cards to the "${section.label}" section. Keep the existing cards and add cards that fit the section's role: ${section.description || section.label}.`,
        { targetSection: laneId },
      )
    },
    [chatIsLoading, localizedPlan, sendMessage],
  )

  // The hook is created before `refillLane` (it feeds the localized plan that
  // names the lane), so it reaches the current one through a ref rather than
  // forcing a circular declaration.
  refillLaneRef.current = refillLane

  // Clear the per-lane spinner once the chat call it started has landed.
  useEffect(() => {
    if (!chatIsLoading) setRefillingLaneId(null)
  }, [chatIsLoading])

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

  if (deck === undefined) {
    return (
      <Layout>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 border-b border-hairline pb-6">
            <div className="h-8 w-2/3 animate-pulse bg-ash-800" aria-hidden="true" />
            <div className="h-4 w-1/3 animate-pulse bg-ash-800" aria-hidden="true" />
          </div>
          <DeckCardSkeleton />
        </div>
      </Layout>
    )
  }

  if (deck === null) {
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
      <SimulationPanel deckId={id} deckName={surface.name} cards={surface.cards} cardDataMap={cardDataMap} />
      <div className="mt-3 border border-hairline bg-ash-800/40 p-3">
        <p className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">{t('deck.cardList')}</p>
        <DeckCardList
          cards={surface.cards}
          cardData={cardDataMap}
          onUpdateQuantity={surface.changeQuantity}
          onRemoveCard={surface.removeCard}
          onToggleLock={surface.toggleLock}
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
            <input
              type="text"
              value={surface.name}
              onChange={(e) => surface.setName(e.target.value)}
              onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
              className="w-full border-0 border-b border-hairline bg-transparent font-display text-2xl uppercase tracking-display text-cream-100 focus:border-cream-200 focus:outline-none sm:text-display-section"
              placeholder={t('deck.namePlaceholder')}
              aria-label={t('deck.namePlaceholder')}
            />
            <input
              type="text"
              value={surface.description}
              onChange={(e) => surface.setDescription(e.target.value)}
              onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
              className="mt-3 w-full border-0 border-b border-hairline bg-transparent font-body text-sm italic text-cream-400 focus:border-cream-200 focus:outline-none"
              placeholder={t('deck.descriptionPlaceholder')}
              aria-label={t('deck.descriptionPlaceholder')}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <UndoRedoButtons
              show={mainCount > 0}
              canUndo={surface.history.canUndo}
              canRedo={surface.history.canRedo}
              onUndo={() => { surface.history.undo(); sounds.uiClick() }}
              onRedo={() => { surface.history.redo(); sounds.uiClick() }}
              undoLabel={t('action.undo')}
              redoLabel={t('action.redo')}
            />
            <span className="font-mono text-mono-num tabular-nums">
              <span className={mainCount > TARGET_DECK_SIZE ? 'text-ink-red-bright' : 'text-cream-300'}>
                {t('deck.cards', { count: mainCount })}
              </span>
              {mainCount > TARGET_DECK_SIZE && (
                <span className="ml-1 font-mono text-mono-marginal text-ink-red">
                  {t('deck.trimOver', { count: mainCount - TARGET_DECK_SIZE })}
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
          surface={surface}
          analysis={analysis}
          cardListSlot={cardListSlot}
          renderExtraLightboxActions={renderEditLightboxActions}
          resolveLaneStatus={laneStatus}
          // A lane the re-derive flagged is very often the one with no cards,
          // and an unrendered lane can't show a re-fill button. Only while
          // something is staged — otherwise every empty lane renders forever.
          includeEmptySections={stagedPlan != null}
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
