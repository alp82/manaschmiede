import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Layout } from '../../components/Layout'
import { CardLightbox } from '../../components/CardLightbox'
import { DeckCardList } from '../../components/DeckCardList'
import { SimulationPanel } from '../../components/SimulationPanel'
import { DeckEditor } from '../../components/deck/DeckEditor'
import { DeckIntentPanel } from '../../components/deck/DeckIntentPanel'
import { SectionLane } from '../../components/deck/SectionLane'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { UndoRedoButtons } from '../../components/ui/UndoRedoButtons'
import { DeckCardSkeleton } from '../../components/ui/DeckCardSkeleton'
import { useToast } from '../../components/ui/Toast'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import { loadDeck, persistDeck, pickFeaturedCardIds, type LocalDeck } from '../../lib/deck-storage'
import { emptyIntent, deriveIntentFilters, buildChatIntentContext, type DeckIntent } from '../../lib/deck-intent'
import { pickSectionForCard } from '../../lib/section-plan'
import { BASIC_LAND_ID_SET } from '../../lib/basic-lands'
import { useDeckCardData } from '../../lib/use-deck-card-data'
import { useDeckHistory } from '../../lib/use-deck-history'
import { useSections, useSectionCards, buildLaneDescriptors, useDeckDisplay } from '../../lib/use-deck-sections'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../../lib/deck-utils'
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
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
    intentFilters,
    intentContext,
  })

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

  const deckDisplay = useDeckDisplay(deck?.cards ?? [], cardDataMap)

  const allScryfallCards = useMemo(() => deckDisplay.map((d) => d.card), [deckDisplay])

  // Localized section plan (re-localized against the active locale; persisted
  // plans freeze their labels at creation time).
  const localizedPlan = useSections({ sectionPlan: deck?.sectionPlan ?? [], t })

  // Build section-based card groups
  const sectionCards = useSectionCards({
    deckDisplay,
    sections: localizedPlan,
    sectionAssignments: deck?.sectionAssignments ?? {},
    lockedSource: lockedCardIds,
    fallbackByType: true,
  })

  // Build the ordered lane list for view mode: core first, then plan sections
  // (or type-fallback labels when the plan is empty), then leftover, then lands.
  const lanes = useMemo(
    () => buildLaneDescriptors(localizedPlan, sectionCards, t, { fallbackByType: true }),
    [localizedPlan, sectionCards, t],
  )

  const openLightbox = useCallback((card: ScryfallCard) => {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) { setLightboxIndex(idx); sounds.cardOpen() }
  }, [allScryfallCards, sounds])

  // "Forge with this card" - opens a fresh wizard seeded by this card. Used by
  // both the view-mode lightbox and the edit-mode (DeckEditor) lightbox.
  const forgeWithCard = useCallback((card: ScryfallCard) => {
    sounds.uiClick()
    navigate({ to: '/deck/new', search: { seed: card.id } })
  }, [navigate, sounds])

  const renderViewLightboxActions = useCallback(
    (card: ScryfallCard) => (
      <Button variant="primary" size="md" className="w-full" onClick={() => forgeWithCard(card)}>
        {t('wizard.forgeWithCard')}
      </Button>
    ),
    [forgeWithCard, t],
  )

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

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        {/* ─── HEADER ────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-ink-red-bright">
              {FORMAT_LABELS[deck.format]}
            </span>
            {editing ? (
              <>
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
              </>
            ) : (
              <>
                <h1 className="mt-2 font-display text-2xl uppercase leading-tight tracking-display text-cream-100 sm:text-display-section">
                  {deckName}
                </h1>
                {deckDescription && (
                  <p className="mt-2 font-body text-sm italic text-cream-400">{deckDescription}</p>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {editing && (
              <UndoRedoButtons
                show={mainCount > 0}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={() => { history.undo(); sounds.uiClick() }}
                onRedo={() => { history.redo(); sounds.uiClick() }}
                undoLabel={t('action.undo')}
                redoLabel={t('action.redo')}
              />
            )}
            <span className="font-mono text-mono-num tabular-nums text-cream-300">
              {t('deck.cards', { count: mainCount })}
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
            <Button
              variant={editing ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setEditing(!editing)}
            >
              {editing ? t('deck.doneEditing') : t('deck.editMode')}
            </Button>
          </div>
        </header>

        {editing ? (
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
            chat={{
              messages,
              pending,
              isLoading: chatLoading,
              newCardIds,
              sendMessage,
              onApply: applyChanges,
              onDiscard: discardChanges,
            }}
          />
        ) : (
          /* ========== VIEW MODE - reading-mode airy ========== */
          <div className="mx-auto w-full max-w-4xl space-y-12 pt-6">
            <DeckIntentPanel
              intent={intent}
              format={deck.format}
              onChange={updateIntent}
              seedColors={fallbackColors}
              hasStoredIntent={hasStoredIntent}
            />
            {lanes.length > 0 ? (
              <div className="space-y-10">
                {lanes.map((lane) => (
                  <SectionLane
                    key={lane.id}
                    section={lane}
                    items={sectionCards[lane.id] ?? []}
                    newCardIds={newCardIds}
                    editing={false}
                    onOpenLightbox={openLightbox}
                    onToggleLock={toggleLock}
                    onChangeQuantity={changeQuantityMain}
                    onRemoveCard={removeCardMain}
                  />
                ))}
              </div>
            ) : deck.cards.length === 0 ? (
              <EmptyState
                title={t('deck.emptyDeck')}
                description={t('deck.emptyDeckSub')}
                className="min-h-[200px] py-16"
              />
            ) : cardsLoading || deckDisplay.length === 0 ? (
              <DeckCardSkeleton />
            ) : null}
          </div>
        )}
      </div>

      {/* View-mode lightbox (edit mode owns its own inside DeckEditor) */}
      {!editing && lightboxIndex !== null && allScryfallCards.length > 0 && (
        <CardLightbox
          cards={allScryfallCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          renderActions={renderViewLightboxActions}
        />
      )}
    </Layout>
  )
}
