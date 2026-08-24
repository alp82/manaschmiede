/**
 * Unit tests for buildStrategyTraitPool (convex/lib/strategyQueries.ts) and
 * colorCastableClause (convex/lib/intentContext.ts) — the two halves of "scope
 * the strategy fragments to the deck's colors".
 */
import { describe, it, expect } from 'vitest'
import {
  buildStrategyTraitPool,
  assembleQueries,
} from '../../../convex/lib/strategyQueries'
import { colorCastableClause } from '../../../convex/lib/intentContext'

// ─── buildStrategyTraitPool ───────────────────────────────────────────────────

describe('buildStrategyTraitPool', () => {
  it('TC-SP-01: scopes strategy with colorFilter, appends trait unscoped', () => {
    const result = buildStrategyTraitPool(
      ['t:nightmare', 'o:"loses life"'],
      ['o:destroy c:b'],
      ' c<=b',
    )
    expect(result).toEqual([
      '(t:nightmare) c<=b',
      '(o:"loses life") c<=b',
      'o:destroy c:b',
    ])
  })

  it('TC-SP-02: strategy query comes first, before trait queries', () => {
    const result = buildStrategyTraitPool(
      ['t:zombie'],
      ['t:creature c:b', 'o:graveyard c:b'],
      ' c<=b',
    )
    expect(result[0]).toBe('(t:zombie) c<=b')
    expect(result.indexOf('(t:zombie) c<=b')).toBeLessThan(
      result.indexOf('t:creature c:b'),
    )
  })

  it('TC-SP-03 (regression + parse-failure): empty strategy -> behaves as assembleQueries([], traits)', () => {
    const traits = ['t:creature c:b', 'o:destroy c:b']
    const result = buildStrategyTraitPool([], traits, ' c<=b')
    // No strategy scoping applied — traits passed through as-is
    expect(result).toEqual(['t:creature c:b', 'o:destroy c:b'])
    // Must equal a direct assembleQueries call with the same inputs
    expect(result).toEqual(assembleQueries([], traits))
  })

  it('TC-SP-04 (cap/order): 3 strategy + 9 trait capped at 10, strategy first', () => {
    const strategy = ['t:nightmare', 't:zombie', 't:vampire']
    const traits = [
      't:a c:b', 't:b c:b', 't:c c:b', 't:d c:b', 't:e c:b',
      't:f c:b', 't:g c:b', 't:h c:b', 't:i c:b',
    ]
    const result = buildStrategyTraitPool(strategy, traits, ' c<=b')
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('(t:nightmare) c<=b')
    expect(result[1]).toBe('(t:zombie) c<=b')
    expect(result[2]).toBe('(t:vampire) c<=b')
    expect(result).not.toContain('t:i c:b')
  })

  it('TC-SP-05 (dedup): scoped strategy + byte-identical trait -> appears exactly once', () => {
    // De-duplication is byte-exact, so a trait query only collides with a
    // strategy fragment once it is written in the same parenthesized form.
    const result = buildStrategyTraitPool(
      ['t:zombie'],
      ['(t:zombie) c<=b', 'o:graveyard c:b'],
      ' c<=b',
    )
    const count = result.filter((q) => q === '(t:zombie) c<=b').length
    expect(count).toBe(1)
    expect(result).toContain('o:graveyard c:b')
  })

  it('TC-SP-06 (empty colorFilter): appends nothing to strategy or trait', () => {
    const result = buildStrategyTraitPool(
      ['t:nightmare', 'o:"loses life"'],
      ['o:destroy'],
      '',
    )
    expect(result).toEqual(['t:nightmare', 'o:"loses life"', 'o:destroy'])
  })

  it('TC-SP-07 (empty traits): only scoped strategy queries returned', () => {
    const result = buildStrategyTraitPool(['t:nightmare'], [], ' c<=b')
    expect(result).toEqual(['(t:nightmare) c<=b'])
  })

  it('TC-SP-08 (both empty): returns []', () => {
    const result = buildStrategyTraitPool([], [], ' c<=b')
    expect(result).toEqual([])
  })

  it('TC-SP-09 (grouping): an OR fragment is parenthesized so the color clause scopes both branches', () => {
    const result = buildStrategyTraitPool(['t:elf OR t:goblin'], [], ' c<=wu')
    // Scryfall binds implicit AND tighter than OR, so the bare concatenation
    // 't:elf OR t:goblin c<=wu' reads as 't:elf OR (t:goblin c<=wu)' and lets
    // the left branch escape the color scope entirely.
    expect(result).toEqual(['(t:elf OR t:goblin) c<=wu'])
  })
})

// ─── colorCastableClause ──────────────────────────────────────────────────────

describe('colorCastableClause', () => {
  it('TC-CC-01: [\'W\',\'U\'] -> \' c<=wu\'', () => {
    expect(colorCastableClause(['W', 'U'])).toBe(' c<=wu')
  })

  it('TC-CC-02: [] -> \'\' (empty)', () => {
    expect(colorCastableClause([])).toBe('')
  })

  it('TC-CC-03: [\'B\'] -> \' c<=b\'', () => {
    expect(colorCastableClause(['B'])).toBe(' c<=b')
  })

  it('TC-CC-04: [\'W\',\'U\',\'B\',\'R\',\'G\'] -> \' c<=wubrg\'', () => {
    expect(colorCastableClause(['W', 'U', 'B', 'R', 'G'])).toBe(' c<=wubrg')
  })

  it('TC-CC-05: [\'W\',\'U\'] is NOT \' c:wu\' (guards against strict-clause wiring)', () => {
    expect(colorCastableClause(['W', 'U'])).not.toBe(' c:wu')
  })
})
