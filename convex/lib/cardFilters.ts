/**
 * Hard-filter rules for MTG cards — the single source of truth.
 *
 * A "hard filter" decides whether a card is a real, tournament-legal paper
 * Magic card that this app is willing to show at all. Cards that fail a hard
 * filter are NEVER shown, regardless of user preferences — no stickers, no
 * Un-sets, no playtest cards, no oversized commander cards, no Alchemy-only
 * digital cards, no tokens, no emblems, no planes, etc.
 *
 * Soft filters (color identity, budget, format legality, rarity) live in
 * src/lib/card-validation.ts and depend on the user's deck preferences.
 *
 * This module is intentionally zero-dependency pure TypeScript so it can be
 * imported from both convex/ (server actions + AI prompts) and src/
 * (Scryfall client + runtime validation + section fill).
 */

/** Card types that are never playable in a normal 60-card constructed deck. */
export const EXCLUDED_TYPES = [
  'planeswalker',
  'conspiracy',
  'vanguard',
  'scheme',
  'plane',
  'phenomenon',
  'dungeon',
  'attraction',
  'sticker',
] as const

/** Scryfall set_type values that contain non-tournament-legal cards. */
export const EXCLUDED_SET_TYPES = [
  'funny',       // Un-sets (Unglued, Unhinged, Unstable, Unfinity, Mystery Booster playtest)
  'memorabilia', // Oversized cards, world champ decks, 30th anniversary promos
  'token',       // Token-only sets
  'vanguard',    // Vanguard sets
  'minigame',    // Minigame-only sets
  'alchemy',     // Digital-only Alchemy / Arena cards
] as const

/** Scryfall layout values that are not playable cards in their own right. */
export const EXCLUDED_LAYOUTS = [
  'token',
  'double_faced_token',
  'emblem',
  'planar',
  'scheme',
  'vanguard',
  'art_series',
  'reversible_card',
  'sticker',
  'augment',
  'host',
] as const

/**
 * Scryfall search fragment that excludes all hard-filtered cards at the
 * query level — append this to every `searchCards` call. Scryfall's `t:`
 * searches are substring-matched, so `-t:sticker` catches "Stickers" too.
 */
export const HARD_FILTER_SCRYFALL_QUERY = [
  // Type-line exclusions
  '-t:dungeon',
  '-t:emblem',
  '-t:token',
  '-t:scheme',
  '-t:vanguard',
  '-t:plane',
  '-t:phenomenon',
  '-t:conspiracy',
  '-t:attraction',
  '-t:sticker',
  '-t:planeswalker',
  // Set-type exclusions
  '-st:funny',
  '-st:memorabilia',
  '-st:token',
  '-st:vanguard',
  '-st:minigame',
  '-st:alchemy',
  // Printing / availability exclusions
  '-is:digital',
  '-is:oversized',
  '-is:funny',
].join(' ')

/**
 * Hard-filter instructions for AI system prompts. Drop this block into every
 * prompt that asks Claude to suggest card names.
 */
export const HARD_FILTER_PROMPT_RULES = `- Do NOT suggest planeswalker, conspiracy, vanguard, scheme, plane, phenomenon, dungeon, attraction, or sticker cards — they are excluded from this app
- Do NOT suggest Un-set / silver-border / acorn cards, Mystery Booster playtest cards, or any cards from joke/funny sets (Unglued, Unhinged, Unstable, Unfinity, CMB1, CMB2)
- Do NOT suggest oversized cards, world-champion deck cards, or 30th anniversary memorabilia printings
- Do NOT suggest digital-only Alchemy or MTG Arena cards
- Do NOT suggest tokens, emblems, or art-series cards
- Do NOT suggest cards from Commander-specific sets, or cards that reference "commander" in their rules text
- Suggest only real, tournament-legal paper Magic cards`

/**
 * Minimal structural type the hard-filter function needs. The full
 * ScryfallCard interface is structurally compatible, so callers can just
 * pass their ScryfallCard directly.
 */
export interface HardFilterCard {
  layout: string
  type_line: string
  set: string
  set_name: string
  legalities: Record<string, string>
  border_color?: string
  security_stamp?: string
  set_type?: string
  games?: string[]
  oversized?: boolean
  digital?: boolean
}

/**
 * Returns a rejection reason if the card violates any hard-filter rule,
 * or null if the card is allowed. Use this as a belt-and-suspenders check
 * anywhere a card enters the app from an external source (Scryfall, AI).
 */
export function getHardFilterRejectionReason(card: HardFilterCard): string | null {
  // Layout check — catches sticker sheets, tokens, emblems, planes, schemes, art series.
  if ((EXCLUDED_LAYOUTS as readonly string[]).includes(card.layout)) {
    return `${card.layout} layout is excluded`
  }

  // Type-line check — catches stickers/attractions/planeswalkers/dungeons even on cards with a normal layout.
  const typeLine = card.type_line.toLowerCase()
  for (const excluded of EXCLUDED_TYPES) {
    if (typeLine.includes(excluded)) {
      return `${excluded.charAt(0).toUpperCase() + excluded.slice(1)} cards are excluded`
    }
  }

  // set_type check — catches Un-sets, Mystery Booster playtest, memorabilia, oversized cmdr, alchemy.
  if (card.set_type && (EXCLUDED_SET_TYPES as readonly string[]).includes(card.set_type)) {
    return `Cards from ${card.set_type} sets are excluded`
  }

  // Un-set border / acorn stamp — safety net for funny cards that slip the set_type check.
  if (card.border_color === 'silver' || card.security_stamp === 'acorn') {
    return 'Un-set / acorn cards are excluded'
  }

  // Oversized printings (commander oversized, planechase oversized).
  if (card.oversized === true) {
    return 'Oversized cards are excluded'
  }

  // Digital-only (Alchemy, Arena, MTGO-only).
  if (card.digital === true) {
    return 'Digital-only cards are excluded'
  }
  if (card.games && card.games.length > 0 && !card.games.includes('paper')) {
    return 'Digital-only cards are excluded'
  }

  return null
}

/** Convenience inverse: true if the card passes every hard-filter rule. */
export function isPlayableCard(card: HardFilterCard): boolean {
  return getHardFilterRejectionReason(card) === null
}
