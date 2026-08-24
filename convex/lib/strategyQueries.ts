/**
 * Free-text strategy → Scryfall query-fragment helpers.
 *
 * The step-3 combo generator lets the player describe their deck in free text
 * (e.g. "a Nightmare deck where opponents lose life"). A Haiku parse turns that
 * text into a handful of THEME-ONLY Scryfall fragments; these helpers clean the
 * model output and merge it with the trait-derived queries so on-theme cards
 * reach the candidate pool.
 *
 * Zero-dependency pure TypeScript so it can be imported from both convex/
 * (the parseStrategy action) and src/ (StepCoreCards + the unit test), mirroring
 * how convex/lib/intentContext.ts is shared. Adding imports here would drag the
 * Convex runtime into the node test, so keep this file dependency-free.
 */

/** Hard cap on strategy fragments — keeps the extra Scryfall round-trips small. */
export const MAX_STRATEGY_QUERIES = 3

/** Total candidate-query budget (strategy + trait) handed to the Scryfall loop. */
const MAX_TOTAL_QUERIES = 10

/** Fragments longer than this are almost certainly model noise, not a query. */
const MAX_FRAGMENT_LENGTH = 80

/**
 * Matches a whole scoping token the app applies itself (color / format / rarity
 * / budget), so the model's theme stays clean. Anchored start-to-end against a
 * single space-delimited token:
 *   - color:  c:..  c<=..  c>=..
 *   - format: f:..
 *   - rarity: r:..  r>=..
 *   - budget: usd / eur / tix with any comparator (:, <, <=, >, >=, =)
 */
const SCOPING_TOKEN =
  /^(?:c(?::|<=|>=)\S+|f:\S+|r(?::|>=)\S+|(?:usd|eur|tix)(?::|<=?|>=?|=)\S+)$/i

/**
 * Tokenize a fragment on whitespace while keeping double-quoted spans atomic, so
 * an oracle phrase like `o:"loses life"` is one token (its internal space is not
 * a split point). A naive `.split(/\s+/)` would shatter it into `o:"loses` and
 * `life"`, producing unbalanced-quote junk Scryfall rejects.
 */
function tokenizeQuoteAware(fragment: string): string[] {
  // A token is a run of either quoted spans ("...") or non-space characters.
  return fragment.match(/(?:"[^"]*"|\S)+/g) ?? []
}

/**
 * Strip the app-applied scoping tokens from one fragment, quote-aware. Returns
 * the surviving theme tokens rejoined with single spaces, or '' if nothing is
 * left (the fragment was only scoping tokens).
 */
function stripScopingTokens(fragment: string): string {
  return tokenizeQuoteAware(fragment)
    .filter((token) => !SCOPING_TOKEN.test(token))
    .join(' ')
}

/** Pull a JSON payload out of a ```json or bare ``` fence, or null if none. */
function extractFromFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

/**
 * Parse the model's raw text into a flat string[] of candidate fragments, or []
 * if the text is unusable. Tries bare JSON first, then a fenced block. Accepts
 * `{ "queries": string[] }` or a bare `string[]`; any other valid-JSON shape
 * yields []. Never throws.
 */
function parseCandidates(rawModelText: string): string[] {
  if (typeof rawModelText !== 'string' || rawModelText.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rawModelText)
  } catch {
    const fenced = extractFromFence(rawModelText)
    if (fenced === null) return []
    try {
      parsed = JSON.parse(fenced)
    } catch {
      return []
    }
  }

  let candidates: unknown
  if (Array.isArray(parsed)) {
    candidates = parsed
  } else if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'queries' in parsed &&
    Array.isArray((parsed as { queries: unknown }).queries)
  ) {
    candidates = (parsed as { queries: unknown[] }).queries
  } else {
    return []
  }

  return (candidates as unknown[]).filter(
    (item): item is string => typeof item === 'string',
  )
}

/**
 * Turn the model's raw text into <=3 clean, theme-only Scryfall query fragments.
 *
 * Pipeline: parse JSON (bare, then fenced) → keep only strings → drop
 * empty/whitespace-only, drop any fragment with a newline, drop any fragment
 * over 80 chars → strip app-applied scoping tokens quote-awarely (dropping
 * fragments left empty) → de-dupe (first wins) → cap at MAX_STRATEGY_QUERIES.
 * Returns [] for any unusable / non-string input. Never throws.
 */
export function extractStrategyQueries(rawModelText: string): string[] {
  const candidates = parseCandidates(rawModelText)
  const cleaned: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.trim() === '') continue
    if (candidate.includes('\n')) continue
    if (candidate.length > MAX_FRAGMENT_LENGTH) continue

    const stripped = stripScopingTokens(candidate).trim()
    if (stripped === '') continue
    if (seen.has(stripped)) continue

    seen.add(stripped)
    cleaned.push(stripped)
    if (cleaned.length >= MAX_STRATEGY_QUERIES) break
  }

  return cleaned
}

/**
 * Merge the strategy fragments with the trait-derived queries into the single
 * candidate list the Scryfall loop consumes. Strategy-first then trait, de-duped
 * (first occurrence wins), capped at MAX_TOTAL_QUERIES — ordering strategy first
 * guarantees the <=3 strategy queries are never evicted by the cap.
 */
export function assembleQueries(
  strategyQueries: string[],
  traitQueries: string[],
): string[] {
  return [...new Set([...strategyQueries, ...traitQueries])].slice(0, MAX_TOTAL_QUERIES)
}

/**
 * Scope the strategy fragments to the deck's colors, then merge them with the
 * already-scoped trait queries into the final candidate list.
 *
 * Each fragment is parenthesized before the color clause is appended. Scryfall
 * binds implicit AND tighter than OR, so the bare concatenation
 * `t:elf OR t:goblin` + ` c<=wu` reads as `t:elf OR (t:goblin c<=wu)` and the
 * left branch escapes the color scope. The fragments come from a Haiku parse of
 * the player's free text, so their shape is not under our control and the
 * grouping has to be forced here. `(t:elf) c<=wu` is equivalent to
 * `t:elf c<=wu`, so single-clause fragments keep their meaning.
 *
 * Assumes strategyQueries is already capped at MAX_STRATEGY_QUERIES upstream;
 * relies on assembleQueries for the strategy-first ordering + MAX_TOTAL_QUERIES
 * cap. An empty strategy yields a trait-only pool identical to today, and an
 * empty colorFilter appends nothing and so needs no grouping.
 */
export function buildStrategyTraitPool(
  strategyQueries: string[],
  traitQueries: string[],
  colorFilter: string,
): string[] {
  const scopedStrategy = strategyQueries.map((q) =>
    colorFilter === '' ? q : `(${q})${colorFilter}`,
  )
  return assembleQueries(scopedStrategy, traitQueries)
}
