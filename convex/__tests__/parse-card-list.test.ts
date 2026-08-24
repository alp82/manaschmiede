import { describe, expect, it } from 'vitest'
import {
  INVALID_FORMAT_MESSAGE,
  cardEntry,
  isNonEmptyString,
  nameEntry,
  parseCardList,
} from '../lib/parseCardList'

/**
 * Coverage for the shared card-list parser: every ladder rung, each rung
 * failing independently, both failure modes, and the entry adapters that carry
 * the differences between the four call sites.
 */

/** The minimal single-list options every call site shares. */
function deckOpts(overrides: Record<string, unknown> = {}) {
  return {
    lists: { cards: { entry: cardEntry(), required: true } },
    onFailure: 'throw' as const,
    ...overrides,
  }
}

describe('parseCardList - ladder rungs', () => {
  it('rung 1: parses plain JSON', () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      '{"cards":[{"name":"Shock","quantity":4}]}',
      deckOpts(),
    )
    expect(result.lists.cards).toEqual([{ name: 'Shock', quantity: 4 }])
    expect(result.failed).toBe(false)
  })

  it('rung 2: parses a ```json fence', () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      'Here:\n```json\n{"cards":[{"name":"Shock","quantity":4}]}\n```\nDone.',
      deckOpts(),
    )
    expect(result.lists.cards).toHaveLength(1)
  })

  it('rung 2: parses a bare ``` fence with no language tag', () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      '```\n{"cards":[{"name":"Shock","quantity":4}]}\n```',
      deckOpts(),
    )
    expect(result.lists.cards).toHaveLength(1)
  })

  it('rung 3 is off unless bareObjectAnchor is given', () => {
    const prose = 'Sure: {"cards":[{"name":"Shock","quantity":4}]}'
    expect(() => parseCardList(prose, deckOpts())).toThrow(/Could not parse AI response as JSON/)
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      prose,
      deckOpts({ bareObjectAnchor: 'cards' }),
    )
    expect(result.lists.cards).toHaveLength(1)
  })

  it('rung 3 with a null anchor accepts any embedded object', () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      'I suggest {"cards":[{"name":"Shock","quantity":4}]} - enjoy.',
      deckOpts({ bareObjectAnchor: null }),
    )
    expect(result.lists.cards).toHaveLength(1)
  })

  it('an anchored rung 3 skips a prose object that lacks the key', () => {
    expect(() =>
      parseCardList('prose {"other":[1]} prose', deckOpts({ bareObjectAnchor: 'cards' })),
    ).toThrow(/Could not parse AI response as JSON/)
  })

  it('each rung fails independently: a failed fence falls through to rung 3', () => {
    // The anchored pattern is greedy from the first brace, so this only
    // recovers when the failed fence holds no braces of its own - the case
    // where the model apologised in a fence and then wrote the JSON after it.
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      '```json\ntruncated...\n```\n{"cards":[{"name":"Bolt","quantity":1}]}',
      deckOpts({ bareObjectAnchor: 'cards' }),
    )
    expect(result.lists.cards).toEqual([{ name: 'Bolt', quantity: 1 }])
  })

  it('a truncated fence with no rung 3 is an unparseable response, not a SyntaxError', () => {
    expect(() => parseCardList('```json\n{"cards":[{"name":"Shock"\n```', deckOpts())).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('treats a blank or non-string body as unparseable', () => {
    expect(() => parseCardList('', deckOpts())).toThrow(/Could not parse AI response as JSON/)
    expect(() => parseCardList('   ', deckOpts())).toThrow(/Could not parse AI response as JSON/)
    expect(() => parseCardList(null as unknown as string, deckOpts())).toThrow(
      /Could not parse AI response as JSON/,
    )
  })
})

describe('parseCardList - failure modes', () => {
  it("onFailure 'throw' surfaces an unparseable response", () => {
    expect(() => parseCardList('no json here', deckOpts())).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it("onFailure 'throw' surfaces a wrong-shaped response", () => {
    expect(() => parseCardList('{"explanation":"oops"}', deckOpts())).toThrow(
      INVALID_FORMAT_MESSAGE,
    )
  })

  it("onFailure 'empty' never throws and reports failed: true", () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      'no json here',
      deckOpts({ onFailure: 'empty', scalars: { explanation: '' } }),
    )
    expect(result.lists.cards).toEqual([])
    expect(result.scalars.explanation).toBe('')
    expect(result.failed).toBe(true)
  })

  it("onFailure 'empty' also swallows a wrong-shaped response", () => {
    const result = parseCardList('{"explanation":"oops"}', deckOpts({ onFailure: 'empty' }))
    expect(result.lists.cards).toEqual([])
    expect(result.failed).toBe(true)
  })

  it('rejects a top-level array so a bare list cannot pass as a payload', () => {
    expect(() => parseCardList('[{"name":"Shock","quantity":4}]', deckOpts())).toThrow(
      INVALID_FORMAT_MESSAGE,
    )
  })

  it('rejects JSON that is not an object at all', () => {
    expect(() => parseCardList('42', deckOpts())).toThrow(INVALID_FORMAT_MESSAGE)
    expect(() => parseCardList('null', deckOpts())).toThrow(
      /Could not parse AI response as JSON|invalid format/,
    )
  })
})

