import { describe, expect, it } from 'vitest'
import { parseDeck, parseScryfallCard } from '../simulation/parser'
import type { DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import type { CardType } from '../simulation/types'

function scryfall(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    name: overrides.id,
    lang: 'en',
    layout: 'normal',
    cmc: 0,
    type_line: 'Creature — Bear',
    color_identity: [],
    set: 'tst',
    set_name: 'Test',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
    ...overrides,
  }
}

function makeForest(id: string): ScryfallCard {
  return scryfall({ id, type_line: 'Basic Land — Forest', color_identity: ['G'] })
}

function cardMap(...cards: ScryfallCard[]): Map<string, ScryfallCard> {
  return new Map(cards.map((c) => [c.id, c]))
}

describe('parseDeck', () => {
  const forest = makeForest('forest')

  it('[R] expands a stack into one library entry per copy', () => {
    const deck: DeckCard[] = [{ scryfallId: 'forest', quantity: 4, zone: 'main' }]

    expect(parseDeck(deck, cardMap(forest))).toHaveLength(4)
  })

  it('[R] skips cards outside the main deck', () => {
    // 'main' is the only zone since #44, so the parser's zone guard can only
    // fire for a deck persisted before the sideboard was deleted. The cast
    // reproduces exactly that: a legacy entry must be dropped, not dealt.
    const deck: DeckCard[] = [
      { scryfallId: 'forest', quantity: 2, zone: 'main' },
      { scryfallId: 'forest', quantity: 3, zone: 'sideboard' } as unknown as DeckCard,
    ]

    expect(parseDeck(deck, cardMap(forest))).toHaveLength(2)
  })

  // Load-bearing, and the reason issue #4 existed: sharing one object per
  // distinct card keeps 5,000 games affordable, but it means no library entry
  // can be identified by reference. Anything removing a single card from a
  // zone must remove it by index - see `applyEffect`'s 'ramp' case.
  it('[R] aliases the copies of a card rather than cloning them', () => {
    const deck: DeckCard[] = [{ scryfallId: 'forest', quantity: 4, zone: 'main' }]

    const library = parseDeck(deck, cardMap(forest))

    expect(library[0]).toBe(library[1])
    expect(library[0]).toBe(library[3])
  })
})

