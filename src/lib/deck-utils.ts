import type { ScryfallCard } from './scryfall/types'

export type DeckFormat = 'standard' | 'modern' | 'casual'
export type DeckZone = 'main' | 'sideboard'

export interface DeckCard {
  scryfallId: string
  quantity: number
  zone: DeckZone
  locked?: boolean
}

export interface FormatRules {
  minDeckSize: number
  maxDeckSize: number | null
  maxCopies: number
  sideboardSize: number
}

export const FORMAT_RULES: Record<DeckFormat, FormatRules> = {
  standard: {
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopies: 4,
    sideboardSize: 15,
  },
  modern: {
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopies: 4,
    sideboardSize: 15,
  },
  casual: {
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopies: 4,
    sideboardSize: 15,
  },
}

export const FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: 'Standard',
  modern: 'Modern',
  casual: 'Casual',
}

export function isBasicLand(card: ScryfallCard): boolean {
  return card.type_line.includes('Basic Land')
}

export function getTotalCards(cards: DeckCard[], zone?: DeckZone): number {
  const filtered = zone ? cards.filter((c) => c.zone === zone) : cards
  return filtered.reduce((sum, c) => sum + c.quantity, 0)
}

/**
 * Merge new card additions into an existing deck list. Collapses duplicate
 * scryfallId entries (so a section fill can't accidentally create two
 * "Lightning Bolt" rows) and caps non-basic-land totals at 4 copies.
 *
 * Returns both the merged deck AND the list of scryfallIds that were
 * actually added or had their quantity increased. Callers use the latter
 * to update section assignments — an addition that collided with an
 * existing 4-copy entry should NOT get added to the section index.
 */
export function mergeCardsIntoDeck(
  existing: DeckCard[],
  additions: Array<{ scryfallId: string; quantity: number }>,
  isBasicLandId: (id: string) => boolean,
): { merged: DeckCard[]; addedIds: string[] } {
  const merged = existing.map((c) => ({ ...c }))
  const addedIds: string[] = []

  for (const add of additions) {
    if (add.quantity <= 0) continue
    const idx = merged.findIndex(
      (c) => c.scryfallId === add.scryfallId && c.zone === 'main',
    )
    if (idx >= 0) {
      const current = merged[idx]
      // Locked cards stay exactly as the user pinned them.
      if (current.locked) continue
      const cap = isBasicLandId(add.scryfallId) ? Infinity : 4
      const newQty = Math.min(current.quantity + add.quantity, cap)
      if (newQty > current.quantity) {
        merged[idx] = { ...current, quantity: newQty }
        addedIds.push(add.scryfallId)
      }
      // If the card is already at the cap, silently drop the addition.
      // The AI was told not to re-suggest it; this is just the safety net.
    } else {
      const cap = isBasicLandId(add.scryfallId) ? Infinity : 4
      const qty = Math.min(add.quantity, cap)
      merged.push({ scryfallId: add.scryfallId, quantity: qty, zone: 'main' })
      addedIds.push(add.scryfallId)
    }
  }

  return { merged, addedIds }
}

/** Generate a text decklist compatible with Arena/MTGO/Moxfield */
export function generateTextDecklist(
  cards: DeckCard[],
  cardData: Map<string, ScryfallCard>,
): string {
  const mainCards = cards.filter((c) => c.zone === 'main')
  const sideCards = cards.filter((c) => c.zone === 'sideboard')

  const formatLine = (c: DeckCard) => {
    const data = cardData.get(c.scryfallId)
    const name = data?.name ?? c.scryfallId
    return `${c.quantity} ${name}`
  }

  const lines: string[] = []
  for (const c of mainCards) lines.push(formatLine(c))
  if (sideCards.length > 0) {
    lines.push('')
    lines.push('Sideboard')
    for (const c of sideCards) lines.push(formatLine(c))
  }
  return lines.join('\n')
}

/** Copy text decklist to clipboard, returns true on success */
export async function copyDecklistToClipboard(
  cards: DeckCard[],
  cardData: Map<string, ScryfallCard>,
): Promise<boolean> {
  const text = generateTextDecklist(cards, cardData)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
