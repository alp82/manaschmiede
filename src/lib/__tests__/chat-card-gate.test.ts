/**
 * RED tests — getChatCardRejection does not exist yet.
 * It must be exported from src/lib/card-validation.ts.
 *
 * Asserted signature:
 *   getChatCardRejection(card: ScryfallCard, filters: DeckFilters, isLocked: boolean): string | null
 *
 * Contract:
 *   - Returns null when isLocked === true (locked bypass, no gate)
 *   - Otherwise delegates to getFilterRejectionReason(card, filters)
 *     returning its string reason or null
 *
 * Decision 1 semantics (empty committed -> fallback, NOT never-reject):
 *   - filters.colors === ['W','U'] (from committed or fallback): off-color card rejected
 *   - filters.colors === [] (empty committed, no fallback): no color constraint -> null
 *
 * NOT unit-testable (noted here, not written):
 *   - legacy-deck panel pre-seed (manual UI)
 *   - inert-edit behavior (manual UI)
 *   - addCard-does-not-consult-gate (structural/code-review)
 */
import { describe, it, expect } from 'vitest'
import { getChatCardRejectionReason as getChatCardRejection } from '../card-validation'
import type { DeckFilters } from '../card-validation'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeCard(id: string, color_identity: string[]): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: 'Creature',
    oracle_text: '',
    color_identity,
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

const WU_FILTERS: DeckFilters = { colors: ['W', 'U'] }
const EMPTY_FILTERS: DeckFilters = { colors: [] }

// ─── committed filters {colors:['W','U']} ─────────────────────────────────

describe('getChatCardRejection — committed colors W and U', () => {
  it('card color_identity [R] -> non-null (rejected; reason references color)', () => {
    const result = getChatCardRejection(makeCard('bolt', ['R']), WU_FILTERS, false)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('string')
    // Reason should mention something about color
    expect(result!.toLowerCase()).toMatch(/color/)
  })

  it('card color_identity [U] (within allowed) -> null', () => {
    const result = getChatCardRejection(makeCard('counterspell', ['U']), WU_FILTERS, false)
    expect(result).toBeNull()
  })

  it('multicolor card [W,R] (R not in allowed) -> non-null', () => {
    const result = getChatCardRejection(makeCard('boros', ['W', 'R']), WU_FILTERS, false)
    expect(result).not.toBeNull()
  })

  it('multicolor card [W,U] (subset of allowed) -> null', () => {
    const result = getChatCardRejection(makeCard('azorious', ['W', 'U']), WU_FILTERS, false)
    expect(result).toBeNull()
  })

  it('colorless card [] -> null (colorless fits any color constraint)', () => {
    const result = getChatCardRejection(makeCard('artifact', []), WU_FILTERS, false)
    expect(result).toBeNull()
  })
})

// ─── isLocked === true bypass ─────────────────────────────────────────────

describe('getChatCardRejection — isLocked bypass', () => {
  it('isLocked true with off-color card [R] against {colors:[W,U]} -> null (bypassed)', () => {
    const result = getChatCardRejection(makeCard('bolt', ['R']), WU_FILTERS, true)
    expect(result).toBeNull()
  })

  it('isLocked true with any card -> null regardless of filters', () => {
    const result = getChatCardRejection(
      makeCard('bolt', ['R', 'G', 'B']),
      WU_FILTERS,
      true,
    )
    expect(result).toBeNull()
  })

  it('isLocked false (same off-color card) -> non-null (gate is active)', () => {
    const result = getChatCardRejection(makeCard('bolt', ['R']), WU_FILTERS, false)
    expect(result).not.toBeNull()
  })
})

// ─── Decision 1: empty committed => fallback resolved filters ─────────────
//
// When committed colors are empty and a fallback was provided, the caller
// must have already resolved the DeckFilters via deriveIntentFilters (which
// uses the fallback). The gate itself receives the resolved filters.
// These tests verify gate behavior given already-resolved filters.

describe('getChatCardRejection — Decision 1: fallback-resolved filters', () => {
  /**
   * Scenario: empty committed but fallback ['W','U'] was used to resolve filters.
   * deriveIntentFilters(emptyIntent, ['W','U']) -> { colors: ['W','U'] }.
   * Card ['R'] is not in ['W','U'] -> REJECTED.
   */
  it('filters resolved from empty committed + fallback [W,U]: card [R] (not in union) -> non-null', () => {
    // After deriveIntentFilters resolves with fallback, filters.colors = ['W','U']
    const resolvedFilters: DeckFilters = { colors: ['W', 'U'] }
    const result = getChatCardRejection(makeCard('bolt', ['R']), resolvedFilters, false)
    expect(result).not.toBeNull()
  })

  it('filters resolved from empty committed + fallback [W,U]: colorless [] -> null', () => {
    const resolvedFilters: DeckFilters = { colors: ['W', 'U'] }
    const result = getChatCardRejection(makeCard('artifact', []), resolvedFilters, false)
    expect(result).toBeNull()
  })

  it('filters resolved from empty committed + fallback [W,U]: card [U] (in union) -> null', () => {
    const resolvedFilters: DeckFilters = { colors: ['W', 'U'] }
    const result = getChatCardRejection(makeCard('counter', ['U']), resolvedFilters, false)
    expect(result).toBeNull()
  })

  /**
   * Scenario: truly no colors — empty committed, no fallback.
   * deriveIntentFilters(emptyIntent) -> { colors: [] }.
   * No color constraint applies; card ['R'] is allowed.
   */
  it('filters with colors:[] (empty committed, no fallback): card [R] -> null (no color constraint)', () => {
    const result = getChatCardRejection(makeCard('bolt', ['R']), EMPTY_FILTERS, false)
    expect(result).toBeNull()
  })

  it('filters with colors:[] : any color card -> null (truly unconstrained)', () => {
    const result = getChatCardRejection(makeCard('5c', ['W', 'U', 'B', 'R', 'G']), EMPTY_FILTERS, false)
    expect(result).toBeNull()
  })
})
