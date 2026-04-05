import { useState, useCallback, useRef, useMemo } from 'react'
import { getCardByName } from './scryfall/client'
import type { ScryfallCard } from './scryfall/types'
import { getCardName } from './scryfall/types'
import type { DeckCard } from './deck-utils'

const TARGET_DECK_SIZE = 60

// Basic land Scryfall IDs (one representative printing each)
const BASIC_LANDS: Record<string, string> = {
  W: '42232ea6-e31d-46a6-9f94-b2ad2416d79b', // Plains
  U: '36fe6951-d372-4069-b542-84b8df7aefdc', // Island
  B: '3a027e0d-f95d-4942-b70f-312ca5c5a95d', // Swamp
  R: '4f0993bf-ed8b-4597-84e9-5173483c8e58', // Mountain
  G: 'f169dfb2-e4c8-46e9-8591-e51bb82da082', // Forest
}

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
    const landId = BASIC_LANDS[color]
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
      const landCard = await getCardByName(
        color === 'W' ? 'Plains' : color === 'U' ? 'Island' : color === 'B' ? 'Swamp' : color === 'R' ? 'Mountain' : 'Forest',
      )
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
  changes: CardChange[]
  resolvedCards: DeckCard[]
}

interface UseDeckChatOptions {
  cards: DeckCard[]
  cardDataMap: Map<string, ScryfallCard>
  deckDescription: string
  onDeckUpdate: (cards: DeckCard[], name?: string, description?: string) => void
  onCardDataUpdate: (card: ScryfallCard) => void
  lockedCardIds?: Set<string>
  initialMessages?: ChatMessage[]
  onMessagesChange?: (messages: ChatMessage[]) => void
}

export function useDeckChat({ cards, cardDataMap, deckDescription, onDeckUpdate, onCardDataUpdate, lockedCardIds, initialMessages, onMessagesChange }: UseDeckChatOptions) {
  const [messages, setMessagesInternal] = useState<ChatMessage[]>(initialMessages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [pending, setPending] = useState<PendingChanges | null>(null)
  const abortRef = useRef(false)

  // Wrap setMessages to also notify parent
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesInternal((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      onMessagesChange?.(next)
      return next
    })
  }, [onMessagesChange])

  const sendMessage = useCallback(
    async (text: string) => {
      abortRef.current = false
      setPending(null)

      const userMsg: ChatMessage = { role: 'user', content: text }
      const newMessages = [...messages, userMsg]
      setMessages(newMessages)
      setIsLoading(true)

      try {
        const currentCards = cards
          .filter((c) => c.zone === 'main')
          .map((c) => {
            const data = cardDataMap.get(c.scryfallId)
            // Send English name to AI (card.name is always English on Scryfall)
            const name = data ? data.name : c.scryfallId
            return { name, quantity: c.quantity }
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

        const result = await client.action(api.generateDeck.chat, {
          messages: apiMessages,
          currentCards: currentCards.length > 0 ? currentCards : undefined,
          deckDescription: deckDescription || undefined,
          lockedCards,
        })

        if (abortRef.current) return

        // Question intent: show answer as message, no deck changes
        if (result.intent === 'question' && result.answer) {
          const answerMsg: ChatMessage = { role: 'assistant', content: result.answer }
          setMessages((prev) => [...prev, answerMsg])
          setIsLoading(false)
          return
        }

        const deckResult = result.deck
        if (!deckResult) {
          throw new Error('No deck data in response')
        }

        // Resolve all cards via Scryfall
        const resolvedCards: DeckCard[] = []
        const resolvedMap = new Map<string, { card: ScryfallCard; quantity: number }>()

        for (const card of deckResult.cards) {
          try {
            const scryfallCard = await getCardByName(card.name)
            onCardDataUpdate(scryfallCard)
            resolvedCards.push({
              scryfallId: scryfallCard.id,
              quantity: card.quantity,
              zone: 'main',
            })
            resolvedMap.set(scryfallCard.id, { card: scryfallCard, quantity: card.quantity })
          } catch {
            // Skip unresolvable cards
          }
        }

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

        // Add auto-filled lands to changes
        for (const land of addedLands) {
          const existingChange = changes.find((c) => c.scryfallId === land.scryfallId)
          if (existingChange) {
            existingChange.newQuantity += land.quantity
          } else {
            changes.push({
              name: land.name,
              scryfallId: land.scryfallId,
              scryfallCard: land.scryfallCard,
              type: 'added',
              oldQuantity: currentMap.get(land.scryfallId) || 0,
              newQuantity: (resolvedMap.get(land.scryfallId)?.quantity || 0),
            })
          }
        }

        setPending({
          deckName: deckResult.name,
          description: deckResult.description + (addedLands.length > 0 ? ` (${addedLands.reduce((s, l) => s + l.quantity, 0)} lands auto-filled)` : ''),
          changes,
          resolvedCards: filledCards,
        })
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
    [messages, cards, cardDataMap, onDeckUpdate, onCardDataUpdate, lockedCardIds],
  )

  const applyChanges = useCallback(() => {
    if (!pending) return
    onDeckUpdate(pending.resolvedCards, pending.deckName, pending.description)
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: `${pending.deckName}: ${pending.description}`,
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
