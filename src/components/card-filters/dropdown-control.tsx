/**
 * The Control every single-choice filter wants.
 *
 * Card type, mana value and keyword are the same control three times: translate
 * a fixed option table, then write one string field. Spelling that out per entry
 * made the copy an entry author would reach for when adding a fourth, so it
 * lives here instead and each entry supplies only what differs - its field and
 * its options.
 *
 * The set filter is deliberately not built on this: its options come from a
 * Scryfall query rather than a table, so it owns its own control.
 */
import type { ComponentType } from 'react'
import { Dropdown, type DropdownOption } from '../ui/Dropdown'
import { useT } from '../../lib/i18n'
import type { TranslationKey } from '../../lib/i18n/types'
import type { FilterControlProps, FilterState } from './spec'

/** The fields a dropdown can drive: the string-valued half of `FilterState`. */
type StringField = {
  [K in keyof FilterState]: FilterState[K] extends string ? K : never
}[keyof FilterState]

/**
 * An option's label comes from the catalogue, except where the value is already
 * the label - the mana values 0 to 6 need no translating, and inventing a key
 * per numeral would be catalogue noise.
 */
export interface DropdownChoice {
  value: string
  key: TranslationKey | ''
}

export function dropdownControl(
  field: StringField,
  choices: readonly DropdownChoice[],
): ComponentType<FilterControlProps> {
  return function DropdownFilterControl({ state, onChange, ariaLabel }) {
    const t = useT()
    const options: DropdownOption[] = choices.map((choice) => ({
      value: choice.value,
      label: choice.key ? t(choice.key) : choice.value,
    }))
    return (
      <Dropdown
        className="w-full"
        value={state[field]}
        onChange={(value) => onChange({ [field]: value })}
        options={options}
        ariaLabel={ariaLabel}
      />
    )
  }
}
