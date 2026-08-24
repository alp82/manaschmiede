import { Pill } from '../../ui/Pill'
import { useT } from '../../../lib/i18n'
import { RARITIES, RARITY_KEYS, type Rarity } from '../../../lib/rarity'
import type { FilterControlProps, FilterSpec } from '../spec'

/**
 * URL codec for the rarity set.
 *
 * A rarity travels as its initial (`c` / `u` / `r` / `m`) so a three-rarity
 * selection costs four characters instead of twenty. The codes are derived from
 * `RARITIES` rather than tabulated, so the two cannot drift — which holds only
 * while the initials stay unique. `card-filters-registry.test.ts` asserts that.
 */
const RARITY_BY_CODE = new Map<string, Rarity>(RARITIES.map((r) => [r[0], r]))

export function decodeRarities(s: string): Set<Rarity> {
  const out = new Set<Rarity>()
  for (const ch of s.toLowerCase()) {
    const rarity = RARITY_BY_CODE.get(ch)
    if (rarity) out.add(rarity)
  }
  return out
}

export function encodeRarities(rarities: Set<Rarity>): string {
  return Array.from(rarities)
    .map((r) => r[0])
    .join('')
}

/**
 * Rarity. Selecting every rarity narrows nothing, so it emits no query
 * fragment — but it still counts as an active filter, matching what the user
 * sees in the bar.
 */
export const rarityFilter = {
  id: 'rarity' as const,
  labelKey: 'filter.rarity',
  ariaLabelKey: 'filter.rarity',
  glyph: '◆',
  queryRank: 4,
  params: ['rarity'],
  decode: (raw) => ({ rarities: decodeRarities(raw.rarity) }),
  encode: (slice) => ({ rarity: encodeRarities(slice.rarities ?? new Set()) || null }),
  isActive: (state) => state.rarities.size > 0,
  toQuery: (state) => {
    if (state.rarities.size === 0 || state.rarities.size >= RARITIES.length) return []
    return ['(' + Array.from(state.rarities).map((r) => `r:${r}`).join(' OR ') + ')']
  },
  Control: RarityControl,
} satisfies FilterSpec

function RarityControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()

  function toggle(rarity: Rarity) {
    const next = new Set(state.rarities)
    if (next.has(rarity)) next.delete(rarity)
    else next.add(rarity)
    onChange({ rarities: next })
  }

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {RARITIES.map((r) => (
        <Pill key={r} size="sm" selected={state.rarities.has(r)} onClick={() => toggle(r)}>
          {t(RARITY_KEYS[r])}
        </Pill>
      ))}
    </div>
  )
}
