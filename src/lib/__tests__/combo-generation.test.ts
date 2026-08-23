/**
 * RED tests — comboMatchesKeywords was module-private with zero coverage.
 * It is now exported from src/lib/combo-generation.ts.
 *
 * Asserted signature:
 *   comboMatchesKeywords(
 *     cards: Array<{ scryfallCard?: ScryfallCard }>,
 *     oracleTerms: string[]
 *   ): boolean
 *
 * Semantics:
 *   - oracleTerms is empty  → always true (no oracle constraint)
 *   - term matches oracle_text substring (case-insensitive)
 *   - term matches keywords array entry (case-insensitive)
 *   - card with no scryfallCard is skipped
 *   - no card matches any term → false
 */
import { describe, it, expect } from 'vitest'
import { comboMatchesKeywords } from '../combo-generation'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeScryfallCard(
  id: string,
  oracle_text: string,
  keywords: string[],
): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: 'Creature',
    oracle_text,
    keywords,
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

// ─── C1: empty oracleTerms → always true ─────────────────────────────────────

describe('comboMatchesKeywords - C1: empty oracleTerms → always true', () => {
  it('returns true for empty cards array when oracleTerms is empty', () => {
    expect(comboMatchesKeywords([], [])).toBe(true)
  })

  it('returns true regardless of card content when oracleTerms is empty', () => {
    const cards = [
      { scryfallCard: makeScryfallCard('a', 'Flying', ['Flying']) },
      { scryfallCard: makeScryfallCard('b', 'Trample', ['Trample']) },
    ]
    expect(comboMatchesKeywords(cards, [])).toBe(true)
  })
})

// ─── C2: oracle_text substring match is case-insensitive ─────────────────────

describe('comboMatchesKeywords - C2: oracle_text match is case-insensitive', () => {
  it('matches when oracle_text contains term in matching case', () => {
    const cards = [{ scryfallCard: makeScryfallCard('a', 'flying', []) }]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(true)
  })

  it('matches when oracle_text is uppercase but term is lowercase', () => {
    const cards = [{ scryfallCard: makeScryfallCard('a', 'FLYING', []) }]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(true)
  })

  it('matches when term is uppercase and oracle_text is lowercase (both sides are lowercased)', () => {
    // The function lowercases both oracle_text and the term — fully case-insensitive
    const cards = [{ scryfallCard: makeScryfallCard('a', 'flying', []) }]
    expect(comboMatchesKeywords(cards, ['FLYING'])).toBe(true)
  })

  it('matches a substring within a longer oracle_text string', () => {
    const cards = [
      {
        scryfallCard: makeScryfallCard(
          'a',
          'Whenever a creature with flying enters the battlefield under your control, draw a card.',
          [],
        ),
      },
    ]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(true)
  })
})

// ─── C3: keywords array match is case-insensitive ────────────────────────────

describe('comboMatchesKeywords - C3: keywords array match is case-insensitive', () => {
  it('matches when keywords entry exactly equals term', () => {
    const cards = [{ scryfallCard: makeScryfallCard('a', '', ['Trample']) }]
    expect(comboMatchesKeywords(cards, ['trample'])).toBe(true)
  })

  it('matches when term is uppercase but keywords entry is mixed case (both sides are lowercased)', () => {
    // keywords are lowercased ('trample') and term 'TRAMPLE' is also lowercased — matches
    const cards = [{ scryfallCard: makeScryfallCard('a', '', ['Trample']) }]
    expect(comboMatchesKeywords(cards, ['TRAMPLE'])).toBe(true)
  })

  it('does NOT match when term is only a substring of a keyword entry', () => {
    // keywords is an exact-match array (lowercased), not substring
    const cards = [{ scryfallCard: makeScryfallCard('a', '', ['Trample']) }]
    expect(comboMatchesKeywords(cards, ['ramp'])).toBe(false)
  })
})

// ─── C4: card with no scryfallCard is skipped ────────────────────────────────

describe('comboMatchesKeywords - C4: missing scryfallCard is skipped', () => {
  it('returns false when only card has no scryfallCard', () => {
    const cards = [{ scryfallCard: undefined }]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(false)
  })

  it('skips card without scryfallCard but still matches via another card', () => {
    const cards = [
      { scryfallCard: undefined },
      { scryfallCard: makeScryfallCard('b', 'flying', []) },
    ]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(true)
  })

  it('returns false when all cards have no scryfallCard', () => {
    const cards = [{ scryfallCard: undefined }, { scryfallCard: undefined }]
    expect(comboMatchesKeywords(cards, ['flying'])).toBe(false)
  })
})

// ─── C5: no card matches any term → false ────────────────────────────────────

describe('comboMatchesKeywords - C5: no match → false', () => {
  it('returns false when no card contains any term in oracle_text or keywords', () => {
    const cards = [
      { scryfallCard: makeScryfallCard('a', 'Trample', ['Trample']) },
      { scryfallCard: makeScryfallCard('b', 'Haste', ['Haste']) },
    ]
    expect(comboMatchesKeywords(cards, ['flying', 'reach'])).toBe(false)
  })

  it('returns false for empty cards array when oracleTerms is non-empty', () => {
    expect(comboMatchesKeywords([], ['flying'])).toBe(false)
  })
})
