import { Dropdown, type DropdownOption } from '../../ui/Dropdown'
import { useT } from '../../../lib/i18n'
import type { TranslationKey } from '../../../lib/i18n/types'
import type { FilterControlProps, FilterSpec } from '../spec'

const CARD_TYPE_KEYS: { value: string; key: TranslationKey | '' }[] = [
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
  Control: TypeControl,
} satisfies FilterSpec

function TypeControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  const options: DropdownOption[] = CARD_TYPE_KEYS.map((ct) => ({
    value: ct.value,
    label: ct.key ? t(ct.key) : ct.value,
  }))
  return (
    <Dropdown
      className="w-full"
      value={state.cardType}
      onChange={(cardType) => onChange({ cardType })}
      options={options}
      ariaLabel={ariaLabel}
    />
  )
}
