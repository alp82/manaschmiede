import { useState, useCallback, useRef, useMemo } from 'react'
import { getCardByName } from './scryfall/client'
import { cardSupply } from './scryfall/card-supply'
import { useI18n } from './i18n'
import { getCardRejectionReason, type DeckFilters } from './card-validation'
import { validateProposedCards } from './chat-validation'
import type { IntentContext } from '../../convex/lib/intentContext'
import type { ScryfallCard } from './scryfall/types'
import { getCardName } from './scryfall/types'
import { TARGET_DECK_SIZE, type DeckCard } from './deck-utils'
import { BASIC_LAND_IDS, BASIC_LAND_IDS_BY_NAME, BASIC_LAND_ID_SET } from './basic-lands'
import { computeDeckDiff, applyDelta, resolveRemoveIds, enforceDeltaSize } from './deck-diff'
import { buildCardSectionLabels } from './section-assignment'
import { analyzeComposition, summarizeComposition } from './synergy-validation'
import type { CardChange } from './deck-chat-types'
export type { CardChange } from './deck-chat-types'


function getColorIdentity(resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>): string[] {
  const colors = new Set<string>()
  for (const [, { card }] of resolvedMap) {
    if (card.type_line?.includes('Land')) continue
    for (const c of card.color_identity ?? []) {
      colors.add(c)
    }
  }
  return colors.size > 0 ? Array.from(colors) : ['G'] // fallback to green
}

async function fillLands(
  resolvedCards: DeckCard[],
  resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>,
  onCardDataUpdate: (card: ScryfallCard) => void,
  scryfallLang: string,
): Promise<{ cards: DeckCard[]; added: Array<{ name: string; scryfallId: string; quantity: number; scryfallCard?: ScryfallCard }> }> {
  const totalCards = resolvedCards.reduce((s, c) => s + c.quantity, 0)
  if (totalCards >= TARGET_DECK_SIZE) return { cards: resolvedCards, added: [] }

  const deficit = TARGET_DECK_SIZE - totalCards
  const deckColors = getColorIdentity(resolvedMap)
  const landsPerColor = Math.floor(deficit / deckColors.length)
  const remainder = deficit % deckColors.length

  const addedLands: Array<{ name: string; scryfallId: string; quantity: number; scryfallCard?: ScryfallCard }> = []
  const updatedCards = [...resolvedCards]

  const wanted: Array<{ color: string; landId: string; qty: number }> = []
  for (let i = 0; i < deckColors.length; i++) {
    const color = deckColors[i]
    const landId = BASIC_LAND_IDS[color]
    if (!landId) continue

    const qty = landsPerColor + (i < remainder ? 1 : 0)
    if (qty <= 0) continue

    wanted.push({ color, landId, qty })

    // Check if this land is already in the deck
    const existingIdx = updatedCards.findIndex((c) => c.scryfallId === landId)
    if (existingIdx >= 0) {
      updatedCards[existingIdx] = {
        ...updatedCards[existingIdx],
        quantity: updatedCards[existingIdx].quantity + qty,
      }
    } else {
      updatedCards.push({ scryfallId: landId, quantity: qty, zone: 'main' })
    }
  }

  // Resolve every basic in one batch, by ID (not by name) to avoid promo
  // printings. A lookup failure costs the ledger a card name, not the lands.
  const landData = await cardSupply
    .cardsById(wanted.map((w) => w.landId), scryfallLang)
    .catch(() => new Map<string, ScryfallCard>())

  for (const { color, landId, qty } of wanted) {
    const landCard = landData.get(landId)
    if (landCard) {
      onCardDataUpdate(landCard)
      addedLands.push({
        name: getCardName(landCard),
        scryfallId: landCard.id,
        quantity: qty,
        scryfallCard: landCard,
      })
    } else {
      addedLands.push({ name: color + ' Land', scryfallId: landId, quantity: qty })
    }
  }

  return { cards: updatedCards, added: addedLands }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  changes?: CardChange[]
  changesApplied?: boolean
}

export interface PendingChanges {
  deckName: string
  description: string
  explanation?: string
  changes: CardChange[]
  resolvedCards: DeckCard[]
  /** When set, newly added cards should be assigned to this section. */
  targetSection?: string
}

