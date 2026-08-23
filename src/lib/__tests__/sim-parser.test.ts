import { describe, expect, it } from 'vitest'
import { parseDeck } from '../simulation/parser'
import type { DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'

function makeForest(id: string): ScryfallCard {
  return {
    id,
    name: id,
    lang: 'en',
    layout: 'normal',
    cmc: 0,
    type_line: 'Basic Land — Forest',
    color_identity: ['G'],
    set: 'tst',
    set_name: 'Test',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
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
    const deck: DeckCard[] = [
      { scryfallId: 'forest', quantity: 2, zone: 'main' },
      { scryfallId: 'forest', quantity: 3, zone: 'sideboard' },
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
