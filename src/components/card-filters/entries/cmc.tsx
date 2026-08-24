import { Dropdown, type DropdownOption } from '../../ui/Dropdown'
import { useT } from '../../../lib/i18n'
import type { TranslationKey } from '../../../lib/i18n/types'
import type { FilterControlProps, FilterSpec } from '../spec'

const CMC_OPTIONS: { value: string; key: TranslationKey | '' }[] = [
  { value: '', key: 'filter.allCmc' },
  { value: '0', key: '' },
  { value: '1', key: '' },
  { value: '2', key: '' },
  { value: '3', key: '' },
  { value: '4', key: '' },
  { value: '5', key: '' },
  { value: '6', key: '' },
  { value: '7+', key: '' },
]

/** Mana value. `7+` is the open-ended bucket and becomes `cmc>=7`. */
export const cmcFilter = {
  id: 'cmc' as const,
  labelKey: 'filter.cmc',
  ariaLabelKey: 'filter.cmcAria',
  glyph: '①',
  queryRank: 2,
  params: ['cmc'],
  decode: (raw) => ({ cmc: raw.cmc }),
  encode: (slice) => ({ cmc: slice.cmc || null }),
  isActive: (state) => state.cmc !== '',
  toQuery: (state) => {
    if (!state.cmc) return []
    return [state.cmc === '7+' ? 'cmc>=7' : `cmc=${state.cmc}`]
  },
  Control: CmcControl,
} satisfies FilterSpec

function CmcControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  const options: DropdownOption[] = CMC_OPTIONS.map((c) => ({
    value: c.value,
    label: c.key ? t(c.key) : c.value,
  }))
  return (
    <Dropdown
      className="w-full"
      value={state.cmc}
      onChange={(cmc) => onChange({ cmc })}
      options={options}
      ariaLabel={ariaLabel}
    />
  )
}
