import type { ScryfallCard } from './scryfall/types'

/** Commander-specific set patterns */
const COMMANDER_SET_PATTERNS = [
  /commander/i,
  /^c\d{2}$/i,  // C13, C14, etc.
  /^cm[a-z]/i,  // CMR, CMD, etc.
]

/** Card types that aren't valid for normal 60-card constructed play */
const EXCLUDED_TYPES = [
  'planeswalker',
  'conspiracy',
  'vanguard',
  'scheme',
  'plane',
  'phenomenon',
  'dungeon',
  'attraction',
  'stickers',
]

/**
 * Check if a card is likely a commander-only card that shouldn't appear in 60-card casual decks.
 * Returns a rejection reason string, or null if the card is fine.
 */
export function getCardRejectionReason(card: ScryfallCard): string | null {
  const typeLine = card.type_line.toLowerCase()

  // Reject non-constructable card types
  for (const excluded of EXCLUDED_TYPES) {
    if (typeLine.includes(excluded)) {
      return `${excluded.charAt(0).toUpperCase() + excluded.slice(1)} cards are excluded`
    }
  }

  // Reject acorn/silver-border (Un-set joke cards)
  const raw = card as unknown as Record<string, unknown>
  if (raw.border_color === 'silver' || raw.security_stamp === 'acorn') {
    return 'Un-set / acorn cards are excluded'
  }

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
