/**
 * What one card-browser filter is.
 *
 * A filter used to be spread over 22 sites in 5 files — a picker label, an
 * order array, a name set, two prop pairs, a control switch, a reset switch, a
 * query clause, a `useMemo` dependency and a `hasFilters` disjunct — and three
 * of those failed silently when missed. One `FilterSpec` per filter replaces
 * all of it: the entry is the only place the filter is described, and
 * `registry.ts` derives everything else from the list of entries.
 */
import type { ComponentType } from 'react'
import type { TranslationKey } from '../../lib/i18n/types'
import type { Rarity } from '../../lib/rarity'
import type { FilterParamName, FilterPatch, RawFilterParams } from './params'

/**
 * Every filter's value, decoded. Each entry's `decode` owns exactly the fields
 * its params produce; `decodeFilterState` merges them.
 *
 * Colors are absent by design — they live beside this rather than in it,
 * because their ALL/ANY mode is not a filter value (see `params.ts`).
 */
export interface FilterState {
  cardType: string
  cmc: string
  rarities: Set<Rarity>
  keyword: string
  budgetMin: number | null
  budgetMax: number | null
  powerMin: number | null
  powerMax: number | null
  toughnessMin: number | null
  toughnessMax: number | null
  setCode: string
}

/** One filter's share of `FilterState`. A control always writes all of its own
 *  fields at once, which is what makes every URL write atomic. */
export type FilterSlice = Partial<FilterState>

/** The neutral state — what an empty URL decodes to. */
export function neutralFilterState(): FilterState {
  return {
    cardType: '',
    cmc: '',
    rarities: new Set(),
    keyword: '',
    budgetMin: null,
    budgetMax: null,
    powerMin: null,
    powerMax: null,
    toughnessMin: null,
    toughnessMax: null,
    setCode: '',
  }
}

export interface FilterControlProps {
  /** The whole decoded state; a control reads only its own fields. */
  state: FilterState
  /** Hand back this filter's complete slice — the bar turns it into a patch. */
  onChange: (slice: FilterSlice) => void
  /** Accessible name, already translated from the entry's `ariaLabelKey`. */
  ariaLabel: string
}

export interface FilterSpec {
  /** Stable id. This is the token stored in the `filters` URL param. */
  id: string
  /** Picker plate title and the caption above the active control. */
  labelKey: TranslationKey
  /** Accessible name for the control itself. */
  ariaLabelKey: TranslationKey
  /**
   * Decorative picker-plate glyph, rendered in the browser's serif/symbol
   * fallback — Cinzel doesn't cover these codepoints and that's fine.
   */
  glyph: string
  /** Whether the active-filter grid gives this one a double-wide cell. */
  fullWidth?: boolean
  /**
   * Where this filter's fragments sit in the assembled Scryfall query.
   *
   * Deliberately not the picker order: keeping the ranks the hand-written `if`
   * chain had means a URL that worked before still produces a byte-identical
   * Scryfall request, and therefore the same react-query cache key.
   */
  queryRank: number
  /** The params this filter owns. Removing it nulls exactly these. */
  params: readonly FilterParamName[]
  /** URL params -> this filter's slice of the decoded state. */
  decode(raw: RawFilterParams): FilterSlice
  /** The inverse: a slice from a control -> a URL patch. */
  encode(slice: FilterSlice): FilterPatch
  /** Whether the filter narrows the search at all. Drives `hasAnyFilter`. */
  isActive(state: FilterState): boolean
  /** This filter's Scryfall query fragments, or `[]` when neutral. */
  toQuery(state: FilterState): string[]
  Control: ComponentType<FilterControlProps>
}
