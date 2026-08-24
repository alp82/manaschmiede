/**
 * Every card-browser filter, in picker order.
 *
 * This list is the only thing that knows how many filters there are. The picker
 * plates, the active-filter grid, the `filters` URL vocabulary, the decoded
 * state, the reset patches and the Scryfall query are all derived from it, so
 * adding a filter is: one entry file, one line here, one parser in `params.ts`,
 * one field in `FilterState`, and the i18n keys. Every one of those five is a
 * compile error when missed — the three that used to fail silently (a `useMemo`
 * dependency, a `hasFilters` disjunct, and a hand-copied name set) no longer
 * exist.
 */
import { typeFilter } from './entries/type'
import { cmcFilter } from './entries/cmc'
import { keywordFilter } from './entries/keyword'
import { rarityFilter } from './entries/rarity'
import { budgetFilter } from './entries/budget'
import { statsFilter } from './entries/stats'
import { setFilter } from './entries/set'
import { neutralFilterState, type FilterSpec, type FilterState } from './spec'
import type { FilterPatch, RawFilterParams } from './params'

const ENTRIES = [
  typeFilter,
  cmcFilter,
  keywordFilter,
  rarityFilter,
  budgetFilter,
  statsFilter,
  setFilter,
]

/** The `filters` URL param's vocabulary — derived, never listed. */
export type FilterId = (typeof ENTRIES)[number]['id']

export type FilterEntry = FilterSpec & { id: FilterId }

/** Picker order, and the order of the active-filter grid. */
export const FILTERS: readonly FilterEntry[] = ENTRIES

const BY_ID = new Map<string, FilterEntry>(FILTERS.map((f) => [f.id, f]))

/** Query-fragment order, which is not the picker order. See `FilterSpec`. */
const BY_QUERY_RANK: readonly FilterEntry[] = [...FILTERS].sort(
  (a, b) => a.queryRank - b.queryRank,
)

export function isFilterId(value: string): value is FilterId {
  return BY_ID.has(value)
}

export function filterById(id: FilterId): FilterEntry {
  return BY_ID.get(id)!
}

/** The registry in the order its fragments enter the Scryfall query. */
export function filtersInQueryOrder(): readonly FilterEntry[] {
  return BY_QUERY_RANK
}

/** URL params -> the decoded value of every filter. */
export function decodeFilterState(raw: RawFilterParams): FilterState {
  const state = neutralFilterState()
  for (const filter of FILTERS) Object.assign(state, filter.decode(raw))
  return state
}

/** The patch that returns one filter to neutral: every param it owns, nulled. */
export function filterResetPatch(id: FilterId): FilterPatch {
  const patch: FilterPatch = {}
  for (const param of filterById(id).params) patch[param] = null
  return patch
}

// ─── the `filters` param itself ───────────────────────────────────────
// Comma-separated filter ids, in the order the user added them. Unknown ids are
// dropped rather than rejected, so a link from an older build still opens.

export function decodeActiveFilters(value: string): Set<FilterId> {
  const out = new Set<FilterId>()
  if (!value) return out
  for (const part of value.split(',')) {
    if (isFilterId(part)) out.add(part)
  }
  return out
}

export function encodeActiveFilters(ids: Set<FilterId>): string | null {
  if (ids.size === 0) return null
  return Array.from(ids).join(',')
}

/** Adding a filter shows its control; the value stays at whatever the URL says. */
export function addFilterPatch(active: Set<FilterId>, id: FilterId): FilterPatch {
  const next = new Set(active)
  next.add(id)
  return { filters: encodeActiveFilters(next) }
}

/** Removing one hides the control *and* clears the params it owned. */
export function removeFilterPatch(active: Set<FilterId>, id: FilterId): FilterPatch {
  const next = new Set(active)
  next.delete(id)
  return { ...filterResetPatch(id), filters: encodeActiveFilters(next) }
}

/** Clearing hides every filter and clears every param they owned. */
export function clearFiltersPatch(active: Set<FilterId>): FilterPatch {
  const patch: FilterPatch = { filters: null }
  for (const id of active) Object.assign(patch, filterResetPatch(id))
  return patch
}