interface UseDeckChatOptions {
  cards: DeckCard[]
  cardDataMap: Map<string, ScryfallCard>
  deckDescription: string
  /**
   * Commit a proposed deck. Takes the whole staged proposal: `changes` lets a
   * caller inherit sections per card (swaps inherit the removed card's
   * section), and `targetSection` carries the lane a re-fill or top-up asked
   * for, which the section assignment must honour (issue #17).
   */
  onDeckUpdate: (proposal: PendingChanges) => void
  onCardDataUpdate: (card: ScryfallCard) => void
  lockedCardIds?: Set<string>
  sectionAssignments?: Record<string, string[]>
  sectionLabels?: Record<string, string>
  initialMessages?: ChatMessage[]
  onMessagesChange?: (messages: ChatMessage[]) => void
  /**
   * Resolved color/budget/rarity filters the client-side gate enforces on suggestions.
   * When omitted, the client color/budget/rarity gate does NOT run (the hard backstop
   * is disabled). Both current callers pass it; a future caller omitting it loses
   * enforcement silently.
   */
  intentFilters?: DeckFilters
  /** Flat intent context sent to the AI so it suggests on-intent cards from the start. */
  intentContext?: IntentContext
}

export function useDeckChat({ cards, cardDataMap, deckDescription, onDeckUpdate, onCardDataUpdate, lockedCardIds, sectionAssignments, sectionLabels, initialMessages, onMessagesChange, intentFilters, intentContext }: UseDeckChatOptions) {
  const { scryfallLang } = useI18n()
  const [messages, setMessagesInternal] = useState<ChatMessage[]>(initialMessages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [pending, setPending] = useState<PendingChanges | null>(null)
  const abortRef = useRef(false)

  // Refs for values read inside the async sendMessage flow. Using refs over
  // useCallback deps means we always see the latest deck state even if React
  // re-renders during the Convex + Scryfall round-trip, and it keeps
  // sendMessage stable across typing in the chat input.
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const cardDataMapRef = useRef(cardDataMap)
  cardDataMapRef.current = cardDataMap
  const deckDescriptionRef = useRef(deckDescription)
  deckDescriptionRef.current = deckDescription
  const sectionAssignmentsRef = useRef(sectionAssignments)
  sectionAssignmentsRef.current = sectionAssignments
  const sectionLabelsRef = useRef(sectionLabels)
  sectionLabelsRef.current = sectionLabels
  const lockedCardIdsRef = useRef(lockedCardIds)
  lockedCardIdsRef.current = lockedCardIds
  const intentFiltersRef = useRef(intentFilters)
  intentFiltersRef.current = intentFilters
  const intentContextRef = useRef(intentContext)
  intentContextRef.current = intentContext
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Wrap setMessages to also notify parent
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesInternal((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      onMessagesChange?.(next)
      return next
    })
  }, [onMessagesChange])

  const pendingTargetSection = useRef<string | undefined>()

  const sendMessage = useCallback(
    async (text: string, options?: { targetSection?: string }) => {
      pendingTargetSection.current = options?.targetSection
      abortRef.current = false
      setPending(null)

      // Snapshot the latest prop values for this single send operation. Refs
      // protect against stale closures when re-renders happen during awaits.
      const cards = cardsRef.current
      const cardDataMap = cardDataMapRef.current
      const deckDescription = deckDescriptionRef.current
      const sectionAssignments = sectionAssignmentsRef.current
      const sectionLabels = sectionLabelsRef.current
      const lockedCardIds = lockedCardIdsRef.current
      const intentFilters = intentFiltersRef.current
      const intentContext = intentContextRef.current

      const userMsg: ChatMessage = { role: 'user', content: text }
      const newMessages = [...messagesRef.current, userMsg]
      setMessages(newMessages)
      setIsLoading(true)

      try {
        // Build reverse lookup: scryfallId -> section label. Labels are
        // optional — a caller with assignments but no plan in scope still
        // labels each card by its section id slug, which the model can read.
        const cardSectionLabel = buildCardSectionLabels(sectionAssignments, sectionLabels)

        const currentCards = cards
          .filter((c) => c.zone === 'main')
          .map((c) => {
            const data = cardDataMap.get(c.scryfallId)
            const name = data ? data.name : c.scryfallId
            const section = cardSectionLabel.get(c.scryfallId)
            return { name, quantity: c.quantity, section }
          })

        const apiMessages = newMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        const { ConvexHttpClient } = await import('convex/browser')
        const { api } = await import('../../convex/_generated/api')
        const convexUrl = import.meta.env.VITE_CONVEX_URL as string
        const client = new ConvexHttpClient(convexUrl)

        // Build the locked-cards list for the AI straight from the locked-id
        // set intersected with the deck, keyed on each card's English Oracle
        // name (card.name, NOT the localized/printed name). Robust to
        // multi-printing, split, alt-art, and localized cards - the AI only
        // ever sees the canonical name the prompt instructs it to use.
        const lockedCards = lockedCardIds && lockedCardIds.size > 0
          ? cards
              .filter((dc) => dc.zone === 'main' && lockedCardIds.has(dc.scryfallId))
              .map((dc) => {
                const data = cardDataMap.get(dc.scryfallId)
                return data ? { name: data.name, quantity: dc.quantity } : null
              })
              .filter((c): c is { name: string; quantity: number } => c !== null)
          : undefined

        // Snapshot the current deck composition so the AI sees what's in the deck
        // (and the validator has something to check against on rejection retry).
        const currentEntries: Array<{ card: ScryfallCard; quantity: number }> = []
        for (const dc of cards.filter((c) => c.zone === 'main')) {
          const data = cardDataMap.get(dc.scryfallId)
          if (data) currentEntries.push({ card: data, quantity: dc.quantity })
        }
        const currentComposition = analyzeComposition(currentEntries)
        const currentCompositionSummary = summarizeComposition(currentComposition)

        type GeneratedDeckShape = {
          name: string
          description: string
          explanation?: string
          cards: Array<{ name: string; quantity: number }>
        }
        type ResolveOutcome =
          | { intent: 'question'; answer: string }
          | {
              intent: 'change'
              deckResult: GeneratedDeckShape
              resolvedCards: DeckCard[]
              resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>
              batchCardData: ScryfallCard[]
            }
          | {
              intent: 'delta'
              explanation: string
              resolvedCards: DeckCard[]
              resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>
              batchCardData: ScryfallCard[]
            }

        const callAndResolve = async (
          rejectedCards?: Array<{ name: string; reason: string }>,
        ): Promise<ResolveOutcome> => {
          const result = await client.action(api.generateDeck.chat, {
            messages: apiMessages,
            currentCards: currentCards.length > 0 ? currentCards : undefined,
            deckDescription: deckDescription || undefined,
            deckComposition: currentCompositionSummary || undefined,
            rejectedCards: rejectedCards && rejectedCards.length > 0 ? rejectedCards : undefined,
            lockedCards,
            colors: intentContext?.colors,
            archetypes: intentContext?.archetypes,
            traits: intentContext?.traits,
            customStrategy: intentContext?.customStrategy,
            budgetMin: intentContext?.budgetMin ?? undefined,
            budgetMax: intentContext?.budgetMax ?? undefined,
          })

          if (result.intent === 'question' && result.answer) {
            return { intent: 'question', answer: result.answer }
          }

          // Delta: a small targeted edit. Resolve add[] to Scryfall data,
          // map remove[] to deck ids by English identity (locked-skipped),
          // apply the delta, and force exactly 60 - all on the current deck.
          if (result.intent === 'delta' && result.delta) {
            const delta = result.delta
            const mainCards = cards.filter((c) => c.zone === 'main')
            const batchCardData: ScryfallCard[] = []

            const addCards: Array<{ scryfallId: string; card: ScryfallCard; quantity: number; isBasicLand: boolean }> = []
            // Canonical basic-land IDs avoid printing mismatches in the diff.
            // Resolve them all up front so the loop below never awaits a card
            // lookup one at a time.
            const deltaLands = await cardSupply
              .cardsById(
                delta.add.map((entry) => BASIC_LAND_IDS_BY_NAME[entry.name]),
                scryfallLang,
              )
              .catch(() => new Map<string, ScryfallCard>())
            for (const entry of delta.add) {
              const canonicalId = BASIC_LAND_IDS_BY_NAME[entry.name]
              if (canonicalId) {
                const landCard = deltaLands.get(canonicalId)
                if (landCard) {
                  batchCardData.push(landCard)
                  addCards.push({ scryfallId: canonicalId, card: landCard, quantity: entry.quantity, isBasicLand: true })
                }
                continue
              }
              try {
                const scryfallCard = await getCardByName(entry.name, scryfallLang)
                if (getCardRejectionReason(scryfallCard)) continue
                batchCardData.push(scryfallCard)
                addCards.push({
                  scryfallId: scryfallCard.id,
                  card: scryfallCard,
                  quantity: entry.quantity,
                  isBasicLand: BASIC_LAND_ID_SET.has(scryfallCard.id),
                })
              } catch {
                // Skip unresolvable cards.
              }
            }

            // Hard backstop: resolveRemoveIds drops any locked id, so applyDelta
            // never evicts a pinned card.
            const removeIds = resolveRemoveIds(
              delta.remove,
              mainCards,
              cardDataMap,
              lockedCardIds ?? new Set<string>(),
            )

            const applied = applyDelta(mainCards, removeIds, addCards, cardDataMap)
            const colors = getColorIdentity(applied.resolvedMap)
            const sizedCards = enforceDeltaSize(applied.resolvedCards, colors)

            // Rebuild the resolved map against the post-enforcement list so any
            // padded basic land (or trimmed copy) is reflected for validation
            // and the diff.
            const resolvedMap = new Map<string, { card: ScryfallCard; quantity: number }>()
            // Cards the user already had are guaranteed to be in cardDataMap
            // (the send is gated behind cardsLoading). Use the cached entry
            // before fetching so padded/trimmed basics always appear in the
            // ledger even when the localized fetch fails. Whatever is left
            // after that goes out as one batch, not one await per card.
            const unresolved = sizedCards
              .filter(
                (rc) =>
                  !applied.resolvedMap.has(rc.scryfallId) && !cardDataMap.has(rc.scryfallId),
              )
              .map((rc) => rc.scryfallId)
            const fetched = await cardSupply
              .cardsById(unresolved, scryfallLang)
              .catch(() => new Map<string, ScryfallCard>())

            for (const rc of sizedCards) {
              const prior = applied.resolvedMap.get(rc.scryfallId)
              if (prior) {
                resolvedMap.set(rc.scryfallId, { card: prior.card, quantity: rc.quantity })
                continue
              }
              const cached = cardDataMap.get(rc.scryfallId)
              if (cached) {
                resolvedMap.set(rc.scryfallId, { card: cached, quantity: rc.quantity })
                continue
              }
              const landCard = fetched.get(rc.scryfallId)
              if (landCard) {
                batchCardData.push(landCard)
                resolvedMap.set(rc.scryfallId, { card: landCard, quantity: rc.quantity })
              }
            }

            return {
              intent: 'delta',
              explanation: delta.explanation,
              resolvedCards: sizedCards,
              resolvedMap,
              batchCardData,
            }
          }

          const deckResult = result.deck
          if (!deckResult) throw new Error('No deck data in response')

          const resolvedCards: DeckCard[] = []
          const resolvedMap = new Map<string, { card: ScryfallCard; quantity: number }>()
          const batchCardData: ScryfallCard[] = []

          // Use canonical IDs for basic lands to avoid printing mismatches in
          // diff. A full deck answer can name every basic, so resolve them in
          // one batch before walking the list.
          const deckLands = await cardSupply
            .cardsById(
              deckResult.cards.map((card) => BASIC_LAND_IDS_BY_NAME[card.name]),
              scryfallLang,
            )
            .catch(() => new Map<string, ScryfallCard>())

          for (const card of deckResult.cards) {
            const canonicalId = BASIC_LAND_IDS_BY_NAME[card.name]
            if (canonicalId) {
              const existing = resolvedMap.get(canonicalId)
              if (existing) {
                existing.quantity += card.quantity
                const rc = resolvedCards.find((c) => c.scryfallId === canonicalId)
                if (rc) rc.quantity += card.quantity
              } else {
                resolvedCards.push({ scryfallId: canonicalId, quantity: card.quantity, zone: 'main' })
                const landCard = deckLands.get(canonicalId)
                if (landCard) {
                  batchCardData.push(landCard)
                  resolvedMap.set(canonicalId, { card: landCard, quantity: card.quantity })
                }
              }
              continue
            }

            try {
              const scryfallCard = await getCardByName(card.name, scryfallLang)
              // Hard filter: skip stickers, Un-sets, oversized, digital-only, etc.
              // The AI shouldn't suggest these, but Scryfall-by-name can still
              // resolve them so we enforce it here as a safety net.
              if (getCardRejectionReason(scryfallCard)) continue
              batchCardData.push(scryfallCard)
              const isLocked = lockedCardIds?.has(scryfallCard.id) ?? false
              resolvedCards.push({
                scryfallId: scryfallCard.id,
                quantity: card.quantity,
                zone: 'main',
                locked: isLocked || undefined,
              })
              resolvedMap.set(scryfallCard.id, { card: scryfallCard, quantity: card.quantity })
            } catch {
              // Skip unresolvable cards
            }
          }

          return {
            intent: 'change',
            deckResult,
            resolvedCards,
            resolvedMap,
            batchCardData,
          }
        }

        // First attempt
        let outcome = await callAndResolve()

        if (abortRef.current) return

        // Question intent: show answer as message, no deck changes
        if (outcome.intent === 'question') {
          const answerMsg: ChatMessage = { role: 'assistant', content: outcome.answer }
          setMessages((prev) => [...prev, answerMsg])
          setIsLoading(false)
          return
        }

        // Both change and delta resolve to a card map that the intent/synergy
        // gate vets; on rejection we re-prompt once with the same machinery.
        // Delta judges only the cards it added (the rest of the deck is the
        // user's existing, deliberate choices).
        if (outcome.intent === 'change' || outcome.intent === 'delta') {
          const judgeIds =
            outcome.intent === 'delta'
              ? new Set(
                  computeDeckDiff(cards, outcome.resolvedMap, cardDataMap)
                    .filter((c) => c.type === 'added' || c.type === 'changed')
                    .map((c) => c.scryfallId),
                )
              : undefined
          const rejected = validateProposedCards({
            resolvedMap: outcome.resolvedMap,
            intentFilters,
            lockedCardIds,
            judgeIds,
          })
          if (rejected.length > 0) {
            const retry = await callAndResolve(rejected)
            if (abortRef.current) return
            if (retry.intent === outcome.intent) {
              outcome = retry
            }
          }
        }

        // Delta: diff the (already exactly-60) resolved deck against the
        // current deck and stage it. computeDeckDiff surfaces every add, cut,
        // and quantity change - including whatever enforceDeltaSize trimmed or
        // padded - as ledger rows. The op shown in the header is derived
        // downstream from which change types are present.
        if (outcome.intent === 'delta') {
          for (const card of outcome.batchCardData) onCardDataUpdate(card)
          if (abortRef.current) return

          const changes = computeDeckDiff(cards, outcome.resolvedMap, cardDataMap)

          // A delta leaves deck name/description untouched; empty strings are
          // falsy so applyChanges preserves the existing values.
          setPending({
            deckName: '',
            description: '',
            explanation: outcome.explanation,
            changes,
            resolvedCards: outcome.resolvedCards,
            targetSection: pendingTargetSection.current,
          })
          pendingTargetSection.current = undefined
          setIsLoading(false)
          return
        }

        // After possible retry, outcome must be 'change' to continue.
        if (outcome.intent !== 'change') {
          // Defensive: classifier flipped between attempts. Fall back to a
          // text answer instead of pretending we got a deck.
          throw new Error('Chat returned an answer instead of a deck')
        }

        const deckResult = outcome.deckResult
        const resolvedCards = outcome.resolvedCards
        const resolvedMap = outcome.resolvedMap
        const batchCardData = outcome.batchCardData

        // Batch-update card data in one render pass
        for (const card of batchCardData) onCardDataUpdate(card)

        if (abortRef.current) return

        // Trim if over 60 (safety net after resolution)
        let resolvedTotal = resolvedCards.reduce((s, c) => s + c.quantity, 0)
        if (resolvedTotal > TARGET_DECK_SIZE) {
          // Reduce non-locked, non-land cards from the end
          for (let i = resolvedCards.length - 1; i >= 0 && resolvedTotal > TARGET_DECK_SIZE; i--) {
            const rc = resolvedCards[i]
            if (lockedCardIds?.has(rc.scryfallId)) continue
            const data = resolvedMap.get(rc.scryfallId)
            const isLand = data?.card.type_line?.includes('Land')
            if (isLand) continue
            const reduce = Math.min(rc.quantity - 1, resolvedTotal - TARGET_DECK_SIZE)
            if (reduce > 0) {
              rc.quantity -= reduce
              resolvedTotal -= reduce
              const mapEntry = resolvedMap.get(rc.scryfallId)
              if (mapEntry) mapEntry.quantity = rc.quantity
            }
          }
          // Remove zero-quantity
          const filtered = resolvedCards.filter((c) => c.quantity > 0)
          resolvedCards.length = 0
          resolvedCards.push(...filtered)
        }

        // Auto-fill basic lands if deck is under 60 cards
        const { cards: filledCards, added: addedLands } = await fillLands(
          resolvedCards,
          resolvedMap,
          onCardDataUpdate,
          scryfallLang,
        )

        // Update resolvedMap with any added lands
        for (const land of addedLands) {
          const existing = resolvedMap.get(land.scryfallId)
          if (existing) {
            resolvedMap.set(land.scryfallId, {
              card: existing.card,
              quantity: existing.quantity + land.quantity,
            })
          } else if (land.scryfallCard) {
            resolvedMap.set(land.scryfallId, {
              card: land.scryfallCard,
              quantity: land.quantity,
            })
          }
        }

        // Diff current vs proposed. Lands added by fillLands are already in
        // resolvedMap, so they show up in the diff like any other change.
        const actualChanges = computeDeckDiff(cards, resolvedMap, cardDataMap)

        // targetSection rides this path too, and must: the classifier reads a
        // lane re-fill ("add N more cards to <lane>", naming no card) as a
        // 'change', so gating it to the delta path would leave the re-fill it
        // exists to serve routing by role. The prompt tells the model to keep
        // the existing cards, so the diff is normally the handful of adds the
        // lane asked for. A model that rebuilds instead funnels every add into
        // that one lane - visible as a full ledger the user discards.
        setPending({
          deckName: deckResult.name,
          description: deckResult.description,
          explanation: deckResult.explanation,
          changes: actualChanges,
          resolvedCards: filledCards,
          targetSection: pendingTargetSection.current,
        })
        pendingTargetSection.current = undefined
      } catch (err) {
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        }
        setMessages((prev) => [...prev, errorMsg])
      } finally {
        setIsLoading(false)
      }
    },
    // Everything volatile is read via refs; only stable callbacks need to
    // live in deps here.
    [setMessages, onCardDataUpdate, scryfallLang],
  )

  // Stage a pre-resolved proposal directly into the single ledger (last-wins,
  // decision 7). Used by non-chat add paths — e.g. the saved-deck reopen-combo
  // picker, which resolves its own additive CardChange[] and the merged 60-card
  // deck, then routes through the same pending → Apply/Discard UI as chat/re-fill.
  // No network: the caller owns resolution.
  const stageChanges = useCallback((proposal: PendingChanges) => {
    abortRef.current = true
    setIsLoading(false)
    pendingTargetSection.current = undefined
    setPending(proposal)
  }, [])

  const applyChanges = useCallback(() => {
    if (!pending) return
    onDeckUpdate(pending)
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: pending.explanation ?? `${pending.deckName}: ${pending.description}`,
      changes: pending.changes,
      changesApplied: true,
    }
    setMessages((prev) => [...prev, assistantMsg])
    setPending(null)
  }, [pending, onDeckUpdate])

  const discardChanges = useCallback(() => {
    if (!pending) return
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: `Suggestion discarded. What would you like to change instead?`,
      changes: pending.changes,
      changesApplied: false,
    }
    setMessages((prev) => [...prev, assistantMsg])
    setPending(null)
  }, [pending])

  const reset = useCallback(() => {
    abortRef.current = true
    setMessages([])
    setPending(null)
    setIsLoading(false)
  }, [])

  // Track card IDs added in the most recently applied change set
  const newCardIds = useMemo(() => {
    // Find the last applied change message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.changes && msg.changesApplied) {
        return new Set(
          msg.changes
            .filter((c) => c.type === 'added')
            .map((c) => c.scryfallId),
        )
      }
    }
    return new Set<string>()
  }, [messages])

  return { messages, isLoading, pending, newCardIds, sendMessage, stageChanges, applyChanges, discardChanges, reset }
}
