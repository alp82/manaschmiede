import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_LAND_COUNT,
  DECK_SHAPE_PROMPT_RULES,
  DEFAULT_LAND_COUNT,
  LAND_COUNT_RANGE,
  fixingLandCountForColors,
  MAX_AVERAGE_MANA_VALUE,
  MAX_COPIES,
  SPELL_COUNT_RANGE,
  TARGET_DECK_SIZE,
  type DeckRuleEntry,
  checkLandCount,
  clampCopies,
  enforceDeck,
  isAverageManaValueTooHigh,
  landCountForArchetype,
  padKeysForColors,
  splitEvenly,
  totalCopies,
} from '../lib/deckRules'

/**
 * Coverage for the shared deck-construction rules. Both trees enforce "a deck
 * is exactly 60 cards" through this module, so the two trim policies and the
 * one pad formula are pinned here rather than at each adapter.
 *
 * The module never looks inside a key: the server works in card names, the
 * client in Scryfall ids. These tests use short opaque strings to keep that
 * honest.
 */

/** Colour -> pad key, standing in for a name map on the server or an id map on the client. */
const BASIC_BY_COLOR: Record<string, string> = {
  W: 'plains',
  U: 'island',
  B: 'swamp',
  R: 'mountain',
  G: 'forest',
}
const basicForColor = (color: string): string | undefined => BASIC_BY_COLOR[color.toUpperCase()]
const BASICS = new Set(Object.values(BASIC_BY_COLOR))
const isBasic = (key: string) => BASICS.has(key)

/** Build `count` distinct singletons named `prefix0..prefixN`. */
function singletons(count: number, prefix = 'spell'): DeckRuleEntry[] {
  return Array.from({ length: count }, (_, i) => ({ key: `${prefix}${i}`, quantity: 1 }))
}

function quantityOf(entries: DeckRuleEntry[], key: string): number {
  return entries.find((e) => e.key === key)?.quantity ?? 0
}

describe('splitEvenly', () => {
  it('splits a total evenly across the slots', () => {
    expect(splitEvenly(6, ['a', 'b', 'c'])).toEqual([
      { slot: 'a', quantity: 2 },
      { slot: 'b', quantity: 2 },
      { slot: 'c', quantity: 2 },
    ])
  })

  it('gives the remainder to the leading slots, in order', () => {
    expect(splitEvenly(3, ['a', 'b'])).toEqual([
      { slot: 'a', quantity: 2 },
      { slot: 'b', quantity: 1 },
    ])
  })

  it('drops slots that would get nothing', () => {
    expect(splitEvenly(1, ['a', 'b'])).toEqual([{ slot: 'a', quantity: 1 }])
  })

  it('returns nothing for an empty slot list or a non-positive total', () => {
    expect(splitEvenly(5, [])).toEqual([])
    expect(splitEvenly(0, ['a'])).toEqual([])
    expect(splitEvenly(-3, ['a'])).toEqual([])
  })
})

describe('padKeysForColors', () => {
  it('maps colour letters to pad keys, keeping the given order', () => {
    expect(padKeysForColors(['R', 'W'], basicForColor)).toEqual(['mountain', 'plains'])
  })

  it('accepts lower-case colour letters', () => {
    expect(padKeysForColors(['u'], basicForColor)).toEqual(['island'])
  })

  it('collapses a repeated colour to one key', () => {
    expect(padKeysForColors(['G', 'G'], basicForColor)).toEqual(['forest'])
  })

  it('drops colour letters that name no basic land', () => {
    expect(padKeysForColors(['C', 'R'], basicForColor)).toEqual(['mountain'])
  })

  it('falls back to green when no colour resolves', () => {
    expect(padKeysForColors([], basicForColor)).toEqual(['forest'])
    expect(padKeysForColors(['C'], basicForColor)).toEqual(['forest'])
  })
})

describe('totalCopies', () => {
  it('sums the quantities', () => {
    expect(totalCopies([{ key: 'a', quantity: 4 }, { key: 'b', quantity: 2 }])).toBe(6)
  })

  it('is zero for an empty deck', () => {
    expect(totalCopies([])).toBe(0)
  })
})

describe('clampCopies', () => {
  it('caps a non-basic at MAX_COPIES', () => {
    expect(clampCopies('Lightning Bolt', 9)).toBe(MAX_COPIES)
  })

  it('leaves a basic land alone', () => {
    expect(clampCopies('Forest', 24)).toBe(24)
  })
})

