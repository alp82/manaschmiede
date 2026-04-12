import type { ManaColor } from '../components/ManaSymbol'
import type { DeckCard, DeckFormat } from './deck-utils'
import type { DeckSection } from './section-plan'

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
  createdAt: number
  updatedAt: number
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
