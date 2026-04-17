import type { ManaColor } from '../components/ManaSymbol'
import type { DeckCard, DeckFormat } from './deck-utils'
import type { DeckSection } from './section-plan'
import type { ScryfallCard } from './scryfall/types'

const STORAGE_KEY = 'manaschmiede-decks'

export interface LocalDeck {
  id: string
  name: string
  description?: string
  format: DeckFormat
  colors?: ManaColor[]
  cards: DeckCard[]
  sectionPlan?: DeckSection[]
  sectionAssignments?: Record<string, string[]>
  featuredCardIds?: string[]
  createdAt: number
  updatedAt: number
}

/**
 * Pick up to 3 Scryfall IDs from the deck, ranked by USD price desc.
 * Used to populate the `/decks` preview tiles without refetching every
 * card in every deck. Dedupes by scryfallId so a card present multiple
 * times in the deck can't occupy more than one slot.
 */
export function pickFeaturedCardIds(
  cards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
): string[] {
  const seen = new Map<string, number>()
  for (const dc of cards) {
    if (seen.has(dc.scryfallId)) continue
    const card = cardDataMap.get(dc.scryfallId)
    const raw = card?.prices?.usd ?? card?.prices?.usd_foil ?? '0'
    const price = parseFloat(raw ?? '0')
    seen.set(dc.scryfallId, isNaN(price) ? 0 : price)
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id)
}

export function loadDecks(): LocalDeck[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function loadDeck(id: string): LocalDeck | null {
  return loadDecks().find((d) => d.id === id) || null
}

export function persistDeck(deck: LocalDeck): void {
  const decks = loadDecks()
  const idx = decks.findIndex((d) => d.id === deck.id)
  if (idx >= 0) decks[idx] = deck
  else decks.push(deck)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks))
}

export function deleteDeck(id: string): void {
  const decks = loadDecks().filter((d) => d.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks))
}
