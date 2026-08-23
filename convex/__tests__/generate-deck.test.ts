import { describe, expect, it } from 'vitest'
import {
  parseResponse,
  enforceDeckSize,
  buildDeckContext,
  deriveDeltaOp,
  parseSectionResponse,
} from '../generateDeck'

/**
 * Coverage for the five parse/enforce helpers in `convex/generateDeck.ts`.
 * These live in a Convex action module but are pure, so they run under the
 * node vitest runner with no Convex runtime.
 *
 * Some `enforceDeckSize` cases below are characterization tests: they pin
 * behavior that issue #12 calls a bug. Each is marked `PINNED BUG (#12)`.
 * Fixing #12 means changing those assertions, not treating them as
 * regressions.
 */

describe('parseResponse', () => {
  it('parses a bare JSON object', () => {
    const deck = parseResponse(
      '{"name":"Goblins","description":"Fast","cards":[{"name":"Mountain","quantity":24}]}',
    )
    expect(deck.name).toBe('Goblins')
    expect(deck.description).toBe('Fast')
    expect(deck.cards).toEqual([{ name: 'Mountain', quantity: 24 }])
  })

  it('parses JSON out of a code fence', () => {
    const deck = parseResponse(
      'Here you go:\n```json\n{"name":"Elves","description":"","cards":[{"name":"Forest","quantity":20}]}\n```\nEnjoy.',
    )
    expect(deck.name).toBe('Elves')
  })

  it('parses a JSON object embedded in prose', () => {
    const deck = parseResponse(
      'Sure. {"name":"Merfolk","description":"","cards":[{"name":"Island","quantity":22}]} Done.',
    )
    expect(deck.name).toBe('Merfolk')
  })

  it('defaults a missing description to an empty string', () => {
    const deck = parseResponse('{"name":"X","cards":[{"name":"Plains","quantity":1}]}')
    expect(deck.description).toBe('')
  })

  it('drops cards with a missing name or a non-positive quantity', () => {
    const deck = parseResponse(
      '{"name":"X","description":"","cards":[{"name":"Plains","quantity":4},{"name":"","quantity":2},{"name":"Swamp","quantity":0},{"quantity":3}]}',
    )
    expect(deck.cards).toEqual([{ name: 'Plains', quantity: 4 }])
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseResponse('I could not build that deck.')).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('throws when the JSON has no cards array', () => {
    expect(() => parseResponse('{"name":"X","description":""}')).toThrow(
      /invalid format/,
    )
  })
})

describe('enforceDeckSize', () => {
  it('clamps non-basic cards to four copies', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Lightning Bolt', quantity: 9 },
        { name: 'Mountain', quantity: 51 },
      ],
    })
    expect(deck.cards.find((c) => c.name === 'Lightning Bolt')?.quantity).toBe(4)
  })

  // PINNED BUG (#12): basics are identified by name only, so this passes for
  // the wrong reason on a deck whose colors don't match its basics.
  it('leaves basic lands above four copies alone', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Forest', quantity: 56 },
        { name: 'Llanowar Elves', quantity: 4 },
      ],
    })
    expect(deck.cards.find((c) => c.name === 'Forest')?.quantity).toBe(56)
  })

  it('merges duplicate entries of the same card', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Llanowar Elves', quantity: 2 },
        { name: 'Llanowar Elves', quantity: 2 },
        { name: 'Forest', quantity: 56 },
      ],
    })
    const elves = deck.cards.filter((c) => c.name === 'Llanowar Elves')
    expect(elves).toHaveLength(1)
    expect(elves[0].quantity).toBe(4)
  })

  it('pads an undersized deck with the basics it already runs', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Llanowar Elves', quantity: 4 },
        { name: 'Forest', quantity: 6 },
      ],
    })
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Forest')?.quantity).toBe(56)
  })

  // PINNED BUG (#12): the fallback is hardcoded to Forest, so a mono-blue deck
  // with no basics gets padded with Forests. #12 replaces this with a
  // color-aware fallback; expect to rewrite this assertion.
  it('falls back to Forest when an undersized deck runs no basics', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [{ name: 'Llanowar Elves', quantity: 4 }],
    })
    expect(deck.cards.find((c) => c.name === 'Forest')?.quantity).toBe(56)
  })

  it('trims an oversized deck back to 60', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Llanowar Elves', quantity: 4 },
        { name: 'Elvish Mystic', quantity: 4 },
        { name: 'Forest', quantity: 60 },
      ],
    })
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
  })

  // PINNED BUG (#12): every card sits at the 1-copy floor, so the trim loop
  // can remove nothing and returns an oversized deck. #12 fixes this; expect
  // to rewrite this assertion to `toBe(60)`.
  it('returns an oversized deck when every card is a singleton', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: Array.from({ length: 70 }, (_, i) => ({
        name: `Card ${i}`,
        quantity: 1,
      })),
    })
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(70)
  })

  it('never trims a locked card below its locked quantity', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Llanowar Elves', quantity: 4 },
          { name: 'Elvish Mystic', quantity: 4 },
          { name: 'Forest', quantity: 60 },
        ],
      },
      [{ name: 'Llanowar Elves', quantity: 4 }],
    )
    expect(deck.cards.find((c) => c.name === 'Llanowar Elves')?.quantity).toBe(4)
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
  })
})

