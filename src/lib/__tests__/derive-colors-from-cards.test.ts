import { describe, it, expect } from 'vitest'
import { deriveColorsFromCards, type DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import type { ManaColor } from '../mana-colors'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeDeckCard(scryfallId: string, quantity = 1): DeckCard {
  return { scryfallId, quantity, zone: 'main' }
}

function makeScryfall(id: string, color_identity: string[]): ScryfallCard {
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

function makeMap(entries: Array<[string, string[]]>): Map<string, ScryfallCard> {
  const m = new Map<string, ScryfallCard>()
  for (const [id, colors] of entries) {
    m.set(id, makeScryfall(id, colors))
  }
  return m
}

const WUBRG: ManaColor[] = ['W', 'U', 'B', 'R', 'G']

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('deriveColorsFromCards', () => {
  it('empty cards list returns []', () => {
    const result = deriveColorsFromCards([], new Map())
    expect(result).toEqual([])
  })

  it('all cards unresolved (ids absent from map) returns []', () => {
    const cards = [makeDeckCard('missing-1'), makeDeckCard('missing-2')]
    const cardDataMap = makeMap([]) // empty — none resolved
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual([])
  })

  it('single mono-red card returns [R]', () => {
    const cards = [makeDeckCard('bolt')]
    const cardDataMap = makeMap([['bolt', ['R']]])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['R'])
  })

  it('multi-card union [W,R] + [G,U] returns [W,U,R,G] in WUBRG order', () => {
    const cards = [makeDeckCard('boros'), makeDeckCard('simic')]
    const cardDataMap = makeMap([
      ['boros', ['W', 'R']],
      ['simic', ['G', 'U']],
    ])
    const result = deriveColorsFromCards(cards, cardDataMap)
    // WUBRG order: W, U, R, G (B not present)
    expect(result).toEqual(['W', 'U', 'R', 'G'])
  })

  it('colorless card (empty color_identity) contributes nothing', () => {
    const cards = [makeDeckCard('sol-ring')]
    const cardDataMap = makeMap([['sol-ring', []]])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual([])
  })

  it('colorless card alongside a colored card does not add colorless', () => {
    const cards = [makeDeckCard('sol-ring'), makeDeckCard('bolt')]
    const cardDataMap = makeMap([
      ['sol-ring', []],
      ['bolt', ['R']],
    ])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['R'])
  })

  it('duplicate color_identity across multiple cards collapses to a single entry', () => {
    const cards = [makeDeckCard('bolt1'), makeDeckCard('bolt2'), makeDeckCard('shock')]
    const cardDataMap = makeMap([
      ['bolt1', ['R']],
      ['bolt2', ['R']],
      ['shock', ['R']],
    ])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['R'])
  })

  it('5-color deck returns all colors in strict WUBRG order', () => {
    const cards = WUBRG.map((c) => makeDeckCard(`card-${c}`))
    const cardDataMap = makeMap(WUBRG.map((c) => [`card-${c}`, [c]]))
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['W', 'U', 'B', 'R', 'G'])
  })

  it('mix of resolved and unresolved cards: only resolved contribute colors', () => {
    const cards = [makeDeckCard('resolved'), makeDeckCard('missing')]
    const cardDataMap = makeMap([['resolved', ['U']]])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['U'])
  })

  it('sideboard card (zone=side) is included if present — deriveColorsFromCards is zone-agnostic', () => {
    // The function does not filter by zone; it includes all DeckCard entries.
    const cards = [{ scryfallId: 'sidecard', quantity: 1, zone: 'side' as const }]
    const cardDataMap = makeMap([['sidecard', ['B']]])
    const result = deriveColorsFromCards(cards, cardDataMap)
    expect(result).toEqual(['B'])
  })
})
