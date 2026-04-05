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