describe('enforceDeck — shared shaping', () => {
  it('merges duplicate keys into one entry', () => {
    const deck = enforceDeck(
      [
        { key: 'elves', quantity: 2 },
        { key: 'elves', quantity: 2 },
        { key: 'forest', quantity: 56 },
      ],
      { trimPolicy: 'rebuild', isBasic, basicForColor },
    )
    expect(deck.filter((e) => e.key === 'elves')).toHaveLength(1)
    expect(quantityOf(deck, 'elves')).toBe(4)
  })

  it('returns a deck of exactly TARGET_DECK_SIZE cards', () => {
    const deck = enforceDeck(singletons(70), {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
    })
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
  })

  it('does not mutate the entries it was given', () => {
    const entries: DeckRuleEntry[] = [{ key: 'bolt', quantity: 9 }]
    enforceDeck(entries, { trimPolicy: 'rebuild', isBasic, basicForColor })
    expect(entries).toEqual([{ key: 'bolt', quantity: 9 }])
  })
})

describe('enforceDeck — padding', () => {
  it('pads across every deck colour, remainder to the first', () => {
    const deck = enforceDeck([{ key: 'helix', quantity: 3 }], {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
      colors: ['R', 'W'],
    })
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'mountain')).toBe(29)
    expect(quantityOf(deck, 'plains')).toBe(28)
  })

  it('adds to a basic the deck already runs instead of a second entry', () => {
    const deck = enforceDeck(
      [
        { key: 'elves', quantity: 4 },
        { key: 'forest', quantity: 6 },
      ],
      { trimPolicy: 'rebuild', isBasic, basicForColor, colors: ['G'] },
    )
    expect(deck.filter((e) => e.key === 'forest')).toHaveLength(1)
    expect(quantityOf(deck, 'forest')).toBe(56)
  })

  it('pads with green when the deck declares no colour', () => {
    const deck = enforceDeck([{ key: 'elves', quantity: 4 }], {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
    })
    expect(quantityOf(deck, 'forest')).toBe(56)
  })

  it('pads a mono-colour deck with that colour, not green', () => {
    const deck = enforceDeck([{ key: 'brainstorm', quantity: 4 }], {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
      colors: ['U'],
    })
    expect(quantityOf(deck, 'island')).toBe(56)
    expect(quantityOf(deck, 'forest')).toBe(0)
  })
})

describe("enforceDeck — trimPolicy 'rebuild'", () => {
  const LANDS = new Set(['duals', 'crag'])
  const isLand = (key: string) => isBasic(key) || LANDS.has(key)

  it('clamps a non-basic to MAX_COPIES; the model list is untrusted', () => {
    const deck = enforceDeck(
      [
        { key: 'bolt', quantity: 9 },
        { key: 'mountain', quantity: 51 },
      ],
      { trimPolicy: 'rebuild', isBasic, basicForColor },
    )
    expect(quantityOf(deck, 'bolt')).toBe(MAX_COPIES)
  })

  it('leaves a basic land above MAX_COPIES alone', () => {
    const deck = enforceDeck(
      [
        { key: 'forest', quantity: 56 },
        { key: 'elves', quantity: 4 },
      ],
      { trimPolicy: 'rebuild', isBasic, basicForColor },
    )
    expect(quantityOf(deck, 'forest')).toBe(56)
  })

  it('shrinks spells before any land', () => {
    const deck = enforceDeck(
      [
        { key: 'bolt', quantity: 4 },
        { key: 'duals', quantity: 4 },
        { key: 'crag', quantity: 4 },
        { key: 'mountain', quantity: 4 },
        { key: 'guide', quantity: 4 },
        { key: 'forest', quantity: 46 },
      ],
      { trimPolicy: 'rebuild', isBasic, isLand, basicForColor },
    )
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'duals')).toBe(4)
    expect(quantityOf(deck, 'crag')).toBe(4)
    expect(quantityOf(deck, 'mountain')).toBe(4)
    expect(quantityOf(deck, 'bolt')).toBe(1)
    expect(quantityOf(deck, 'guide')).toBe(1)
  })

  it('deletes whole entries once every card sits at one copy', () => {
    const deck = enforceDeck(singletons(70), {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
    })
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(deck).toHaveLength(60)
  })

  it('deletes the smallest surviving stack first, not the one it just shrank', () => {
    const deck = enforceDeck([{ key: 'bolt', quantity: 4 }, ...singletons(60)], {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
    })
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'bolt')).toBe(1)
  })

  it('deletes singleton spells before singleton lands', () => {
    const deck = enforceDeck(
      [...singletons(62), { key: 'duals', quantity: 1 }, { key: 'mountain', quantity: 1 }],
      { trimPolicy: 'rebuild', isBasic, isLand, basicForColor },
    )
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'duals')).toBe(1)
    expect(quantityOf(deck, 'mountain')).toBe(1)
  })

  it('never trims a locked card below its locked quantity', () => {
    const deck = enforceDeck(
      [
        { key: 'elves', quantity: 4 },
        { key: 'mystic', quantity: 4 },
        { key: 'forest', quantity: 60 },
      ],
      {
        trimPolicy: 'rebuild',
        isBasic,
        basicForColor,
        locked: new Set(['elves']),
        lockedFloor: () => 4,
      },
    )
    expect(quantityOf(deck, 'elves')).toBe(4)
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
  })

  it('trims a locked card down to its locked quantity as a last resort', () => {
    const floors: Record<string, number> = { elves: 2, forest: 58 }
    const deck = enforceDeck(
      [
        { key: 'elves', quantity: 4 },
        { key: 'forest', quantity: 58 },
      ],
      {
        trimPolicy: 'rebuild',
        isBasic,
        basicForColor,
        locked: new Set(['elves', 'forest']),
        lockedFloor: (key) => floors[key],
      },
    )
    expect(quantityOf(deck, 'elves')).toBe(2)
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
  })

  it('never deletes a locked card outright, even if that leaves the deck oversized', () => {
    const entries = singletons(70, 'locked')
    const deck = enforceDeck(entries, {
      trimPolicy: 'rebuild',
      isBasic,
      basicForColor,
      locked: new Set(entries.map((e) => e.key)),
      lockedFloor: () => 1,
    })
    expect(totalCopies(deck)).toBe(70)
  })
})

