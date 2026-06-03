/**
 * RED tests — extractSearchQueries relocated to convex/lib/cardPoolQueries.ts
 * does not exist yet. These tests will fail with "Failed to resolve import" until
 * the implementer creates that module. That is the intended red state.
 *
 * All regression assertions are grounded against the CURRENT implementation in
 * convex/generateDeck.ts lines 83-167, confirmed before writing these tests.
 *
 * Current colorFilter: ` c:${colors.join('')}` (strict equality, NOT c<=).
 * Removal query: `(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery)${colorFilter}`
 * Tribal format:  `t:creature t:${tribe}${colorFilter}`
 * Catch-all:      `t:creature${colorFilter}` — only when colorFilter truthy AND queries.length === 0
 * hasStrategy=false is the default; behavior identical to current generateDeck.ts.
 * hasStrategy=true: catch-all is SKIPPED; removal stays unconditional.
 */
import { describe, it, expect } from 'vitest'
import { extractSearchQueries, buildCombinedStrategy } from '../../../convex/lib/cardPoolQueries'

// ─── buildCombinedStrategy ────────────────────────────────────────────────────

describe('buildCombinedStrategy', () => {
  it('TC-BCS-01: both parts present -> joined with \'. \'', () => {
    expect(
      buildCombinedStrategy('nightmare deck, opponents lose life', 'add more zombies', 240),
    ).toBe('nightmare deck, opponents lose life. add more zombies')
  })

  it('TC-BCS-02: no customStrategy -> no leading \'. \'', () => {
    expect(buildCombinedStrategy(undefined, 'add some mill', 240)).toBe('add some mill')
  })

  it('TC-BCS-03: empty liveMessage -> no trailing \'. \'', () => {
    expect(buildCombinedStrategy('nightmare deck', '', 240)).toBe('nightmare deck')
  })

  it('TC-BCS-04: both empty -> \'\'', () => {
    expect(buildCombinedStrategy(undefined, '', 240)).toBe('')
  })

  it('TC-BCS-05: whitespace-only customStrategy is dropped by filter(Boolean)', () => {
    expect(buildCombinedStrategy('   ', 'live theme', 240)).toBe('live theme')
  })

  it('TC-BCS-06: live message capped at cap characters', () => {
    expect(
      buildCombinedStrategy('nightmare', 'x'.repeat(300), 240),
    ).toBe('nightmare. ' + 'x'.repeat(240))
  })
})

// ─── TC-CPQ-01: regression — hasStrategy=false includes catch-all ─────────────

describe('extractSearchQueries — regression (hasStrategy=false)', () => {
  it('TC-CPQ-01: (\'a red deck\', [\'R\'], false) contains catch-all and removal', () => {
    const result = extractSearchQueries('a red deck', ['R'], false)
    // Catch-all: colorFilter truthy, no theme/tribal matched this prompt
    expect(result).toContain('t:creature c:r')
    // Removal query — exact string from generateDeck.ts:163
    expect(result).toContain(
      '(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery) c:r',
    )
  })
})

// ─── TC-CPQ-02: suppress — hasStrategy=true skips catch-all ──────────────────

describe('extractSearchQueries — hasStrategy=true suppresses catch-all', () => {
  it('TC-CPQ-02: (\'a red deck\', [\'R\'], true) does NOT contain catch-all, removal stays', () => {
    const result = extractSearchQueries('a red deck', ['R'], true)
    expect(result).not.toContain('t:creature c:r')
    expect(result).toContain(
      '(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery) c:r',
    )
  })
})

// ─── TC-CPQ-03: removal present in both modes ─────────────────────────────────

describe('extractSearchQueries — removal unconditional', () => {
  it('TC-CPQ-03a: removal present when hasStrategy=false', () => {
    const result = extractSearchQueries('a red deck', ['R'], false)
    expect(result).toContain(
      '(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery) c:r',
    )
  })

  it('TC-CPQ-03b: removal present when hasStrategy=true', () => {
    const result = extractSearchQueries('a red deck', ['R'], true)
    expect(result).toContain(
      '(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery) c:r',
    )
  })
})

// ─── TC-CPQ-04: no colors -> [] ───────────────────────────────────────────────

describe('extractSearchQueries — no colors', () => {
  it('TC-CPQ-04: (\'some deck\', undefined) -> [] (no colorFilter, no removal, no catch-all)', () => {
    expect(extractSearchQueries('some deck', undefined)).toEqual([])
  })
})

