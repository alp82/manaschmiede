import type { ManaColor } from '../components/ManaSymbol'
import type { ScryfallCard } from './scryfall/types'

const COLOR_ORDER: ManaColor[] = ['W', 'U', 'B', 'R', 'G']

/**
 * Extract the colors that appear in a card's mana cost.
 *
 * Uses the primary face's cost for dual-faced / split / adventure cards
 * (the top-level `mana_cost` for those is a combined `{A} // {B}` string,
 * which still parses correctly but keeps semantics consistent with the
 * lightbox display).
 *
 * Handles hybrid (`{G/W}`), phyrexian (`{U/P}`), and generic-hybrid
 * (`{2/W}`) symbols — any W/U/B/R/G character found inside a symbol
 * counts toward that color.
 *
 * Returns an empty array for colorless cards (no colored symbols in cost).
 */
export function extractCostColors(card: ScryfallCard): ManaColor[] {
  const cost = card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? ''
  if (!cost) return []
  const symbols = cost.match(/\{([^}]+)\}/g) ?? []
  const found = new Set<ManaColor>()
  for (const sym of symbols) {
    const inner = sym.slice(1, -1)
    for (const ch of inner) {
      if (ch === 'W' || ch === 'U' || ch === 'B' || ch === 'R' || ch === 'G') {
        found.add(ch)
      }
    }
  }
  return COLOR_ORDER.filter((c) => found.has(c))
}
