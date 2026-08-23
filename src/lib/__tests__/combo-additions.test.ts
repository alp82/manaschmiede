/**
 * RED tests — comboToAdditions and buildReopenComboOpts do not exist yet.
 * They must be exported from src/lib/combo-additions.ts (M3 implementer creates it).
 *
 * Asserted signatures:
 *   comboToAdditions(combo: CoreCombo, existingCards: DeckCard[]): CardChange[]
 *   buildReopenComboOpts(intent: SectionFillIntent): GenerateCombosOptions
 *
 * NOT unit-testable (manual smoke in final review):
 *   - M3 reopen-combo UI
 *   - Convex suggestCombos.suggest call
 *   - ledger Apply/Discard integration
 */
import { describe, it, expect } from 'vitest'
import { comboToAdditions, buildReopenComboOpts } from '../combo-additions'
import type { CoreCombo } from '../wizard-state'
import type { DeckCard } from '../deck-utils'
import type { CardChange } from '../deck-chat-types'
import { sectionFillIntentFromDeck } from '../section-fill-intent'
import { emptyIntent } from '../deck-intent'
import type { DeckIntent } from '../deck-intent'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeScryfallCard(id: string): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: '',
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function makeResolvedComboCard(id: string): CoreCombo['cards'][number] {
  return { name: `Card ${id}`, scryfallId: id, scryfallCard: makeScryfallCard(id) }
}

function makeUnresolvedComboCard(name: string): CoreCombo['cards'][number] {
  return { name }
}

function makeCombo(cards: CoreCombo['cards']): CoreCombo {
  return { name: 'Test Combo', explanation: 'Test combo explanation', cards }
}

function makeDeckCard(id: string, quantity: number, locked?: boolean): DeckCard {
  const card: DeckCard = { scryfallId: id, quantity, zone: 'main' }
  if (locked) card.locked = true
  return card
}

// ─── comboToAdditions — TC-1: all-adds ────────────────────────────────────

describe('comboToAdditions - TC-1: all-adds', () => {
  const combo = makeCombo([makeResolvedComboCard('id-A'), makeResolvedComboCard('id-B')])
  const existingCards: DeckCard[] = []
  let result: CardChange[]

  it('returns exactly 2 entries for 2 resolved cards with empty existingCards', () => {
    result = comboToAdditions(combo, existingCards)
    expect(result).toHaveLength(2)
  })

  it('every entry has type === "added"', () => {
    result = comboToAdditions(combo, existingCards)
    for (const entry of result) {
      expect(entry.type).toBe('added')
    }
  })

  it('no entry has type === "removed"', () => {
    result = comboToAdditions(combo, existingCards)
    expect(result.every((e) => e.type !== 'removed')).toBe(true)
  })

  it('no entry has type === "changed"', () => {
    result = comboToAdditions(combo, existingCards)
    expect(result.every((e) => e.type !== 'changed')).toBe(true)
  })
})

// ─── comboToAdditions — TC-2: dedup existing ─────────────────────────────

describe('comboToAdditions - TC-2: dedup existing', () => {
  const combo = makeCombo([makeResolvedComboCard('id-A'), makeResolvedComboCard('id-B')])
  const existingCards: DeckCard[] = [makeDeckCard('id-A', 4)]

  it('returns exactly 1 entry when id-A already in existingCards', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result).toHaveLength(1)
  })

  it('the single entry is for id-B', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result[0].scryfallId).toBe('id-B')
  })

  it('no entry for id-A (no changed/quantity bump for already-present cards)', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result.find((e) => e.scryfallId === 'id-A')).toBeUndefined()
  })
})

// ─── comboToAdditions — TC-3: locked never removed (decision-4 guard) ─────

describe('comboToAdditions - TC-3: locked never removed', () => {
  const combo = makeCombo([makeResolvedComboCard('id-A')])
  const existingCards: DeckCard[] = [
    makeDeckCard('locked-X', 4, true),
    makeDeckCard('locked-Y', 3, true),
  ]

  it('no entry for locked-X', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result.find((e) => e.scryfallId === 'locked-X')).toBeUndefined()
  })

  it('no entry for locked-Y', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result.find((e) => e.scryfallId === 'locked-Y')).toBeUndefined()
  })

  it('no entry has type === "removed"', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result.every((e) => e.type !== 'removed')).toBe(true)
  })

  it('the only entry is id-A with type === "added"', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result).toHaveLength(1)
    expect(result[0].scryfallId).toBe('id-A')
    expect(result[0].type).toBe('added')
  })
})

// ─── comboToAdditions — TC-4: skip unresolved ─────────────────────────────

