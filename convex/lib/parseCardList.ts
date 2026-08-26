/**
 * The one card-list-out-of-an-LLM-response parser.
 *
 * `jsonLadder.ts` owns getting *some* JSON out of a model response. This module
 * owns the step after it: turning that unknown value into the named lists and
 * scalars a caller asked for, dropping whatever is malformed. Four call sites
 * used to hand-roll that step and all four disagreed - on whether a bad
 * quantity dropped the entry or defaulted to one copy, on whether the 4-copy
 * clamp ran, on whether an empty name counted as a name.
 *
 * One rule set, several adapters, co-located so they cannot drift - the shape
 * `cardFilters.ts` uses. The adapters are the `entry` coercers exported below;
 * the call sites are `parseResponse` / `parseSectionResponse` (generateDeck.ts),
 * `parseComboResponse` (suggestCombos.ts) and `parseDeltaResponse`
 * (deltaPrompt.ts).
 *
 * Zero runtime imports (no ActionCtx / fetch), so node tests reach it from both
 * trees the same way cardPoolQueries.ts does. The two modules it does import,
 * jsonLadder.ts and deckRules.ts, are pure and zero-dependency themselves.
 */

import {
  ANY_OBJECT_PATTERN,
  UNPARSEABLE_RESPONSE_MESSAGE,
  climbJsonLadder,
  type JsonLadderRung,
} from './jsonLadder'
import { clampCopies } from './deckRules'

/** Thrown when the ladder yielded JSON, but not JSON of the requested shape. */
export const INVALID_FORMAT_MESSAGE = 'AI response has an invalid format'

/** How one named list inside the response is read. */
export interface ListSpec<T> {
  /**
   * Coerce one raw array element into a clean entry, or return null to drop it.
   * Use the `cardEntry` / `nameEntry` adapters below unless the shape is
   * genuinely local to one call site.
   */
  entry: (raw: unknown) => T | null
  /** Keep at most this many surviving entries. Unset means no cap. */
  max?: number
  /**
   * When true, a missing or non-array value for this key makes the whole
   * response invalid rather than an empty list.
   */
  required?: boolean
}

/** One `ListSpec` per key of `L`, each carrying its own element type. */
export type ListSpecs<L> = { [K in keyof L]: ListSpec<L[K]> }

export interface ParseCardListOptions<L> {
  /**
   * The lists to read, keyed by their JSON key. An object rather than an array
   * so a payload carrying two lists of two different element shapes (the delta
   * edit's `remove` and `add`) stays type-safe; the other call sites use it
   * degenerately with a single key.
   */
  lists: ListSpecs<L>
  /**
   * Third ladder rung - pull the first brace-delimited object out of
   * surrounding prose. Omit the field to leave the rung off (a prompt that asks
   * for JSON only gets no prose rung). Pass a key name to anchor the match on
   * `"key": [...]`, so a prose object cannot win. Pass null to accept any
   * object.
   */
  bareObjectAnchor?: string | null
  /**
   * Top-level string fields to read, mapped to the value used when the field is
   * absent, empty or not a string. `undefined` means "leave it undefined".
   */
  scalars?: Record<string, string | undefined>
  /**
   * Scalar keys that must resolve to a non-empty string. A response missing one
   * is invalid - this is what makes a deck without a name a parse failure.
   */
  requiredScalars?: string[]
  /**
   * `'throw'` surfaces the failure to the caller (an action that must tell the
   * user its request failed). `'empty'` degrades to empty lists and default
   * scalars and never throws (the delta path, where a no-op beats an error).
   */
  onFailure: 'throw' | 'empty'
}

export interface ParsedCardList<L> {
  lists: { [K in keyof L]: Array<L[K]> }
  scalars: Record<string, string | undefined>
  /** True when the response was unusable and `onFailure: 'empty'` swallowed it. */
  failed: boolean
  /**
   * The ladder rung that yielded JSON, or undefined when none did. Rung 3 means
   * the model wrapped its JSON in prose; the mechanical gate scores on it.
   */
  rung?: JsonLadderRung
}

/**
 * Parse a card-list response into the requested lists and scalars.
 *
 * Runs the shared JSON ladder, then coerces every configured list and scalar,
 * dropping malformed entries. Throws `UNPARSEABLE_RESPONSE_MESSAGE` (no rung
 * yielded JSON) or `INVALID_FORMAT_MESSAGE` (JSON of the wrong shape) under
 * `onFailure: 'throw'`; returns `failed: true` with empty lists under
 * `onFailure: 'empty'`.
 */
