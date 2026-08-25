/**
 * The card browser's URL contract, in one object.
 *
 * `CardSearch` feeds `browseParsers` to a single `useQueryStates`, so every
 * filter param is read and written atomically. `filterParsers` is the slice the
 * filter registry owns: each entry in `FILTERS` names the params it reads out
 * of this map, and clearing a filter nulls exactly those.
 *
 * Both param-value types are *derived* from the parsers rather than listed, so
 * a param can never exist in the type but be missing from the schema.
 */
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type Nullable,
  type inferParserType,
} from 'nuqs'

/**
 * Params owned by the filter registry.
 *
 * Declaration order is the order nuqs writes them into a fresh URL — keep new
 * params at the end rather than interleaving, so existing links keep their
 * shape.
 */
export const filterParsers = {
  type: parseAsString.withDefault(''),
  cmc: parseAsString.withDefault(''),
  rarity: parseAsString.withDefault(''),
  keyword: parseAsString.withDefault(''),
  bmin: parseAsInteger,
  bmax: parseAsInteger,
  pmin: parseAsInteger,
  pmax: parseAsInteger,
  tmin: parseAsInteger,
  tmax: parseAsInteger,
  set: parseAsString.withDefault(''),
}

/** ALL = card contains every selected color; ANY = at least one. */
export const COLOR_MODES = ['all', 'any'] as const

/**
 * The whole browse state. `q`, `colors` and `cmode` sit outside the registry on
 * purpose: free text is not a filter (it is always visible, never in the
 * picker), and the color block's ALL/ANY switch is an inter-value mode rather
 * than a filter value. `filters` records which filters the bar is showing.
 */
export const browseParsers = {
  q: parseAsString.withDefault(''),
  colors: parseAsString.withDefault(''),
  cmode: parseAsStringLiteral(COLOR_MODES).withDefault('all'),
  ...filterParsers,
  filters: parseAsString.withDefault(''),
}

export type BrowseParams = inferParserType<typeof browseParsers>
export type RawFilterParams = inferParserType<typeof filterParsers>
export type FilterParamName = keyof RawFilterParams
export type ColorMode = BrowseParams['cmode']

/**
 * A patch a filter may write. Narrower than the full browse patch: a filter
 * owns its own params and the `filters` list, never the search box or colors.
 */
export type FilterPatch = Partial<Nullable<RawFilterParams>> & {
  filters?: string | null
}
