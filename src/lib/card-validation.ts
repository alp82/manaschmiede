import type { ScryfallCard } from './scryfall/types'
import { getHardFilterRejectionReason } from '../../convex/lib/card-filters'

export { getHardFilterRejectionReason, isPlayableCard } from '../../convex/lib/card-filters'

export interface DeckFilters {
  colors: string[]
  format?: string
  budgetMin?: number | null
  budgetMax?: number | null
  rarities?: string[]
}

/**
 * Check if a card violates the user's deck-building filters (colors, format, budget, rarity).
 * Returns a rejection reason string, or null if the card passes all filters.
 */
export function getFilterRejectionReason(card: ScryfallCard, filters: DeckFilters): string | null {
  // Color identity check - card must fit within the selected colors
  if (filters.colors.length > 0) {
    const allowed = new Set(filters.colors.map((c) => c.toUpperCase()))
    const cardColors = card.color_identity.map((c) => c.toUpperCase())
    for (const c of cardColors) {
      if (!allowed.has(c)) {
        return `Card color identity (${card.color_identity.join('')}) doesn't match selected colors (${filters.colors.join('')})`
      }
    }
  }

  // Format legality check
  if (filters.format && filters.format !== 'casual') {
    const legality = card.legalities[filters.format]
    if (legality !== 'legal' && legality !== 'restricted') {
      return `Card is not legal in ${filters.format}`
    }
  }

  // Budget range check
  if ((filters.budgetMin != null || filters.budgetMax != null) && card.prices) {
    const price = parseFloat(card.prices.usd ?? card.prices.usd_foil ?? '0')
    if (filters.budgetMin != null && price < filters.budgetMin) {
      return `Card price ($${price.toFixed(2)}) is below minimum budget ($${filters.budgetMin.toFixed(2)})`
    }
    if (filters.budgetMax != null && price > filters.budgetMax) {
      return `Card price ($${price.toFixed(2)}) exceeds budget ($${filters.budgetMax.toFixed(2)})`
    }
  }

  // Rarity check
  if (filters.rarities && filters.rarities.length > 0 && filters.rarities.length < 4) {
    if (!filters.rarities.includes(card.rarity)) {
      return `Card rarity (${card.rarity}) not in allowed rarities`
    }
  }

  return null
}

/** Commander-specific set patterns */
const COMMANDER_SET_PATTERNS = [
  /commander/i,
  /^c\d{2}$/i,  // C13, C14, etc.
  /^cm[a-z]/i,  // CMR, CMD, etc.
]

/**
 * Check if a card should not appear in this app at all. Runs the shared
 * hard-filter rules first (non-playable types, Un-sets, memorabilia, digital
 * cards, etc.), then layers on the 60-card casual specific heuristics that
 * exclude commander-only cards.
 *
 * Returns a rejection reason string, or null if the card is fine.
 */
export function getCardRejectionReason(card: ScryfallCard): string | null {
  // Hard filter: stickers, playtest cards, oversized, digital-only, etc.
  const hardReason = getHardFilterRejectionReason(card)
  if (hardReason) return hardReason

  // Check if oracle text references "commander"
  const oracleText = (card.oracle_text || '').toLowerCase()
  if (oracleText.includes('commander')) {
    return 'Card references commander mechanics'
  }

  // Check if it's from a commander-specific set AND not legal in modern/legacy/pioneer
  const setName = card.set_name.toLowerCase()
  const setCode = card.set.toLowerCase()
  const isCommanderSet = COMMANDER_SET_PATTERNS.some((p) => p.test(setName) || p.test(setCode))

  if (isCommanderSet) {
    const isLegalElsewhere =
      card.legalities.modern === 'legal' ||
      card.legalities.legacy === 'legal' ||
      card.legalities.pioneer === 'legal'

    if (!isLegalElsewhere) {
      return `Commander-exclusive card from ${card.set_name}`
    }
  }

  // Check if the card is ONLY legal in commander/vintage (strong signal it's commander-designed)
  if (
    card.legalities.commander === 'legal' &&
    card.legalities.modern !== 'legal' &&
    card.legalities.legacy !== 'legal' &&
    card.legalities.pioneer !== 'legal' &&
    card.legalities.standard !== 'legal'
  ) {
    return 'Card is only legal in Commander/Vintage formats'
  }

  return null
}