describe("enforceDeck — trimPolicy 'delta'", () => {
  it('sheds a basic land copy before any spell', () => {
    const deck = enforceDeck(
      [
        ...Array.from({ length: 14 }, (_, i) => ({ key: `card${i}`, quantity: 4 })),
        { key: 'extra', quantity: 3 },
        { key: 'forest', quantity: 2 },
      ],
      { trimPolicy: 'delta', isBasic, basicForColor, colors: ['G'] },
    )
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'forest')).toBe(1)
    expect(quantityOf(deck, 'extra')).toBe(3)
  })

  it('sheds the last unlocked card when no basic land is trimmable', () => {
    const deck = enforceDeck(
      [
        ...Array.from({ length: 14 }, (_, i) => ({ key: `card${i}`, quantity: 4 })),
        { key: 'last', quantity: 5 },
      ],
      { trimPolicy: 'delta', isBasic, basicForColor, colors: ['G'] },
    )
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'last')).toBe(4)
  })

  it('does not clamp copies; the deck is the user\'s own, already capped at the add site', () => {
    const deck = enforceDeck(
      [
        { key: 'fivestack', quantity: 5 },
        { key: 'forest', quantity: 55 },
      ],
      { trimPolicy: 'delta', isBasic, basicForColor, colors: ['G'] },
    )
    expect(quantityOf(deck, 'fivestack')).toBe(5)
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
  })

  it('never sheds a locked card', () => {
    const deck = enforceDeck(
      [
        ...Array.from({ length: 14 }, (_, i) => ({ key: `card${i}`, quantity: 4 })),
        { key: 'pinned', quantity: 5 },
      ],
      {
        trimPolicy: 'delta',
        isBasic,
        basicForColor,
        colors: ['G'],
        locked: new Set(['pinned']),
      },
    )
    expect(quantityOf(deck, 'pinned')).toBe(5)
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'card13')).toBe(3)
  })

  it('returns an exactly-60 deck unchanged', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ key: `card${i}`, quantity: 4 }))
    const deck = enforceDeck(entries, {
      trimPolicy: 'delta',
      isBasic,
      basicForColor,
      colors: ['G'],
    })
    expect(deck).toEqual(entries)
  })

  it('pads an undersized deck across its colours, remainder to the first', () => {
    const deck = enforceDeck(
      [
        ...Array.from({ length: 14 }, (_, i) => ({ key: `card${i}`, quantity: 4 })),
        { key: 'odd', quantity: 1 },
      ],
      { trimPolicy: 'delta', isBasic, basicForColor, colors: ['R', 'G'] },
    )
    expect(totalCopies(deck)).toBe(TARGET_DECK_SIZE)
    expect(quantityOf(deck, 'mountain')).toBe(2)
    expect(quantityOf(deck, 'forest')).toBe(1)
  })
})

