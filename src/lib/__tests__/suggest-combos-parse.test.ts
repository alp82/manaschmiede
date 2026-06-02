/**
 * RED tests — MAX_STRATEGY_QUERIES, extractStrategyQueries, and assembleQueries
 * do not exist yet. They must be exported from convex/lib/strategyQueries.ts.
 *
 * Import path: relative to this file's location in src/lib/__tests__/,
 * the convex module is at ../../../convex/lib/strategyQueries.
 * This mirrors how intent-context.test.ts imports from ../../../convex/lib/intentContext.
 *
 * Asserted signatures:
 *
 *   MAX_STRATEGY_QUERIES: number (= 3)
 *
 *   extractStrategyQueries(rawModelText: string): string[]
 *     - JSON.parse the text; on failure try ```json and bare ``` fence extraction
 *       then parse; on still-failure return [].
 *     - Accept {"queries": string[]} or a bare string[]; any other valid-JSON
 *       shape -> [].
 *     - Filter: drop empty/whitespace-only, drop any fragment containing a
 *       newline, drop any fragment >80 chars.
 *     - Strip scoping tokens (color c:/c<=/c>=, format f:, rarity r:/r>=,
 *       budget usd/eur/tix with any comparator) from each fragment using a
 *       QUOTE-AWARE approach (anchored regex, NOT a whitespace split) so a
 *       quoted oracle phrase with internal spaces like o:"loses life" survives
 *       intact.
 *     - If a fragment is only scoping tokens (nothing left after stripping)
 *       -> drop it.
 *     - De-dupe (first occurrence wins). Cap at MAX_STRATEGY_QUERIES.
 *     - NEVER throws; [] is the fallback (including when passed null/non-string).
 *
 *   assembleQueries(strategyQueries: string[], traitQueries: string[]): string[]
 *     - strategy-first, then trait, de-dupe (first wins), slice to 10.
 *     - The <=3 strategy queries must never be evicted by the cap.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_STRATEGY_QUERIES,
  extractStrategyQueries,
  assembleQueries,
} from '../../../convex/lib/strategyQueries'

// ─── MAX_STRATEGY_QUERIES ────────────────────────────────────────────────────

describe('MAX_STRATEGY_QUERIES', () => {
  it('equals 3', () => {
    expect(MAX_STRATEGY_QUERIES).toBe(3)
  })
})

// ─── extractStrategyQueries — well-formed inputs ─────────────────────────────

describe('extractStrategyQueries — well-formed inputs', () => {
  it('TC-01: {"queries":["t:nightmare","o:\\"loses life\\""]} -> exactly those two in order', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare', 'o:"loses life"'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare', 'o:"loses life"'])
  })

  it('TC-02: bare array ["t:nightmare","o:\\"loses life\\""] -> same two in order', () => {
    const raw = JSON.stringify(['t:nightmare', 'o:"loses life"'])
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare', 'o:"loses life"'])
  })

  it('TC-03: ```json fenced {"queries":["t:zombie"]} -> ["t:zombie"]', () => {
    const raw = '```json\n{"queries":["t:zombie"]}\n```'
    expect(extractStrategyQueries(raw)).toEqual(['t:zombie'])
  })

  it('TC-04: bare ``` fenced (no language tag) {"queries":["t:zombie"]} -> ["t:zombie"]', () => {
    const raw = '```\n{"queries":["t:zombie"]}\n```'
    expect(extractStrategyQueries(raw)).toEqual(['t:zombie'])
  })
})

// ─── extractStrategyQueries — malformed / edge inputs ────────────────────────

describe('extractStrategyQueries — malformed and edge inputs', () => {
  it('TC-05: malformed JSON -> []', () => {
    expect(extractStrategyQueries('{"queries": [broken')).toEqual([])
  })

  it('TC-06: empty string -> []', () => {
    expect(extractStrategyQueries('')).toEqual([])
  })

  it('TC-07: prose-only, no JSON -> []', () => {
    expect(extractStrategyQueries('Here are some suggestions for your deck!')).toEqual([])
  })

  it('TC-08: valid JSON but unrecognized shape {"result":["t:zombie"]} -> []', () => {
    expect(extractStrategyQueries('{"result":["t:zombie"]}')).toEqual([])
  })
})

// ─── extractStrategyQueries — count / content filtering ──────────────────────

describe('extractStrategyQueries — count and content filtering', () => {
  it('TC-09: >3 items -> sliced to 3 (first three, in order)', () => {
    const raw = JSON.stringify({
      queries: ['t:nightmare', 't:zombie', 't:vampire', 't:spirit'],
    })
    const result = extractStrategyQueries(raw)
    expect(result).toHaveLength(3)
    expect(result).toEqual(['t:nightmare', 't:zombie', 't:vampire'])
  })

  it('TC-10: item containing a newline -> dropped', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare', 't:zom\nbie', 't:vampire'] })
    // The newline item is dropped; remaining two kept
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare', 't:vampire'])
  })

  it('TC-11: item exactly 81 chars dropped, exactly 80 chars kept', () => {
    const char80 = 't:' + 'a'.repeat(78) // 2 + 78 = 80 chars
    const char81 = 't:' + 'a'.repeat(79) // 2 + 79 = 81 chars
    const raw = JSON.stringify({ queries: [char80, char81] })
    const result = extractStrategyQueries(raw)
    expect(result).toContain(char80)
    expect(result).not.toContain(char81)
  })

  it('TC-12: empty-string item -> dropped', () => {
    const raw = JSON.stringify({ queries: ['', 't:nightmare'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-12b: whitespace-only item -> dropped', () => {
    const raw = JSON.stringify({ queries: ['   ', 't:nightmare'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-13: duplicates -> de-duped (first occurrence kept, order preserved)', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare', 't:zombie', 't:nightmare'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare', 't:zombie'])
  })
})

// ─── extractStrategyQueries — scoping-token stripping ────────────────────────

describe('extractStrategyQueries — scoping-token stripping', () => {
  it('TC-14: "t:nightmare c<=b" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare c<=b'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-15: "t:nightmare c<=b f:modern" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare c<=b f:modern'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-16: "t:zombie f:modern" -> "t:zombie"', () => {
    const raw = JSON.stringify({ queries: ['t:zombie f:modern'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:zombie'])
  })

  it('TC-17: "t:nightmare usd<1" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare usd<1'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-18: "t:nightmare r:mythic" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare r:mythic'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-19: "t:nightmare r>=rare" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare r>=rare'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-21 CRITICAL: \'o:"loses life" c<=b\' -> \'o:"loses life"\' (quoted phrase with internal space survives)', () => {
    // A naive whitespace-split approach would break 'o:"loses life"' into
    // 'o:"loses' and 'life"', losing the quoted phrase. This test exists to
    // catch that exact failure mode.
    const raw = JSON.stringify({ queries: ['o:"loses life" c<=b'] })
    expect(extractStrategyQueries(raw)).toEqual(['o:"loses life"'])
  })

  it('TC-22 CRITICAL: \'o:"loses life" c<=b f:modern r:mythic\' -> \'o:"loses life"\' (all three scoping tokens stripped, quoted phrase preserved)', () => {
    const raw = JSON.stringify({ queries: ['o:"loses life" c<=b f:modern r:mythic'] })
    expect(extractStrategyQueries(raw)).toEqual(['o:"loses life"'])
  })

  it('TC-23: \'o:"loses life"\' (no scoping tokens) -> \'o:"loses life"\' unchanged', () => {
    const raw = JSON.stringify({ queries: ['o:"loses life"'] })
    expect(extractStrategyQueries(raw)).toEqual(['o:"loses life"'])
  })

  it('TC-24: "c<=b" (only a scoping token) -> [] (dropped after strip leaves nothing)', () => {
    const raw = JSON.stringify({ queries: ['c<=b'] })
    expect(extractStrategyQueries(raw)).toEqual([])
  })

  it('TC-25: "c<=b f:modern r:uncommon" -> [] (all scoping; dropped)', () => {
    const raw = JSON.stringify({ queries: ['c<=b f:modern r:uncommon'] })
    expect(extractStrategyQueries(raw)).toEqual([])
  })

  it('TC-28: budget eur token with comparator "t:nightmare eur<=5" -> "t:nightmare"', () => {
    const raw = JSON.stringify({ queries: ['t:nightmare eur<=5'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:nightmare'])
  })

  it('TC-29: bare color equality "t:zombie c:b" -> "t:zombie"', () => {
    const raw = JSON.stringify({ queries: ['t:zombie c:b'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:zombie'])
  })

  it('TC-30: color superset "t:dragon c>=r" -> "t:dragon"', () => {
    const raw = JSON.stringify({ queries: ['t:dragon c>=r'] })
    expect(extractStrategyQueries(raw)).toEqual(['t:dragon'])
  })
})

// ─── extractStrategyQueries — defensive / null safety ────────────────────────

describe('extractStrategyQueries — defensive inputs', () => {
  it('TC-26: null cast as string -> [] (no throw)', () => {
    // The function signature accepts string; callers may pass null in JS.
    // Cast to silence TS — the test exercises the runtime guard.
    expect(extractStrategyQueries(null as unknown as string)).toEqual([])
  })

  it('TC-27: ```json fence containing malformed JSON -> []', () => {
    const raw = '```json\n{"queries": [broken\n```'
    expect(extractStrategyQueries(raw)).toEqual([])
  })
})

// ─── assembleQueries ─────────────────────────────────────────────────────────

describe('assembleQueries', () => {
  it('3 strategy + 9 trait -> length 10, all 3 strategy present and first, 9th trait dropped', () => {
    const strategy = ['t:nightmare', 't:zombie', 't:vampire']
    const trait = ['t:a', 't:b', 't:c', 't:d', 't:e', 't:f', 't:g', 't:h', 't:i']
    const result = assembleQueries(strategy, trait)
    expect(result).toHaveLength(10)
    // All 3 strategy queries present
    expect(result).toContain('t:nightmare')
    expect(result).toContain('t:zombie')
    expect(result).toContain('t:vampire')
    // Strategy queries come first
    expect(result[0]).toBe('t:nightmare')
    expect(result[1]).toBe('t:zombie')
    expect(result[2]).toBe('t:vampire')
    // 9th trait (index 8, 't:i') dropped to respect cap of 10
    expect(result).not.toContain('t:i')
  })

  it('0 strategy + 11 trait -> first 10 trait in order', () => {
    const trait = ['t:a', 't:b', 't:c', 't:d', 't:e', 't:f', 't:g', 't:h', 't:i', 't:j', 't:k']
    const result = assembleQueries([], trait)
    expect(result).toHaveLength(10)
    expect(result).toEqual(['t:a', 't:b', 't:c', 't:d', 't:e', 't:f', 't:g', 't:h', 't:i', 't:j'])
    expect(result).not.toContain('t:k')
  })

  it('1 strategy + 2 trait -> all 3 kept (no truncation)', () => {
    const result = assembleQueries(['t:nightmare'], ['t:zombie', 't:vampire'])
    expect(result).toEqual(['t:nightmare', 't:zombie', 't:vampire'])
  })

  it('2 strategy + 8 trait (exactly 10) -> all kept', () => {
    const strategy = ['t:nightmare', 't:zombie']
    const trait = ['t:a', 't:b', 't:c', 't:d', 't:e', 't:f', 't:g', 't:h']
    const result = assembleQueries(strategy, trait)
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('t:nightmare')
    expect(result[1]).toBe('t:zombie')
  })

  it('duplicate in both strategy and trait -> strategy position wins, one copy, both joined', () => {
    // strategy=["t:nightmare"], trait=["t:nightmare","t:zombie"]
    // After de-dupe: ["t:nightmare","t:zombie"]
    const result = assembleQueries(['t:nightmare'], ['t:nightmare', 't:zombie'])
    expect(result).toEqual(['t:nightmare', 't:zombie'])
  })

  it('strategy=["t:nightmare"], trait=["t:nightmare"] -> ["t:nightmare"] (de-duped to one)', () => {
    const result = assembleQueries(['t:nightmare'], ['t:nightmare'])
    expect(result).toEqual(['t:nightmare'])
  })

  it('duplicates within trait only -> de-duped (first occurrence kept)', () => {
    // strategy=[], trait=["t:zombie","t:zombie","t:vampire"]
    const result = assembleQueries([], ['t:zombie', 't:zombie', 't:vampire'])
    expect(result).toEqual(['t:zombie', 't:vampire'])
  })
})
