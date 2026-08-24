import type { TranslationKey } from './i18n/types'

/** The five mana colors, in WUBRG order - the order Magic prints them in. */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

export type ManaColor = (typeof MANA_COLORS)[number]

/** The label for each color. Lives beside `MANA_COLORS` so the two can't drift. */
export const COLOR_KEYS: Record<ManaColor, TranslationKey> = {
  W: 'color.white',
  U: 'color.blue',
  B: 'color.black',
  R: 'color.red',
  G: 'color.green',
}

/**
 * Whether `value` is one of the five colors.
 *
 * Scryfall types a card's `colors` and `color_identity` as `string[]`, so any
 * color read off a card reaches this app unnarrowed. Narrowing it here is what
 * lets a caller index `COLOR_KEYS`, or build a `ManaColor[]`, without a cast.
 */
export function isManaColor(value: string): value is ManaColor {
  return MANA_COLORS.includes(value as ManaColor)
}