/**
 * The deck-shape half of the module (issue #45). The point of gathering the
 * land band, the archetype table and the curve ceiling here is that the three
 * adapters cannot name different numbers, so these tests check the adapters
 * against the table rather than restating the numbers.
 */
describe('deck shape', () => {
  describe('the land table', () => {
    it('keeps every archetype inside the band', () => {
      for (const [archetype, count] of Object.entries(ARCHETYPE_LAND_COUNT)) {
        expect(count, archetype).toBeGreaterThanOrEqual(LAND_COUNT_RANGE.min)
        expect(count, archetype).toBeLessThanOrEqual(LAND_COUNT_RANGE.max)
      }
    })

    it('keeps the default inside the band too', () => {
      expect(DEFAULT_LAND_COUNT).toBeGreaterThanOrEqual(LAND_COUNT_RANGE.min)
      expect(DEFAULT_LAND_COUNT).toBeLessThanOrEqual(LAND_COUNT_RANGE.max)
    })

    it('falls back to the default for an unknown or missing archetype', () => {
      expect(landCountForArchetype('nothing-like-this')).toBe(DEFAULT_LAND_COUNT)
      expect(landCountForArchetype(undefined)).toBe(DEFAULT_LAND_COUNT)
    })

    it('reads a listed archetype straight off the table', () => {
      expect(landCountForArchetype('aggro')).toBe(ARCHETYPE_LAND_COUNT.aggro)
      expect(landCountForArchetype('control')).toBe(ARCHETYPE_LAND_COUNT.control)
    })
  })

  describe('the fixing-lands split', () => {
    it('gives a mono-color deck nothing to fix', () => {
      expect(fixingLandCountForColors(1)).toBe(0)
      expect(fixingLandCountForColors(0)).toBe(0)
    })

    it('grows with the color count', () => {
      const counts = [2, 3, 4, 5].map(fixingLandCountForColors)
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeGreaterThan(counts[i - 1])
      }
    })

    it('always leaves room for basics inside the band', () => {
      for (let colorCount = 0; colorCount <= 5; colorCount++) {
        expect(fixingLandCountForColors(colorCount), `${colorCount}C`).toBeLessThan(
          LAND_COUNT_RANGE.min,
        )
      }
    })
  })

  describe('the derived spell band', () => {
    it('is whatever the land band leaves of a full deck', () => {
      expect(SPELL_COUNT_RANGE.min + LAND_COUNT_RANGE.max).toBe(TARGET_DECK_SIZE)
      expect(SPELL_COUNT_RANGE.max + LAND_COUNT_RANGE.min).toBe(TARGET_DECK_SIZE)
    })
  })

  describe('the balance-report adapter', () => {
    it('judges a land count against the band', () => {
      expect(checkLandCount(LAND_COUNT_RANGE.min - 1)).toBe('too-few')
      expect(checkLandCount(LAND_COUNT_RANGE.min)).toBe('ok')
      expect(checkLandCount(DEFAULT_LAND_COUNT)).toBe('ok')
      expect(checkLandCount(LAND_COUNT_RANGE.max)).toBe('ok')
      expect(checkLandCount(LAND_COUNT_RANGE.max + 1)).toBe('too-many')
    })

    it('trips the curve warning only above the ceiling', () => {
      expect(isAverageManaValueTooHigh(MAX_AVERAGE_MANA_VALUE)).toBe(false)
      expect(isAverageManaValueTooHigh(MAX_AVERAGE_MANA_VALUE + 0.1)).toBe(true)
    })
  })

  describe('the prompt adapter', () => {
    it('names the band and the curve ceiling', () => {
      expect(DECK_SHAPE_PROMPT_RULES).toContain(
        `${LAND_COUNT_RANGE.min}-${LAND_COUNT_RANGE.max} lands`,
      )
      expect(DECK_SHAPE_PROMPT_RULES).toContain(String(MAX_AVERAGE_MANA_VALUE))
    })

    it('names every archetype and its own count, so the prose cannot drift', () => {
      for (const [archetype, count] of Object.entries(ARCHETYPE_LAND_COUNT)) {
        const group = DECK_SHAPE_PROMPT_RULES.split(';').find((part) => part.includes(archetype))
        expect(group, archetype).toBeDefined()
        expect(group, archetype).toContain(`${count} for `)
      }
    })
  })
})
