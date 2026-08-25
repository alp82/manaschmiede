/**
 * Scryfall query assembly for the card browser.
 *
 * Pure and React-free: hand it a decoded state and it returns the query string,
 * which is what makes the interesting half of the card browser testable at all.
 * Every filter contributes through its registry entry, so a new filter reaches
 * the query without touching this file.
 *
 * Colors are the deliberate exception. ALL vs ANY (`c>=wu` vs `(c:w OR c:u)`)
 * is a mode *between* values rather than a value, which no single-value filter
 * entry can express — so the color block keeps its own codec and its own
 * fragment right here, next to the assembly that consumes it.
 */
import { isManaColor, type ManaColor } from '../../lib/mana-colors'
import { FILTERS, filtersInQueryOrder } from './registry'
import type { ColorMode } from './params'
import type { FilterState } from './spec'

/** `"WU"` -> the two colors. Unknown letters are ignored. */
export function decodeColors(value: string): Set<ManaColor> {
  const out = new Set<ManaColor>()
  for (const ch of value.toUpperCase()) {
    if (isManaColor(ch)) out.add(ch)
  }
  return out
}

/** The inverse, in WUBRG-independent alphabetical order so the URL is stable. */
export function encodeColors(colors: Set<ManaColor>): string {
  return Array.from(colors).sort().join('')
}

function colorFragment(colors: Set<ManaColor>, mode: ColorMode): string {
  const chars = Array.from(colors).map((c) => c.toLowerCase())
  if (mode === 'any') {
    // Scryfall has no single-expression "any of" operator for colors, so we
    // emit a parenthesised OR chain.
    return '(' + chars.map((c) => `c:${c}`).join(' OR ') + ')'
  }
  // ALL mode → the card's own colors contain every selected color.
  return 'c>=' + chars.join('')
}

export interface CardQueryInput {
  /** Free text from the search box. Not a filter — always visible. */
  search: string
  colors: Set<ManaColor>
  colorMode: ColorMode
  filters: FilterState
}

export function buildScryfallQuery(input: CardQueryInput): string {
  const parts: string[] = []
  if (input.search) {
    const escaped = input.search.replace(/[()]/g, '')
    parts.push(`(${escaped} or o:${escaped})`)
  }
  if (input.colors.size > 0) parts.push(colorFragment(input.colors, input.colorMode))
  for (const filter of filtersInQueryOrder()) parts.push(...filter.toQuery(input.filters))
  return parts.join(' ')
}

/**
 * Whether anything besides the search box narrows the results.
 *
 * Drives "should we search at all" — an empty box plus one filter is still a
 * search. Reads every entry, so a new filter cannot be left out of it.
 */
export function hasAnyFilter(colors: Set<ManaColor>, filters: FilterState): boolean {
  return colors.size > 0 || FILTERS.some((f) => f.isActive(filters))
}