// ─── TC-CPQ-05: tribal regression ─────────────────────────────────────────────

describe('extractSearchQueries — tribal', () => {
  it('TC-CPQ-05: (\'zombie deck\', [\'B\'], false) contains tribal query t:creature t:zombie c:b', () => {
    const result = extractSearchQueries('zombie deck', ['B'], false)
    expect(result).toContain('t:creature t:zombie c:b')
  })

  it('TC-CPQ-06: (\'elf zombie deck\', [\'G\'], false) -> elf tribal only, not zombie (first match wins)', () => {
    const result = extractSearchQueries('elf zombie deck', ['G'], false)
    // 'elf' precedes 'zombie' in tribalPatterns; loop breaks on first match
    expect(result).toContain('t:creature t:elf c:g')
    expect(result).not.toContain('t:creature t:zombie c:g')
  })
})

// ─── TC-CPQ-07: theme match gates catch-all ───────────────────────────────────

describe('extractSearchQueries — theme match gates catch-all', () => {
  it('TC-CPQ-07: (\'lifegain deck\', [\'W\'], false) -> lifegain theme present, catch-all absent', () => {
    const result = extractSearchQueries('lifegain deck', ['W'], false)
    // Exact lifegain query value from generateDeck.ts themes map + colorFilter
    expect(result).toContain('o:"gain life" c:w')
    // Theme matched so queries.length > 0 when catch-all is tested -> skipped
    expect(result).not.toContain('t:creature c:w')
  })
})

// ─── TC-CPQ-09..11: theme queries ─────────────────────────────────────────────

describe('extractSearchQueries — theme queries (exact strings)', () => {
  it('TC-CPQ-09: burn theme -> \'o:"damage to" t:instant c:r\'', () => {
    const result = extractSearchQueries('burn spells', ['R'], false)
    expect(result).toContain('o:"damage to" t:instant c:r')
  })

  it('TC-CPQ-10: graveyard theme -> \'o:graveyard c:b\'', () => {
    const result = extractSearchQueries('graveyard value', ['B'], false)
    expect(result).toContain('o:graveyard c:b')
  })

  it('TC-CPQ-11: aggro theme -> \'cmc<=3 t:creature c:r\'', () => {
    const result = extractSearchQueries('aggro deck', ['R'], false)
    expect(result).toContain('cmc<=3 t:creature c:r')
  })
})

// ─── TC-CPQ-12: tribal + suppress (hasStrategy=true) ─────────────────────────

describe('extractSearchQueries — tribal unaffected by hasStrategy=true', () => {
  it('TC-CPQ-12: (\'zombie deck\', [\'B\'], true) -> tribal present, catch-all absent', () => {
    const result = extractSearchQueries('zombie deck', ['B'], true)
    // Tribal query is not the catch-all — it is not suppressed
    expect(result).toContain('t:creature t:zombie c:b')
    // Catch-all (bare t:creature c:b) must not appear
    expect(result).not.toContain('t:creature c:b')
  })
})

// ─── TC-CPQ-13: no colors + hasStrategy=true ──────────────────────────────────

describe('extractSearchQueries — no colors with hasStrategy=true', () => {
  it('TC-CPQ-13: (\'a nice deck\', undefined, true) -> []', () => {
    expect(extractSearchQueries('a nice deck', undefined, true)).toEqual([])
  })
})

// ─── TC-CPQ-14: default arg (hasStrategy defaults to false) ───────────────────

describe('extractSearchQueries — default hasStrategy', () => {
  it('TC-CPQ-14: (\'a red deck\', [\'R\']) [no 3rd arg] -> catch-all present (default=false)', () => {
    const result = extractSearchQueries('a red deck', ['R'])
    expect(result).toContain('t:creature c:r')
  })
})

// ─── TC-CPQ-15: 4-query cap ────────────────────────────────────────────────────

describe('extractSearchQueries — 4-query cap', () => {
  it('TC-CPQ-15: multi-theme prompt -> result.length <= 4', () => {
    // Many theme keywords in a single prompt to trigger multiple theme matches
    const result = extractSearchQueries(
      'lifegain token graveyard burn aggro',
      ['W', 'R'],
      false,
    )
    expect(result.length).toBeLessThanOrEqual(4)
  })
})
