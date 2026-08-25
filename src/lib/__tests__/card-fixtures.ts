/**
 * Minimal ScryfallCard builders for validation tests. Only the fields the
 * filter and synergy gates read are populated - everything else is left off so
 * a fixture never implies coverage it doesn't have.
 */
import type { ScryfallCard } from '../scryfall/types'

export interface MakeCardOverrides {
  rarity?: string
  type_line?: string
  oracle_text?: string
  cmc?: number
  prices?: Record<string, string | null>
  legalities?: Record<string, string>
}

/** A generic nonland card. Defaults: common, 2-mana creature, no price data. */
export function makeCard(
  id: string,
  color_identity: string[],
  overrides: MakeCardOverrides = {},
): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: 'Creature',
    oracle_text: '',
    color_identity,
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
    ...overrides,
  }
}

/**
 * A basic land printing: common rarity, ~$0 price, "Basic Land — <name>" type
 * line. Pass a canonical id from BASIC_LAND_ID_BY_COLOR to model what the
 * resolver produces, or any other id to model an alternate printing.
 */
export function makeBasicLand(id: string, name: string, color_identity: string[]): ScryfallCard {
  return {
    id,
    name,
    lang: 'en',
    layout: 'normal',
    cmc: 0,
    type_line: `Basic Land — ${name}`,
    oracle_text: '',
    color_identity,
    set: 'm21',
    set_name: 'Core Set 2021',
    rarity: 'common',
    collector_number: '1',
    legalities: { modern: 'legal' },
    prices: { usd: '0.05' },
  }
}
