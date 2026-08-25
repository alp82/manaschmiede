import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dropdown, type DropdownOption } from '../../ui/Dropdown'
import { useT } from '../../../lib/i18n'
import { setsListOptions } from '../../../lib/scryfall/queries'
import type { FilterControlProps, FilterSpec } from '../spec'

// Only set types a deckbuilder cares about. Scryfall also returns
// funny/memorabilia/token/alchemy/etc — we hide those because they'd bloat the
// dropdown with irrelevant printings.
const ALLOWED_SET_TYPES = new Set([
  'expansion',
  'core',
  'masters',
  'draft_innovation',
  'commander',
  'masterpiece',
])

/** Edition — a single Scryfall `s:` term. */
export const setFilter = {
  id: 'set' as const,
  labelKey: 'filter.set',
  ariaLabelKey: 'filter.set',
  glyph: '▣',
  queryRank: 7,
  params: ['set'],
  decode: (raw) => ({ setCode: raw.set }),
  encode: (slice) => ({ set: slice.setCode || null }),
  isActive: (state) => state.setCode !== '',
  toQuery: (state) => (state.setCode ? [`s:${state.setCode.toLowerCase()}`] : []),
  Control: SetControl,
} satisfies FilterSpec

/**
 * Owns its own `/sets` request. That is why the whole filter fits in one file —
 * and it means Scryfall is asked for the set list when this filter is added
 * rather than on every mount of the bar. The first open therefore shows one
 * request's worth of delay, after which the 24h cache serves it.
 */
function SetControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  const { data: setsData } = useQuery(setsListOptions())

  // Sort by release date desc so the most recent editions bubble to the top
  // (deckbuilders almost always want current sets first).
  const options: DropdownOption[] = useMemo(() => {
    const base: DropdownOption[] = [{ value: '', label: t('filter.allEditions') }]
    if (!setsData?.data) return base
    const filtered = setsData.data
      .filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital)
      .sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
      .map((s) => ({ value: s.code, label: `${s.name} — ${s.code.toUpperCase()}` }))
    return [...base, ...filtered]
  }, [setsData, t])

  return (
    <Dropdown
      className="w-full"
      value={state.setCode}
      onChange={(setCode) => onChange({ setCode })}
      options={options}
      ariaLabel={ariaLabel}
    />
  )
}
