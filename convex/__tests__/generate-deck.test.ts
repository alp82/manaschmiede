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
  // Type lines for the non-basic lands used below. enforceDeckSize only sees
  // card names, so the caller supplies the pool's name -> type_line map.
  const LAND_TYPES = {
    'Sulfur Falls': 'Land',
    'Rootbound Crag': 'Land',
    'Dryad Arbor': 'Land Creature \u2014 Forest Dryad',
  }

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

  it('exempts a basic land from the four-copy cap by type line', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Snow-Covered Island', quantity: 56 },
          { name: 'Brainstorm', quantity: 4 },
        ],
      },
      undefined,
      { cardTypes: { 'Snow-Covered Island': 'Basic Snow Land \u2014 Island' } },
    )
    expect(deck.cards.find((c) => c.name === 'Snow-Covered Island')?.quantity).toBe(56)
  })

  it('caps a non-basic land at four copies', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Sulfur Falls', quantity: 8 },
          { name: 'Mountain', quantity: 52 },
        ],
      },
      undefined,
      { cardTypes: LAND_TYPES },
    )
    expect(deck.cards.find((c) => c.name === 'Sulfur Falls')?.quantity).toBe(4)
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

  it('pads a mono-blue deck with Islands, not Forests', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [{ name: 'Brainstorm', quantity: 4 }],
      },
      undefined,
      { colors: ['U'] },
    )
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Island')?.quantity).toBe(56)
    expect(deck.cards.find((c) => c.name === 'Forest')).toBeUndefined()
  })

  it('splits the padding across every deck color', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [{ name: 'Lightning Helix', quantity: 4 }],
      },
      undefined,
      { colors: ['R', 'W'] },
    )
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Mountain')?.quantity).toBe(28)
    expect(deck.cards.find((c) => c.name === 'Plains')?.quantity).toBe(28)
  })

  it('prefers the declared colors over the basics already in the deck', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Brainstorm', quantity: 4 },
          { name: 'Forest', quantity: 2 },
        ],
      },
      undefined,
      { colors: ['U'] },
    )
    expect(deck.cards.find((c) => c.name === 'Island')?.quantity).toBe(54)
    expect(deck.cards.find((c) => c.name === 'Forest')?.quantity).toBe(2)
  })

  it('falls back to Forest when no colors are given and the deck runs no basics', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [{ name: 'Llanowar Elves', quantity: 4 }],
    })
    expect(deck.cards.find((c) => c.name === 'Forest')?.quantity).toBe(56)
  })

  it('ignores color letters that name no basic land', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [{ name: 'Sol Ring', quantity: 4 }],
      },
      undefined,
      { colors: ['C'] },
    )
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
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

  it('drops whole entries when every card already sits at one copy', () => {
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: Array.from({ length: 70 }, (_, i) => ({
        name: `Card ${i}`,
        quantity: 1,
      })),
    })
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards).toHaveLength(60)
  })

  it('deletes the smallest stacks first, not the one it just trimmed', () => {
    // 4x Bolt + 60 singletons = 64. Pass 1 takes Bolt to 1; the last card the
    // deletion pass should touch is the playset the model asked for four of.
    const deck = enforceDeckSize({
      name: 'X',
      description: '',
      cards: [
        { name: 'Lightning Bolt', quantity: 4 },
        ...Array.from({ length: 60 }, (_, i) => ({ name: `Spell ${i}`, quantity: 1 })),
      ],
    })
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Lightning Bolt')?.quantity).toBe(1)
    expect(deck.cards).toHaveLength(60)
  })

  it('drops singleton spells before singleton lands', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          ...Array.from({ length: 62 }, (_, i) => ({ name: `Spell ${i}`, quantity: 1 })),
          { name: 'Sulfur Falls', quantity: 1 },
          { name: 'Mountain', quantity: 1 },
        ],
      },
      undefined,
      { cardTypes: LAND_TYPES },
    )
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Sulfur Falls')).toBeDefined()
    expect(deck.cards.find((c) => c.name === 'Mountain')).toBeDefined()
  })

  it('trims a spell before either a dual land or a basic', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Lightning Bolt', quantity: 4 },
          { name: 'Sulfur Falls', quantity: 4 },
          { name: 'Rootbound Crag', quantity: 4 },
          { name: 'Mountain', quantity: 4 },
          { name: 'Goblin Guide', quantity: 4 },
          { name: 'Forest', quantity: 46 },
        ],
      },
      undefined,
      { cardTypes: LAND_TYPES },
    )
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
    expect(deck.cards.find((c) => c.name === 'Sulfur Falls')?.quantity).toBe(4)
    expect(deck.cards.find((c) => c.name === 'Rootbound Crag')?.quantity).toBe(4)
    expect(deck.cards.find((c) => c.name === 'Mountain')?.quantity).toBe(4)
    expect(deck.cards.find((c) => c.name === 'Lightning Bolt')?.quantity).toBe(1)
    expect(deck.cards.find((c) => c.name === 'Goblin Guide')?.quantity).toBe(1)
  })

  it('treats a land creature as a land', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          ...Array.from({ length: 62 }, (_, i) => ({ name: `Spell ${i}`, quantity: 1 })),
          { name: 'Dryad Arbor', quantity: 1 },
          { name: 'Forest', quantity: 1 },
        ],
      },
      undefined,
      { cardTypes: LAND_TYPES },
    )
    expect(deck.cards.find((c) => c.name === 'Dryad Arbor')).toBeDefined()
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

  it('trims a locked card down to its locked quantity as a last resort', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: [
          { name: 'Llanowar Elves', quantity: 4 },
          { name: 'Forest', quantity: 58 },
        ],
      },
      [{ name: 'Llanowar Elves', quantity: 2 }, { name: 'Forest', quantity: 58 }],
    )
    expect(deck.cards.find((c) => c.name === 'Llanowar Elves')?.quantity).toBe(2)
    expect(deck.cards.reduce((s, c) => s + c.quantity, 0)).toBe(60)
  })

  it('never deletes a locked card outright, even if that leaves the deck oversized', () => {
    const deck = enforceDeckSize(
      {
        name: 'X',
        description: '',
        cards: Array.from({ length: 70 }, (_, i) => ({ name: `Card ${i}`, quantity: 1 })),
      },
      Array.from({ length: 70 }, (_, i) => ({ name: `Card ${i}`, quantity: 1 })),
    )
    expect(deck.cards).toHaveLength(70)
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