describe('comboToAdditions - TC-4: skip unresolved', () => {
  const combo = makeCombo([
    makeResolvedComboCard('id-A'),
    makeUnresolvedComboCard('Card B'),
  ])
  const existingCards: DeckCard[] = []

  it('returns exactly 1 entry (only the resolved card)', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result).toHaveLength(1)
  })

  it('the single entry is for id-A', () => {
    const result = comboToAdditions(combo, existingCards)
    expect(result[0].scryfallId).toBe('id-A')
  })

  it('no entry has undefined or null scryfallId', () => {
    const result = comboToAdditions(combo, existingCards)
    for (const entry of result) {
      expect(entry.scryfallId).toBeTruthy()
    }
  })
})

// ─── comboToAdditions — G3: quantity assertions ───────────────────────────────

describe('comboToAdditions - G3: quantity assertions (ADD_QUANTITY regression guard)', () => {
  const combo = makeCombo([makeResolvedComboCard('id-A'), makeResolvedComboCard('id-B')])
  const existingCards: DeckCard[] = []

  it('every emitted CardChange has newQuantity === 4', () => {
    const result = comboToAdditions(combo, existingCards)
    for (const entry of result) {
      expect(entry.newQuantity).toBe(4)
    }
  })

  it('every emitted CardChange has oldQuantity === 0', () => {
    const result = comboToAdditions(combo, existingCards)
    for (const entry of result) {
      expect(entry.oldQuantity).toBe(0)
    }
  })

  it('quantity holds when only one card emitted (dedup case)', () => {
    const dedupExisting: DeckCard[] = [makeDeckCard('id-A', 4)]
    const result = comboToAdditions(combo, dedupExisting)
    expect(result).toHaveLength(1)
    expect(result[0].newQuantity).toBe(4)
    expect(result[0].oldQuantity).toBe(0)
  })
})

// ─── buildReopenComboOpts — TC-5: no maybe / no seed ─────────────────────

describe('buildReopenComboOpts - TC-5: no maybe / no seed', () => {
  const intent: DeckIntent = {
    ...emptyIntent(),
    colors: { W: 'unselected', U: 'selected', B: 'selected', R: 'unselected', G: 'unselected' },
  }
  // fallbackColors [] — committed colors win
  const fillIntent = sectionFillIntentFromDeck(intent, [])

  it('opts.maybeColors deep-equals [] (empty array, not undefined, not populated)', () => {
    const opts = buildReopenComboOpts(fillIntent)
    expect(opts.maybeColors).toEqual([])
  })

  it('opts.pinnedCard is undefined (no seed on the reopen path)', () => {
    const opts = buildReopenComboOpts(fillIntent)
    expect(opts.pinnedCard).toBeUndefined()
  })

  it('opts.selectedColors conveys the committed colors (U+B)', () => {
    const opts = buildReopenComboOpts(fillIntent)
    expect(opts.selectedColors).toEqual(['U', 'B'])
  })

  it('opts.activeColors includes the committed colors (U+B)', () => {
    const opts = buildReopenComboOpts(fillIntent)
    expect(opts.activeColors).toContain('U')
    expect(opts.activeColors).toContain('B')
  })
})

// ─── buildReopenComboOpts — G4: ready:false path ──────────────────────────────

describe('buildReopenComboOpts - G4: ready:false path (empty fallback)', () => {
  /**
   * When `sectionFillIntentFromDeck(emptyIntent, [])` is constructed with NO
   * committed colors AND empty fallbackColors, `getFillColors()` returns
   * `{ ready: false }` — the M1 gate. `buildReopenComboOpts` must return the
   * empty fallback: activeColors=[], selectedColors=[], maybeColors=[], pinnedCard=undefined.
   */
  const emptyFillIntent = sectionFillIntentFromDeck(emptyIntent(), [])

  it('activeColors === [] when getFillColors().ready is false', () => {
    const opts = buildReopenComboOpts(emptyFillIntent)
    expect(opts.activeColors).toEqual([])
  })

  it('selectedColors === [] when getFillColors().ready is false', () => {
    const opts = buildReopenComboOpts(emptyFillIntent)
    expect(opts.selectedColors).toEqual([])
  })

  it('maybeColors === [] (no maybe loop on reopen path regardless)', () => {
    const opts = buildReopenComboOpts(emptyFillIntent)
    expect(opts.maybeColors).toEqual([])
  })

  it('pinnedCard is undefined (no seed on reopen path)', () => {
    const opts = buildReopenComboOpts(emptyFillIntent)
    expect(opts.pinnedCard).toBeUndefined()
  })
})
