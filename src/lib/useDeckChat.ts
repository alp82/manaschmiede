import { useState, useCallback, useRef, useMemo } from 'react'
import { getCardByName } from './scryfall/client'
import { getCardRejectionReason } from './card-validation'
import type { ScryfallCard } from './scryfall/types'
import { getCardName } from './scryfall/types'
import type { DeckCard } from './deck-utils'
import { BASIC_LAND_IDS, BASIC_LAND_NAMES } from './basic-lands'
import {
  analyzeComposition,
  findSynergyIssue,
  summarizeComposition,
} from './synergy-validation'

const TARGET_DECK_SIZE = 60

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
): Promise<{ cards: DeckCard[]; added: Array<{ name: string; scryfallId: string; quantity: number; scryfallCard?: ScryfallCard }> }> {
  const totalCards = resolvedCards.reduce((s, c) => s + c.quantity, 0)
  if (totalCards >= TARGET_DECK_SIZE) return { cards: resolvedCards, added: [] }

  const deficit = TARGET_DECK_SIZE - totalCards
  const deckColors = getColorIdentity(resolvedMap)
  const landsPerColor = Math.floor(deficit / deckColors.length)
  const remainder = deficit % deckColors.length

  const addedLands: Array<{ name: string; scryfallId: string; quantity: number; scryfallCard?: ScryfallCard }> = []
  const updatedCards = [...resolvedCards]

  for (let i = 0; i < deckColors.length; i++) {
    const color = deckColors[i]
    const landId = BASIC_LAND_IDS[color]
    if (!landId) continue

    const qty = landsPerColor + (i < remainder ? 1 : 0)
    if (qty <= 0) continue

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

    // Resolve the land card data
    try {
      // Fetch card data directly by ID (not by name) to avoid promo printings
      const landCard = await fetch(`https://api.scryfall.com/cards/${landId}`, {
        headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
      }).then((r) => r.json()) as ScryfallCard
      onCardDataUpdate(landCard)
      addedLands.push({
        name: getCardName(landCard),
        scryfallId: landCard.id,
        quantity: qty,
        scryfallCard: landCard,
      })
    } catch {
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

export interface CardChange {
  name: string
  scryfallId: string
  scryfallCard?: ScryfallCard
  type: 'added' | 'removed' | 'changed'
  oldQuantity: number
  newQuantity: number
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
  onDeckUpdate: (cards: DeckCard[], name?: string, description?: string) => void
  onCardDataUpdate: (card: ScryfallCard) => void
  lockedCardIds?: Set<string>
  sectionAssignments?: Record<string, string[]>
  sectionLabels?: Record<string, string>
  initialMessages?: ChatMessage[]
  onMessagesChange?: (messages: ChatMessage[]) => void
}

export function useDeckChat({ cards, cardDataMap, deckDescription, onDeckUpdate, onCardDataUpdate, lockedCardIds, sectionAssignments, sectionLabels, initialMessages, onMessagesChange }: UseDeckChatOptions) {
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

      const userMsg: ChatMessage = { role: 'user', content: text }
      const newMessages = [...messagesRef.current, userMsg]
      setMessages(newMessages)
      setIsLoading(true)

      try {
        // Build reverse lookup: scryfallId → section label
        const cardSectionLabel = new Map<string, string>()
        if (sectionAssignments && sectionLabels) {
          for (const [sectionId, ids] of Object.entries(sectionAssignments)) {
            const label = sectionLabels[sectionId] ?? sectionId
            for (const id of ids) cardSectionLabel.set(id, label)
          }
        }

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

        // Build locked cards list for AI
        const lockedCards = lockedCardIds && lockedCardIds.size > 0
          ? currentCards.filter((c) => {
              const dc = cards.find((dc) => {
                const data = cardDataMap.get(dc.scryfallId)
                return data && data.name === c.name
              })
              return dc && lockedCardIds.has(dc.scryfallId)
            })
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
          })

          if (result.intent === 'question' && result.answer) {
            return { intent: 'question', answer: result.answer }
          }

          const deckResult = result.deck
          if (!deckResult) throw new Error('No deck data in response')

          const resolvedCards: DeckCard[] = []
          const resolvedMap = new Map<string, { card: ScryfallCard; quantity: number }>()
          const batchCardData: ScryfallCard[] = []

          for (const card of deckResult.cards) {
            // Use canonical IDs for basic lands to avoid printing mismatches in diff
            const canonicalId = BASIC_LAND_NAMES[card.name]
            if (canonicalId) {
              const existing = resolvedMap.get(canonicalId)
              if (existing) {
                existing.quantity += card.quantity
                const rc = resolvedCards.find((c) => c.scryfallId === canonicalId)
                if (rc) rc.quantity += card.quantity
              } else {
                resolvedCards.push({ scryfallId: canonicalId, quantity: card.quantity, zone: 'main' })
                try {
                  const landCard = await fetch(`https://api.scryfall.com/cards/${canonicalId}`, {
                    headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
                  }).then((r) => r.json()) as ScryfallCard
                  batchCardData.push(landCard)
                  resolvedMap.set(canonicalId, { card: landCard, quantity: card.quantity })
                } catch { /* skip */ }
              }
              continue
            }

            try {
              const scryfallCard = await getCardByName(card.name)
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

        // Validate suggestions against the proposed deck composition. If the
        // AI inserted dead cards (e.g. tribal payoffs without the tribe),
        // re-prompt once with explicit rejection feedback.
        const validateProposed = (
          resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>,
        ) => {
          const proposedEntries: Array<{ card: ScryfallCard; quantity: number }> = []
          for (const [, { card, quantity }] of resolvedMap) {
            proposedEntries.push({ card, quantity })
          }
          const proposedComposition = analyzeComposition(proposedEntries)
          const rejected: Array<{ name: string; reason: string }> = []
          for (const [, { card }] of resolvedMap) {
            // Locked cards stay regardless - the user pinned them.
            if (lockedCardIds?.has(card.id)) continue
            const issue = findSynergyIssue(card, proposedComposition)
            if (issue) rejected.push({ name: card.name, reason: issue.reason })
          }
          return rejected
        }

        if (outcome.intent === 'change') {
          const rejected = validateProposed(outcome.resolvedMap)
          if (rejected.length > 0) {
            const retry = await callAndResolve(rejected)
            if (abortRef.current) return
            if (retry.intent === 'change') {
              outcome = retry
            }
          }
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

        // Compute diff between current deck and proposed deck
        const currentMap = new Map<string, number>()
        for (const c of cards.filter((c) => c.zone === 'main')) {
          currentMap.set(c.scryfallId, c.quantity)
        }

        const changes: CardChange[] = []

        // Added or changed cards
        for (const [sid, { card, quantity }] of resolvedMap) {
          const oldQty = currentMap.get(sid) || 0
          if (oldQty === 0) {
            changes.push({
              name: getCardName(card),
              scryfallId: sid,
              scryfallCard: card,
              type: 'added',
              oldQuantity: 0,
              newQuantity: quantity,
            })
          } else if (quantity !== oldQty) {
            changes.push({
              name: getCardName(card),
              scryfallId: sid,
              scryfallCard: card,
              type: 'changed',
              oldQuantity: oldQty,
              newQuantity: quantity,
            })
          }
        }

        // Removed cards
        for (const [sid, oldQty] of currentMap) {
          if (!resolvedMap.has(sid)) {
            const data = cardDataMap.get(sid)
            changes.push({
              name: data ? getCardName(data) : sid,
              scryfallId: sid,
              scryfallCard: data,
              type: 'removed',
              oldQuantity: oldQty,
              newQuantity: 0,
            })
          }
        }

        // Lands are already in resolvedMap (updated at lines above) and
        // thus already included in the diff from the main loop. No second pass needed.

        // Filter out no-op changes (same quantity, same card)
        const actualChanges = changes.filter((c) => c.oldQuantity !== c.newQuantity)

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
    [setMessages, onCardDataUpdate],
  )

  const applyChanges = useCallback(() => {
    if (!pending) return
    onDeckUpdate(pending.resolvedCards, pending.deckName, pending.description)
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

  return { messages, isLoading, pending, newCardIds, sendMessage, applyChanges, discardChanges, reset }
}
