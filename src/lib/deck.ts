import type { ManaColor } from './mana-colors'
import type { DeckCard } from './deck-utils'
import type { DeckIntent } from './deck-intent'
import type { DeckSection } from './section-plan'
import type { ScryfallCard } from './scryfall/types'

/**
 * A saved deck: exactly 60 main-deck cards, casual, no sideboard.
 *
 * This is the one deck shape in the app. It used to be called `LocalDeck` and
 * live in `deck-storage.ts`, named for the fact that it came out of
 * localStorage — but where a deck is stored is `storage/deck-store.ts`'s
 * business, not the shape's. The store validates anything claiming to be a
 * `Deck` on the way out of storage, so this is also the only place the shape
 * is checked (issue #29).
 */
export interface Deck {
  id: string
  name: string
  description?: string
  /** Card-derived color union — DISPLAY only, never the AI constraint. */
  colors?: ManaColor[]
  /** User-authored, persistent, inert deck intent — the AI color/budget/rarity source of truth. */
  intent?: DeckIntent
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
