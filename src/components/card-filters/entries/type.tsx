import { dropdownControl, type DropdownChoice } from '../dropdown-control'
import type { FilterSpec } from '../spec'

const CARD_TYPE_KEYS: DropdownChoice[] = [
  { value: '', key: 'filter.allTypes' },
  { value: 'creature', key: 'filter.creature' },
  { value: 'instant', key: 'filter.instant' },
  { value: 'sorcery', key: 'filter.sorcery' },
  { value: 'enchantment', key: 'filter.enchantment' },
  { value: 'artifact', key: 'filter.artifact' },
  { value: 'land', key: 'filter.land' },
]

/** Card type — a single Scryfall `t:` term. */
export const typeFilter = {
  id: 'type' as const,
  labelKey: 'filter.type',
  ariaLabelKey: 'filter.typeAria',
  glyph: 'T',
  queryRank: 1,
  params: ['type'],
  decode: (raw) => ({ cardType: raw.type }),
  encode: (slice) => ({ type: slice.cardType || null }),
  isActive: (state) => state.cardType !== '',
  toQuery: (state) => (state.cardType ? [`t:${state.cardType}`] : []),
  Control: dropdownControl('cardType', CARD_TYPE_KEYS),
} satisfies FilterSpec