describe('parseCardList - lists', () => {
  it('a non-required list defaults to empty when the key is missing', () => {
    const result = parseCardList<{ cards: { name: string; quantity: number } }>(
      '{"explanation":"none"}',
      { lists: { cards: { entry: cardEntry() } }, onFailure: 'throw' },
    )
    expect(result.lists.cards).toEqual([])
    expect(result.failed).toBe(false)
  })

  it('a required list that is present but not an array is invalid', () => {
    expect(() => parseCardList('{"cards":"Shock"}', deckOpts())).toThrow(INVALID_FORMAT_MESSAGE)
  })

  it('caps a list at max, counting only surviving entries', () => {
    const result = parseCardList<{ cards: { name: string } }>(
      '{"cards":[{"x":1},{"name":"A"},{"name":"B"},{"name":"C"},{"name":"D"}]}',
      { lists: { cards: { entry: nameEntry, max: 3 } }, onFailure: 'throw' },
    )
    expect(result.lists.cards).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C' }])
  })

  it('reads two lists of two different shapes from one payload', () => {
    const result = parseCardList<{
      remove: { name: string }
      add: { name: string; quantity: number }
    }>('{"remove":[{"name":"Bolt"}],"add":[{"name":"Shock"}]}', {
      lists: {
        remove: { entry: nameEntry },
        add: { entry: cardEntry({ invalidQuantity: 'one' }) },
      },
      onFailure: 'empty',
    })
    expect(result.lists.remove).toEqual([{ name: 'Bolt' }])
    expect(result.lists.add).toEqual([{ name: 'Shock', quantity: 1 }])
  })
})

describe('parseCardList - scalars', () => {
  it('reads scalars and falls back for absent, empty, or non-string values', () => {
    const result = parseCardList<{ cards: { name: string } }>(
      '{"cards":[],"description":"","explanation":7,"name":"Goblins"}',
      {
        lists: { cards: { entry: nameEntry, required: true } },
        scalars: { name: undefined, description: 'fallback', explanation: undefined },
        onFailure: 'throw',
      },
    )
    expect(result.scalars.name).toBe('Goblins')
    expect(result.scalars.description).toBe('fallback')
    expect(result.scalars.explanation).toBeUndefined()
  })

  it('a missing or empty required scalar makes the response invalid', () => {
    const opts = {
      lists: { cards: { entry: nameEntry, required: true } },
      scalars: { name: undefined },
      requiredScalars: ['name'],
      onFailure: 'throw' as const,
    }
    expect(() => parseCardList('{"cards":[]}', opts)).toThrow(INVALID_FORMAT_MESSAGE)
    expect(() => parseCardList('{"name":"","cards":[]}', opts)).toThrow(INVALID_FORMAT_MESSAGE)
  })
})

describe('entry adapters', () => {
  it('isNonEmptyString rejects non-strings and the empty string', () => {
    expect(isNonEmptyString('a')).toBe(true)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(1)).toBe(false)
    expect(isNonEmptyString(null)).toBe(false)
  })

  it('nameEntry keeps a non-empty name and drops everything else', () => {
    expect(nameEntry({ name: 'Shock' })).toEqual({ name: 'Shock' })
    expect(nameEntry({ name: '' })).toBeNull()
    expect(nameEntry({ quantity: 2 })).toBeNull()
    expect(nameEntry(null)).toBeNull()
    expect(nameEntry('Shock')).toBeNull()
  })

  it("cardEntry drops an entry with an invalid quantity by default", () => {
    const entry = cardEntry()
    expect(entry({ name: 'Shock', quantity: 4 })).toEqual({ name: 'Shock', quantity: 4 })
    expect(entry({ name: 'Shock', quantity: 0 })).toBeNull()
    expect(entry({ name: 'Shock' })).toBeNull()
    expect(entry({ name: '', quantity: 4 })).toBeNull()
  })

  it("cardEntry with invalidQuantity 'one' substitutes a single copy", () => {
    const entry = cardEntry({ invalidQuantity: 'one' })
    expect(entry({ name: 'Shock' })).toEqual({ name: 'Shock', quantity: 1 })
    expect(entry({ name: 'Shock', quantity: -2 })).toEqual({ name: 'Shock', quantity: 1 })
    expect(entry({ name: 'Shock', quantity: 3 })).toEqual({ name: 'Shock', quantity: 3 })
    // A missing name is still a drop - the substitution is about counts only.
    expect(entry({ quantity: 2 })).toBeNull()
  })

  it('cardEntry does not clamp unless asked', () => {
    expect(cardEntry()({ name: 'Shock', quantity: 9 })).toEqual({ name: 'Shock', quantity: 9 })
  })

  it('cardEntry with clampCopies applies the 4-copy rule and exempts basics', () => {
    const entry = cardEntry({ clampCopies: true })
    expect(entry({ name: 'Shock', quantity: 9 })).toEqual({ name: 'Shock', quantity: 4 })
    expect(entry({ name: 'Mountain', quantity: 24 })).toEqual({ name: 'Mountain', quantity: 24 })
  })
})