describe('buildDeckContext', () => {
  it('returns an empty string with no inputs', () => {
    expect(buildDeckContext()).toBe('')
  })

  it('includes the deck strategy', () => {
    expect(buildDeckContext(undefined, 'Aggressive goblins')).toContain(
      'DECK STRATEGY: Aggressive goblins',
    )
  })

  it('lists cards flat when none carry a section', () => {
    const context = buildDeckContext([
      { name: 'Mountain', quantity: 24 },
      { name: 'Goblin Guide', quantity: 4 },
    ])
    expect(context).toContain('CURRENT DECK (28 cards):')
    expect(context).toContain('24x Mountain')
    expect(context).not.toContain('[Other]')
  })

  it('groups cards under their section headers', () => {
    const context = buildDeckContext([
      { name: 'Goblin Guide', quantity: 4, section: 'Threats' },
      { name: 'Mountain', quantity: 24, section: 'Lands' },
    ])
    expect(context).toContain('[Threats]')
    expect(context).toContain('[Lands]')
    expect(context).toContain('  4x Goblin Guide')
  })

  it('lists locked cards under their own header', () => {
    const context = buildDeckContext(undefined, undefined, [
      { name: 'Goblin Guide', quantity: 4 },
    ])
    expect(context).toContain('LOCKED CARDS (do NOT remove or change them):')
    expect(context).toContain('4x Goblin Guide')
  })
})

describe('deriveDeltaOp', () => {
  it('reads a removal-only message as remove', () => {
    expect(deriveDeltaOp('cut Lightning Bolt')).toBe('remove')
    expect(deriveDeltaOp('entferne Blitzschlag')).toBe('remove')
  })

  it('reads an addition-only message as add', () => {
    expect(deriveDeltaOp('add Shock')).toBe('add')
    expect(deriveDeltaOp('Schock aufnehmen')).toBe('add')
  })

  it('falls back to swap when both or neither verb appears', () => {
    expect(deriveDeltaOp('remove Shock and add Lava Spike')).toBe('swap')
    expect(deriveDeltaOp('make the deck faster')).toBe('swap')
  })

  it('falls back to swap for a German separable verb, which the stems miss', () => {
    // The heuristic matches verb stems (`aufnehm`), so a split form like
    // "nimm ... auf" isn't recognized. Documented as best-effort; swap is the
    // safe default because the model response decides the real op.
    expect(deriveDeltaOp('nimm Schock auf')).toBe('swap')
  })
})

describe('parseSectionResponse', () => {
  it('parses a bare JSON object', () => {
    const result = parseSectionResponse(
      '{"cards":[{"name":"Shock","quantity":4}],"explanation":"cheap burn"}',
    )
    expect(result.cards).toEqual([{ name: 'Shock', quantity: 4 }])
    expect(result.explanation).toBe('cheap burn')
  })

  it('parses JSON out of a code fence', () => {
    const result = parseSectionResponse(
      '```json\n{"cards":[{"name":"Shock","quantity":4}],"explanation":""}\n```',
    )
    expect(result.cards).toHaveLength(1)
  })

  it('defaults a missing explanation to an empty string', () => {
    const result = parseSectionResponse('{"cards":[{"name":"Shock","quantity":4}]}')
    expect(result.explanation).toBe('')
  })

  it('drops malformed cards and clamps non-basics to four copies', () => {
    const result = parseSectionResponse(
      '{"cards":[{"name":"Shock","quantity":9},{"name":"Mountain","quantity":20},{"name":"","quantity":1}],"explanation":""}',
    )
    expect(result.cards).toEqual([
      { name: 'Shock', quantity: 4 },
      { name: 'Mountain', quantity: 20 },
    ])
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseSectionResponse('no json here')).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('throws when the JSON has no cards array', () => {
    expect(() => parseSectionResponse('{"explanation":"oops"}')).toThrow(
      /invalid format/,
    )
  })
})
