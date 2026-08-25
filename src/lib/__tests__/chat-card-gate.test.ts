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
import { getIntentRejectionReason as getChatCardRejection, getFilterRejectionReason } from '../card-validation'
import type { DeckFilters } from '../card-validation'
import type { ScryfallCard } from '../scryfall/types'
import { BASIC_LAND_ID_BY_COLOR } from '../../../convex/lib/basicLands'
import { makeCard, makeBasicLand } from './card-fixtures'

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

// ─── Basic-land exemption (issue #13) ─────────────────────────────────────
//
// Budget and rarity filters express what the user wants to *buy*. Every basic
// land fails both (price ~$0, rarity common), so judging them made every chat
// request with a budget or rarity filter burn a guaranteed retry. Color still
// applies: an off-color basic is a real mistake.

describe('getChatCardRejection — basic lands bypass budget and rarity', () => {
  const RARE_ONLY: DeckFilters = { colors: ['G'], rarities: ['rare'] }
  const EXPENSIVE_ONLY: DeckFilters = { colors: ['G'], budgetMin: 5 }

  it('basic land under rarities:[rare] -> null (not rejected on rarity)', () => {
    const forest = makeBasicLand(BASIC_LAND_ID_BY_COLOR.G, 'Forest', ['G'])
    expect(getChatCardRejection(forest, RARE_ONLY, false)).toBeNull()
  })

  it('basic land under budgetMin:5 -> null (not rejected on price)', () => {
    const forest = makeBasicLand(BASIC_LAND_ID_BY_COLOR.G, 'Forest', ['G'])
    expect(getChatCardRejection(forest, EXPENSIVE_ONLY, false)).toBeNull()
  })

  it('basic land under budgetMax:0.01 -> null (not rejected on price)', () => {
    const forest = makeBasicLand(BASIC_LAND_ID_BY_COLOR.G, 'Forest', ['G'])
    expect(getChatCardRejection(forest, { colors: ['G'], budgetMax: 0.01 }, false)).toBeNull()
  })

  it('non-canonical printing of a basic is exempt too (matched on type line)', () => {
    const forest = makeBasicLand('some-other-printing', 'Forest', ['G'])
    expect(getChatCardRejection(forest, RARE_ONLY, false)).toBeNull()
  })

  it('off-color basic land is still rejected (color gate stays active)', () => {
    const island = makeBasicLand(BASIC_LAND_ID_BY_COLOR.U, 'Island', ['U'])
    const result = getChatCardRejection(island, RARE_ONLY, false)
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toMatch(/color/)
  })

  it('a non-land common is still rejected under rarities:[rare]', () => {
    const spell = makeCard('common-spell', ['G'])
    const result = getChatCardRejection(spell, RARE_ONLY, false)
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toMatch(/rarity/)
  })

  it('a nonbasic land is NOT exempt (only basics are mana-tax-free)', () => {
    const dual = makeCard('breeding-pool', ['G'], { type_line: 'Land — Forest Island' })
    const result = getChatCardRejection(dual, RARE_ONLY, false)
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toMatch(/rarity/)
  })
})

// The exemption lives in getFilterRejectionReason, so it also covers the
// section-fill preview gate and the combo generator, not just the chat path.

describe('getFilterRejectionReason — basic-land exemption is shared by all callers', () => {
  it('exempts a basic from rarity for callers that skip the locked bypass', () => {
    const forest = makeBasicLand(BASIC_LAND_ID_BY_COLOR.G, 'Forest', ['G'])
    expect(getFilterRejectionReason(forest, { colors: ['G'], rarities: ['mythic'] })).toBeNull()
  })

  it('exempts a basic from a budget floor for those callers too', () => {
    const forest = makeBasicLand(BASIC_LAND_ID_BY_COLOR.G, 'Forest', ['G'])
    expect(getFilterRejectionReason(forest, { colors: ['G'], budgetMin: 20 })).toBeNull()
  })

  it('still rejects an off-color basic', () => {
    const swamp = makeBasicLand(BASIC_LAND_ID_BY_COLOR.B, 'Swamp', ['B'])
    expect(getFilterRejectionReason(swamp, { colors: ['G'], rarities: ['mythic'] })).not.toBeNull()
  })
})