export function parseCardList<L extends Record<string, unknown>>(
  text: string,
  opts: ParseCardListOptions<L>,
): ParsedCardList<L> {
  try {
    // A non-string or blank body has no rung to climb. Checked here so
    // `parseCardList(null as unknown as string, ...)` fails like any other
    // unusable response instead of crashing on JSON.parse's null coercion.
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error(UNPARSEABLE_RESPONSE_MESSAGE)
    }
    const climbed = climbJsonLadder<unknown>(text, embeddedPattern(opts))
    if (climbed === null) throw new Error(UNPARSEABLE_RESPONSE_MESSAGE)
    return { ...coerce(climbed.value, opts), rung: climbed.rung }
  } catch (err) {
    if (opts.onFailure === 'throw') throw err
    return emptyResult(opts)
  }
}

/** Escape a literal for embedding in a RegExp source string. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function embeddedPattern<L>(opts: ParseCardListOptions<L>): RegExp | undefined {
  const anchor = opts.bareObjectAnchor
  if (anchor === undefined) return undefined
  if (anchor === null) return ANY_OBJECT_PATTERN
  return new RegExp(`\\{[\\s\\S]*"${escapeRegExp(anchor)}"\\s*:\\s*\\[[\\s\\S]*\\][\\s\\S]*\\}`)
}

function emptyResult<L extends Record<string, unknown>>(
  opts: ParseCardListOptions<L>,
): ParsedCardList<L> {
  const lists = {} as { [K in keyof L]: Array<L[K]> }
  for (const key of Object.keys(opts.lists) as Array<keyof L>) {
    lists[key] = []
  }
  return { lists, scalars: { ...(opts.scalars ?? {}) }, failed: true }
}

function coerce<L extends Record<string, unknown>>(
  parsed: unknown,
  opts: ParseCardListOptions<L>,
): ParsedCardList<L> {
  // A top-level array is not a card-list payload. Accepting one would let a
  // bare `[{...}]` chat response through with no deck name.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(INVALID_FORMAT_MESSAGE)
  }
  const obj = parsed as Record<string, unknown>

  const scalars: Record<string, string | undefined> = {}
  for (const [key, fallback] of Object.entries(opts.scalars ?? {})) {
    const value = obj[key]
    scalars[key] = isNonEmptyString(value) ? value : fallback
  }
  for (const key of opts.requiredScalars ?? []) {
    if (!isNonEmptyString(scalars[key])) throw new Error(INVALID_FORMAT_MESSAGE)
  }

  const lists = {} as { [K in keyof L]: Array<L[K]> }
  for (const key of Object.keys(opts.lists) as Array<keyof L>) {
    const spec = opts.lists[key]
    const raw = obj[key as string]
    if (!Array.isArray(raw)) {
      if (spec.required) throw new Error(INVALID_FORMAT_MESSAGE)
      lists[key] = []
      continue
    }
    const kept: Array<L[typeof key]> = []
    for (const item of raw) {
      if (spec.max !== undefined && kept.length >= spec.max) break
      const value = spec.entry(item)
      if (value !== null) kept.push(value)
    }
    lists[key] = kept
  }

  return { lists, scalars, failed: false }
}

// ── Entry adapters ──────────────────────────────────────────────────────────
//
// The shared coercion rules. A name is a non-empty string, everywhere; a
// quantity is a positive number, everywhere. What differs between call sites is
// only what happens to an entry that breaks a rule, and that is a parameter.

/** The one name rule: present, a string, and not empty. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** A card the model named, with the number of copies it asked for. */
export interface NamedCard {
  name: string
  quantity: number
}

export interface CardEntryOptions {
  /**
   * What to do with an entry whose `quantity` is missing or not a positive
   * number: `'drop'` discards the entry (a deck or section list, where a
   * quantity-less card is noise), `'one'` keeps it as a single copy (a delta
   * edit, where the named card is the point and the count is incidental).
   */
  invalidQuantity?: 'drop' | 'one'
  /** Apply the 4-copy rule, basic lands exempt. */
  clampCopies?: boolean
}

/**
 * Adapter for a `{ name, quantity }` entry. Returns null - meaning "drop this
 * entry" - for anything that is not an object with a non-empty name.
 */
export function cardEntry(options: CardEntryOptions = {}): (raw: unknown) => NamedCard | null {
  const invalidQuantity = options.invalidQuantity ?? 'drop'
  const clamp = options.clampCopies ?? false
  return (raw) => {
    if (raw === null || typeof raw !== 'object') return null
    const { name, quantity } = raw as { name?: unknown; quantity?: unknown }
    if (!isNonEmptyString(name)) return null
    const valid = typeof quantity === 'number' && quantity > 0
    if (!valid && invalidQuantity === 'drop') return null
    const copies = valid ? (quantity as number) : 1
    return { name, quantity: clamp ? clampCopies(name, copies) : copies }
  }
}

/** Adapter for a `{ name }` entry - a card referred to, not counted. */
export function nameEntry(raw: unknown): { name: string } | null {
  if (raw === null || typeof raw !== 'object') return null
  const { name } = raw as { name?: unknown }
  return isNonEmptyString(name) ? { name } : null
}
