import { MANA_COLORS, type ManaColor } from './mana-colors'
import type { ScryfallCard } from './scryfall/types'
import type { DeckSection } from './section-plan'
import { MAX_COPIES } from '../../convex/lib/deckRules'

/**
 * The only zone this app has. Manaschmiede is 60-card casual only, so there is
 * no sideboard to move cards to — the type stays as a named single member so
 * DeckCard keeps reading as "a card in a zone" rather than growing a silent
 * assumption at every call site.
 */
export type DeckZone = 'main'

export interface DeckCard {
  scryfallId: string
  quantity: number
  zone: DeckZone
  locked?: boolean
}

export function isBasicLand(card: ScryfallCard): boolean {
  return card.type_line.includes('Basic Land')
}

/**
 * Derive a deck's color identity from its resolved cards: the WUBRG-ordered
 * union of every resolved card's color_identity. Returns [] when the deck is
 * empty, colorless, or no cards have resolved yet. Used both for the deck-view
 * display colors and as the fallback allowed-color set for AI enforcement when
 * the intent commits no colors.
 */
export function deriveColorsFromCards(
  cards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
): ManaColor[] {
  const colorSet = new Set<ManaColor>()
  for (const dc of cards) {
    const card = cardDataMap.get(dc.scryfallId)
    if (!card) continue
    for (const c of card.color_identity) colorSet.add(c as ManaColor)
  }
  return MANA_COLORS.filter((c) => colorSet.has(c))
}

export function getTotalCards(cards: DeckCard[], zone?: DeckZone): number {
  const filtered = zone ? cards.filter((c) => c.zone === zone) : cards
  return filtered.reduce((sum, c) => sum + c.quantity, 0)
}

/**
 * Merge new card additions into an existing deck list. Collapses duplicate
 * scryfallId entries (so a section fill can't accidentally create two
 * "Lightning Bolt" rows) and caps non-basic-land totals at MAX_COPIES.
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
      const cap = isBasicLandId(add.scryfallId) ? Infinity : MAX_COPIES
      const newQty = Math.min(current.quantity + add.quantity, cap)
      if (newQty > current.quantity) {
        merged[idx] = { ...current, quantity: newQty }
        addedIds.push(add.scryfallId)
      }
      // If the card is already at the cap, silently drop the addition.
      // The AI was told not to re-suggest it; this is just the safety net.
    } else {
      const cap = isBasicLandId(add.scryfallId) ? Infinity : MAX_COPIES
      const qty = Math.min(add.quantity, cap)
      merged.push({ scryfallId: add.scryfallId, quantity: qty, zone: 'main' })
      addedIds.push(add.scryfallId)
    }
  }

  return { merged, addedIds }
}

/**
 * Project a locked-id set onto a deck list. Returns a NEW array where each
 * entry carries `locked: true` iff its scryfallId is in `lockedIds`, and the
 * flag is cleared otherwise. Single source of truth for the lock flag so the
 * `locked` field and the locked-id set can't drift.
 */
export function projectLocked(cards: DeckCard[], lockedIds: Set<string>): DeckCard[] {
  return cards.map((c) => {
    const locked = lockedIds.has(c.scryfallId)
    const { locked: _drop, ...rest } = c
    return locked ? { ...rest, locked: true } : rest
  })
}

/** Collect the scryfallIds whose card carries a truthy `locked` flag. */
export function deriveLockedIds(cards: DeckCard[]): Set<string> {
  const ids = new Set<string>()
  for (const c of cards) {
    if (c.locked) ids.add(c.scryfallId)
  }
  return ids
}

export type DeckDisplayCard = DeckCard & { card: ScryfallCard }

export interface BucketSectionCardsInput {
  deckDisplay: DeckDisplayCard[]
  sections: DeckSection[]
  sectionAssignments: Record<string, string[]>
  /** Ids treated as the locked core; precedence over section assignments. */
  lockedSource: Set<string>
  /** When true and the plan is empty, leftover cards split by card type. */
  fallbackByType: boolean
}

/**
 * Bucket a deck's display cards into the lanes the deck view renders: a 'core'
 * lane for locked cards, one lane per non-land section id, a 'lands' lane, and
 * a leftover lane. Each card lands in EXACTLY one bucket — locked wins over
 * assignment, assignment wins over land-by-type, and anything still loose goes
 * to either 'unassigned' or the type-split 'creatures'/'spells'/'support'
 * buckets (only when `fallbackByType` and the plan is empty). Empty buckets are
 * omitted from the result.
 */
export function bucketSectionCards(
  input: BucketSectionCardsInput,
): Record<string, DeckDisplayCard[]> {
  const { deckDisplay, sections, sectionAssignments, lockedSource, fallbackByType } = input
  const result: Record<string, DeckDisplayCard[]> = {}
  const assigned = new Set<string>()

  // Core (locked) cards — highest precedence.
  const core: DeckDisplayCard[] = []
  for (const d of deckDisplay) {
    if (lockedSource.has(d.scryfallId)) {
      core.push(d)
      assigned.add(d.scryfallId)
    }
  }
  if (core.length > 0) result['core'] = core

  // Section-assigned cards (non-land sections).
  for (const section of sections) {
    if (section.id === 'lands') continue
    const sectionIds = new Set(sectionAssignments[section.id] ?? [])
    const cards: DeckDisplayCard[] = []
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId) && sectionIds.has(d.scryfallId)) {
        cards.push(d)
        assigned.add(d.scryfallId)
      }
    }
    if (cards.length > 0) result[section.id] = cards
  }

  // Lands — by type line OR explicit assignment.
  const lands: DeckDisplayCard[] = []
  const landAssignIds = new Set(sectionAssignments['lands'] ?? [])
  for (const d of deckDisplay) {
    if (
      !assigned.has(d.scryfallId) &&
      (d.card.type_line.toLowerCase().includes('land') || landAssignIds.has(d.scryfallId))
    ) {
      lands.push(d)
      assigned.add(d.scryfallId)
    }
  }
  if (lands.length > 0) result['lands'] = lands

  // Leftovers.
  const unassigned: DeckDisplayCard[] = []
  for (const d of deckDisplay) {
    if (!assigned.has(d.scryfallId)) unassigned.push(d)
  }

  if (unassigned.length > 0) {
    if (fallbackByType && sections.length === 0) {
      const creatures: DeckDisplayCard[] = []
      const spells: DeckDisplayCard[] = []
      const support: DeckDisplayCard[] = []
      for (const d of unassigned) {
        const type = d.card.type_line.toLowerCase()
        if (type.includes('creature')) creatures.push(d)
        else if (type.includes('instant') || type.includes('sorcery')) spells.push(d)
        else support.push(d)
      }
      if (creatures.length > 0) result['creatures'] = creatures
      if (spells.length > 0) result['spells'] = spells
      if (support.length > 0) result['support'] = support
    } else {
      result['unassigned'] = unassigned
    }
  }

  return result
}

/** Generate a text decklist compatible with Arena/MTGO/Moxfield */
export function generateTextDecklist(
  cards: DeckCard[],
  cardData: Map<string, ScryfallCard>,
): string {
  const mainCards = cards.filter((c) => c.zone === 'main')

  const formatLine = (c: DeckCard) => {
    const data = cardData.get(c.scryfallId)
    const name = data?.name ?? c.scryfallId
    return `${c.quantity} ${name}`
  }

  return mainCards.map(formatLine).join('\n')
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
