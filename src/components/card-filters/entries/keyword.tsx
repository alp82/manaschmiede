import { dropdownControl, type DropdownChoice } from '../dropdown-control'
import type { FilterSpec } from '../spec'

const KEYWORD_OPTIONS: DropdownChoice[] = [
  { value: '', key: 'filter.allKeywords' },
  { value: 'flying', key: 'trait.flying' },
  { value: 'trample', key: 'trait.trample' },
  { value: 'deathtouch', key: 'trait.deathtouch' },
  { value: 'lifelink', key: 'trait.lifelink' },
  { value: 'first_strike', key: 'trait.first-strike' },
  { value: 'double_strike', key: 'trait.double-strike' },
  { value: 'vigilance', key: 'trait.vigilance' },
  { value: 'haste', key: 'trait.haste' },
  { value: 'hexproof', key: 'trait.hexproof' },
  { value: 'menace', key: 'trait.menace' },
  { value: 'reach', key: 'trait.reach' },
  { value: 'flash', key: 'trait.flash' },
  { value: 'ward', key: 'trait.ward' },
  { value: 'indestructible', key: 'trait.indestructible' },
]

/** Evergreen keyword abilities — a single Scryfall `keyword:` term. */
export const keywordFilter = {
  id: 'keyword' as const,
  labelKey: 'filter.keyword',
  ariaLabelKey: 'filter.keyword',
  glyph: '✦',
  queryRank: 5,
  params: ['keyword'],
  decode: (raw) => ({ keyword: raw.keyword }),
  encode: (slice) => ({ keyword: slice.keyword || null }),
  isActive: (state) => state.keyword !== '',
  toQuery: (state) => (state.keyword ? [`keyword:${state.keyword}`] : []),
  Control: dropdownControl('keyword', KEYWORD_OPTIONS),
} satisfies FilterSpec
