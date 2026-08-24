import type { TranslationKey } from './i18n/types'

/**
 * The rarities a deck can be filtered by, in printing order.
 *
 * `special` and `bonus` are Scryfall rarities this app never filters on, so
 * they are deliberately absent - a card that carries one is neither offered as
 * a filter nor excluded by one.
 */
export const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const

export type Rarity = (typeof RARITIES)[number]

/** The label for each rarity. Lives beside `RARITIES` so the two can't drift. */
export const RARITY_KEYS: Record<Rarity, TranslationKey> = {
  common: 'strategy.common',
  uncommon: 'strategy.uncommon',
  rare: 'strategy.rare',
  mythic: 'strategy.mythic',
}
