import type { ScryfallCard } from './scryfall/types'
import { getHardFilterRejectionReason } from '../../convex/lib/cardFilters'
import { isBasicLand } from './deck-utils'
import { isBasicLandId } from '../../convex/lib/basicLands'

export { getHardFilterRejectionReason, isPlayableCard } from '../../convex/lib/cardFilters'

export interface DeckFilters {
  colors: string[]
  budgetMin?: number | null
  budgetMax?: number | null
  rarities?: string[]
}

/**
 * Basic lands are mana, not a purchase. Budget and rarity express what the
 * user wants to *buy*, and every basic fails both gates - price is ~$0 and the
 * rarity is common - so judging them rejected the canonical basics the
 * resolver itself had just added, and every chat request with a budget or
 * rarity intent burned a guaranteed retry round trip.
 *
 * Color identity still applies: an off-color basic is a real mistake, not a
 * filter artifact.
 *
 * Matches on the type line so any printing counts, and on the canonical IDs so
 * a stub card record without a type line still resolves.
 */
function isBasicLandPrinting(card: ScryfallCard): boolean {
  // ID first: isBasicLand reads card.type_line unguarded, so a stub record
  // without one would throw before the fallback ever ran.
  return isBasicLandId(card.id) || isBasicLand(card)
}

/**
 * Check if a card violates the user's deck-building filters (colors, budget, rarity).
 * Returns a rejection reason string, or null if the card passes all filters.
 *
 * Basic lands are exempt from the budget and rarity checks - see
 * isBasicLandPrinting.
 */
export function getFilterRejectionReason(card: ScryfallCard, filters: DeckFilters): string | null {
  const isBasic = isBasicLandPrinting(card)
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

  // Budget range check
  if (!isBasic && (filters.budgetMin != null || filters.budgetMax != null) && card.prices) {
    const price = parseFloat(card.prices.usd ?? card.prices.usd_foil ?? '0')
    if (filters.budgetMin != null && price < filters.budgetMin) {
      return `Card price ($${price.toFixed(2)}) is below minimum budget ($${filters.budgetMin.toFixed(2)})`
    }
    if (filters.budgetMax != null && price > filters.budgetMax) {
      return `Card price ($${price.toFixed(2)}) exceeds budget ($${filters.budgetMax.toFixed(2)})`
    }
  }

  // Rarity check
  if (!isBasic && filters.rarities && filters.rarities.length > 0 && filters.rarities.length < 4) {
    if (!filters.rarities.includes(card.rarity)) {
      return `Card rarity (${card.rarity}) not in allowed rarities`
    }
  }

  return null
}

/**
 * Color/budget/rarity gate for an AI-suggested card. Both AI paths use
 * it: chat proposals and section fills.
 *
 * Locked cards bypass the gate entirely (the user pinned them, so no intent
 * filter may evict them). Otherwise this delegates to getFilterRejectionReason
 * with the already-resolved DeckFilters — when filters.colors is empty there's
 * no color constraint, so the gate only rejects on a genuine color/budget/
 * rarity mismatch. Pure: no deck composition, no synergy reasoning.
 */
export function getIntentRejectionReason(
  card: ScryfallCard,
  filters: DeckFilters,
  isLocked: boolean,
): string | null {
  if (isLocked) return null
  return getFilterRejectionReason(card, filters)
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
