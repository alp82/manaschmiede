import { Dropdown, type DropdownOption } from '../../ui/Dropdown'
import { useT } from '../../../lib/i18n'
import type { TranslationKey } from '../../../lib/i18n/types'
import type { FilterControlProps, FilterSpec } from '../spec'

const KEYWORD_OPTIONS: { value: string; key: TranslationKey }[] = [
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
  Control: KeywordControl,
} satisfies FilterSpec

function KeywordControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  const options: DropdownOption[] = KEYWORD_OPTIONS.map((kw) => ({
    value: kw.value,
    label: t(kw.key),
  }))
  return (
    <Dropdown
      className="w-full"
      value={state.keyword}
      onChange={(keyword) => onChange({ keyword })}
      options={options}
      ariaLabel={ariaLabel}
    />
  )
}