describe('parseScryfallCard', () => {
  describe('card type', () => {
    const TYPE_LINES: Array<[string, CardType]> = [
      ['Creature — Bear', 'creature'],
      ['Instant', 'instant'],
      ['Sorcery', 'sorcery'],
      ['Enchantment — Aura', 'enchantment'],
      ['Artifact — Equipment', 'artifact'],
      ['Legendary Planeswalker — Jace', 'planeswalker'],
      ['Basic Land — Forest', 'land'],
      ['Tribal Instant — Elf', 'instant'],
    ]

    it.each(TYPE_LINES)('[R] reads %s as a %s', (typeLine, cardType) => {
      expect(parseScryfallCard(scryfall({ id: 'c', type_line: typeLine })).cardType).toBe(cardType)
    })

    it('[R] reads a type line it does not recognise as "other"', () => {
      expect(parseScryfallCard(scryfall({ id: 'c', type_line: 'Dungeon' })).cardType).toBe('other')
    })

    it('[R] prefers creature over the other types on a multi-type card', () => {
      // An Artifact Creature blocks and dies like a creature, and that is the
      // half the model cares about.
      const card = scryfall({ id: 'c', type_line: 'Artifact Creature — Golem' })

      expect(parseScryfallCard(card).cardType).toBe('creature')
    })
  })

  it('[R] reads the mana cost of a nonland', () => {
    const card = scryfall({ id: 'c', mana_cost: '{2}{G}' })

    expect(parseScryfallCard(card).cost).toEqual({
      generic: 2,
      pips: [{ kind: 'color', colors: ['G'] }],
      cmc: 3,
    })
  })

  it('[R] gives a land no cost at all', () => {
    // `chooseCasts` skips a card with a null cost, which is what keeps a land
    // out of the spells it tries to pay for.
    expect(parseScryfallCard(makeForest('forest')).cost).toBeNull()
  })

  it('[R] reads a missing mana cost as free rather than as a land', () => {
    expect(parseScryfallCard(scryfall({ id: 'c', type_line: 'Instant' })).cost).toEqual({
      generic: 0,
      pips: [],
      cmc: 0,
    })
  })

  it('[R] reads power and toughness as numbers', () => {
    const card = scryfall({ id: 'c', power: '3', toughness: '4' })
    const parsed = parseScryfallCard(card)

    expect(parsed.power).toBe(3)
    expect(parsed.toughness).toBe(4)
  })

  it('[C] reads a variable power or toughness as zero', () => {
    // Issue #38.
    // A `*/*` creature is whatever its ability says, and the model has no
    // ability to read - so it comes in as a 0/0 and dies to state-based
    // actions the moment it resolves.
    const card = scryfall({ id: 'c', power: '*', toughness: '*' })
    const parsed = parseScryfallCard(card)

    expect(parsed.power).toBe(0)
    expect(parsed.toughness).toBe(0)
  })

  it('[R] gives a noncreature no power or toughness', () => {
    const parsed = parseScryfallCard(scryfall({ id: 'c', type_line: 'Artifact' }))

    expect(parsed.power).toBe(0)
    expect(parsed.toughness).toBe(0)
  })

  it('[R] maps the keywords it models and drops the rest', () => {
    const card = scryfall({
      id: 'c',
      keywords: ['Flying', 'First strike', 'Double strike', 'Cycling', 'Ward'],
    })

    expect(parseScryfallCard(card).keywords).toEqual(
      new Set(['flying', 'first_strike', 'double_strike']),
    )
  })

  it('[R] gives a card with no keywords an empty set', () => {
    expect(parseScryfallCard(scryfall({ id: 'c' })).keywords).toEqual(new Set())
  })

  it('[R] reads the colors a land produces', () => {
    const card = scryfall({
      id: 'c',
      type_line: 'Land',
      oracle_text: '{T}: Add {W} or {U}.',
    })

    expect(parseScryfallCard(card).producesColors).toEqual(['W', 'U'])
  })

  it('[R] reads no produced colors off a nonland', () => {
    // A mana creature adds mana, and the model reads mana off lands only.
    const card = scryfall({
      id: 'c',
      type_line: 'Creature — Elf Druid',
      oracle_text: '{T}: Add {G}.',
    })

    expect(parseScryfallCard(card).producesColors).toEqual([])
  })

  it('[R] flags a basic land', () => {
    expect(parseScryfallCard(makeForest('forest')).isBasicLand).toBe(true)
  })

  it('[R] does not flag a nonbasic land as basic', () => {
    // Ramp fetches on this flag, so a dual reading as basic would be fetchable.
    const card = scryfall({ id: 'c', type_line: 'Land — Forest Island' })

    expect(parseScryfallCard(card).isBasicLand).toBe(false)
  })

  it('[R] parses the effects off the oracle text', () => {
    const card = scryfall({ id: 'c', type_line: 'Sorcery', oracle_text: 'Draw two cards.' })

    expect(parseScryfallCard(card).effects).toEqual([
      { trigger: 'cast', action: { type: 'draw', count: 2 } },
    ])
  })

  describe('a two-faced card', () => {
    const split = scryfall({
      id: 'c',
      type_line: 'Creature — Human // Creature — Werewolf',
      card_faces: [
        {
          name: 'Front',
          type_line: 'Creature — Human',
          mana_cost: '{1}{R}',
          oracle_text: 'Draw a card.',
          power: '2',
          toughness: '2',
        },
        {
          name: 'Back',
          type_line: 'Creature — Werewolf',
          mana_cost: '',
          oracle_text: 'Target player mills three cards.',
          power: '5',
          toughness: '5',
        },
      ],
    })

    it('[R] reads the front face and ignores the back', () => {
      // The sim never transforms anything, so the back face is not a state the
      // game can reach.
      const parsed = parseScryfallCard(split)

      expect(parsed.power).toBe(2)
      expect(parsed.cost).toEqual({
        generic: 1,
        pips: [{ kind: 'color', colors: ['R'] }],
        cmc: 2,
      })
      expect(parsed.effects).toEqual([
        { trigger: 'etb', action: { type: 'draw', count: 1 } },
      ])
    })

    it('[R] keeps the card name rather than the face name', () => {
      expect(parseScryfallCard(split).name).toBe('c')
    })
  })
})
