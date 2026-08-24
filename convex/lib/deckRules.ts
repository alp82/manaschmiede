/**
 * The deck-construction rules every parser and enforcer shares: the deck
 * size, the 4-copy limit, and the basic lands that are exempt from it.
 *
 * These lived as private consts inside `generateDeck.ts`, which meant the
 * shared response parser could not apply the clamp. Zero runtime imports, so
 * both trees (convex/ actions and src/ node tests) can reach them the same way
 * cardFilters.ts is reached.
 */

/**
 * The size of a deck. A target, not a floor - Manaschmiede builds 60-card
 * casual decks and nothing else, so a legal deck here is EXACTLY 60 maindeck
 * cards (see docs/adr/0001-60-card-casual-only.md).
 */
export const TARGET_DECK_SIZE = 60

/** Maximum copies of any one non-basic card in a deck. */
export const MAX_COPIES = 4

/**
 * The five basic land names, in English Oracle spelling. Snow-covered and
 * Wastes variants are not listed - the type-line check in `enforceDeckSize`
 * catches those; this set is the name-only fast path.
 */
export const BASIC_LAND_NAMES: ReadonlySet<string> = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
])

/** True for the five English basic land names. */
export function isBasicLandName(name: string): boolean {
  return BASIC_LAND_NAMES.has(name)
}

/**
 * Apply the 4-copy rule to one entry. Basic lands are exempt - a deck runs as
 * many Mountains as it likes.
 */
export function clampCopies(name: string, quantity: number): number {
  return isBasicLandName(name) ? quantity : Math.min(quantity, MAX_COPIES)
}
