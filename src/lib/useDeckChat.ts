import { useState, useCallback, useRef, useMemo } from 'react'
import { getCardByName } from './scryfall/client'
import { cardSupply } from './scryfall/card-supply'
import { useI18n } from './i18n'
import { getCardRejectionReason, type DeckFilters } from './card-validation'
import { validateProposedCards } from './chat-validation'
import type { IntentContext } from '../../convex/lib/intentContext'
import type { ScryfallCard } from './scryfall/types'
import type { DeckCard } from './deck-utils'
import { BASIC_LAND_ID_BY_NAME, isBasicLandId } from '../../convex/lib/basicLands'
import {
  computeDeckDiff,
  applyDelta,
  resolveRemoveIds,
  enforceDeckCards,
  enforceDeltaSize,
} from './deck-diff'
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

/**
 * Rebuild the resolved map against a post-enforcement card list, so every trim
 * and every padded basic land reaches the ledger.
 *
 * Card data comes from the prior map first, then the deck's cached data, then
 * one batched lookup by canonical id - cards the user already had are
 * guaranteed to be cached (the send is gated behind `cardsLoading`), so a
 * failed localized fetch costs the ledger a row, not the cards.
 *
 * Returns the map plus `fetched`, the cards resolved here for the first time,
 * which the caller still has to push into the render batch.
 */
async function resolveMapForCards(
  cards: DeckCard[],
  prior: Map<string, { card: ScryfallCard; quantity: number }>,
  cardDataMap: Map<string, ScryfallCard>,
  scryfallLang: string,
): Promise<{
  resolved: Map<string, { card: ScryfallCard; quantity: number }>
  fetched: ScryfallCard[]
}> {
  const isKnown = (id: string) => prior.has(id) || cardDataMap.has(id)

  const fetched = await cardSupply
    .cardsById(
      cards.filter((c) => !isKnown(c.scryfallId)).map((c) => c.scryfallId),
      scryfallLang,
    )
    .catch(() => new Map<string, ScryfallCard>())

  const resolved = new Map<string, { card: ScryfallCard; quantity: number }>()
  const firstSeen: ScryfallCard[] = []
  for (const c of cards) {
    const known = isKnown(c.scryfallId)
    const card =
      prior.get(c.scryfallId)?.card ??
      cardDataMap.get(c.scryfallId) ??
      fetched.get(c.scryfallId)
    if (!card) continue
    if (!known) firstSeen.push(card)
    resolved.set(c.scryfallId, { card, quantity: c.quantity })
  }
  return { resolved, fetched: firstSeen }
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
              intent: 'rebuild'
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
                delta.add.map((entry) => BASIC_LAND_ID_BY_NAME[entry.name]),
                scryfallLang,
              )
              .catch(() => new Map<string, ScryfallCard>())
            for (const entry of delta.add) {
              const canonicalId = BASIC_LAND_ID_BY_NAME[entry.name]
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
                  isBasicLand: isBasicLandId(scryfallCard.id),
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
            const sized = await resolveMapForCards(
              sizedCards,
              applied.resolvedMap,
              cardDataMap,
              scryfallLang,
            )
            const resolvedMap = sized.resolved
            batchCardData.push(...sized.fetched)

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
              deckResult.cards.map((card) => BASIC_LAND_ID_BY_NAME[card.name]),
              scryfallLang,
            )
            .catch(() => new Map<string, ScryfallCard>())

          for (const card of deckResult.cards) {
            const canonicalId = BASIC_LAND_ID_BY_NAME[card.name]
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
            intent: 'rebuild',
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

        // Both rebuild and delta resolve to a card map that the intent/synergy
        // gate vets; on rejection we re-prompt once with the same machinery.
        // Delta judges only the cards it added (the rest of the deck is the
        // user's existing, deliberate choices).
        if (outcome.intent === 'rebuild' || outcome.intent === 'delta') {
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

        // After possible retry, outcome must be 'rebuild' to continue.
        if (outcome.intent !== 'rebuild') {
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

        // Force exactly 60 (safety net after resolution): trim whatever the
        // model overshot, then pad with basic lands on the deck's colors. Both
        // halves live in convex/lib/deckRules.ts under the 'rebuild' policy, so
        // a chat rebuild and a server generate shape a deck the same way.
        const sizedCards = enforceDeckCards(resolvedCards, {
          trimPolicy: 'rebuild',
          colors: getColorIdentity(resolvedMap),
          lockedIds: lockedCardIds,
          isLand: (id) => resolvedMap.get(id)?.card.type_line?.includes('Land') ?? false,
        })

        const sized = await resolveMapForCards(
          sizedCards,
          resolvedMap,
          cardDataMap,
          scryfallLang,
        )
        const sizedMap = sized.resolved
        for (const card of sized.fetched) onCardDataUpdate(card)

        if (abortRef.current) return

        // Diff current vs proposed. Lands the enforcer padded with are already
        // in sizedMap, so they show up in the diff like any other change.
        const actualChanges = computeDeckDiff(cards, sizedMap, cardDataMap)

        // targetSection rides this path too, and must: the classifier reads a
        // lane re-fill ("add N more cards to <lane>", naming no card) as a
        // 'rebuild', so gating it to the delta path would leave the re-fill it
        // exists to serve routing by role. The prompt tells the model to keep
        // the existing cards, so the diff is normally the handful of adds the
        // lane asked for. A model that rebuilds instead funnels every add into
        // that one lane - visible as a full ledger the user discards.
        setPending({
          deckName: deckResult.name,
          description: deckResult.description,
          explanation: deckResult.explanation,
          changes: actualChanges,
          resolvedCards: sizedCards,
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
