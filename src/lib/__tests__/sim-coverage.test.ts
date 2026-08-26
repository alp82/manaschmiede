import { describe, expect, it } from 'vitest'
import { isFullyParsed } from '../simulation/effects'
import { parseDeck, parseScryfallCard } from '../simulation/parser'
import { COVERAGE_THRESHOLD, runSimulation, simulationCoverage } from '../simulation/runner'
import { simulationSignal } from '../simulation/bench'
import type { DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import { deckOf, forest, simCard } from './sim-fixtures'

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

describe('isFullyParsed', () => {
  it('[R] reads a vanilla creature as fully parsed', () => {
    expect(isFullyParsed('', 'creature')).toBe(true)
  })

  it('[R] reads a supported keyword line, with reminder text, as fully parsed', () => {
    expect(isFullyParsed('Flying, trample (This creature can block only creatures with flying or reach.)', 'creature')).toBe(true)
  })

  it('[R] reads a line matched by a live effect pattern as fully parsed', () => {
    expect(isFullyParsed('Draw two cards.', 'sorcery')).toBe(true)
  })

  it('[R] leaves an unsupported keyword unparsed', () => {
    expect(isFullyParsed('Ward {2}', 'creature')).toBe(false)
  })

  it('[R] leaves a matched-but-inert line unparsed', () => {
    // The lord pattern emits a 'static' effect nothing fires, so the card's
    // strength is not in the measured win rate.
    expect(isFullyParsed('Other creatures you control get +1/+1.', 'creature')).toBe(false)
  })

  it('[R] leaves a card unparsed when one of its lines is beyond the sim', () => {
    expect(isFullyParsed('Flying\n{T}: Add {G}.', 'creature')).toBe(false)
  })
})

describe('parseScryfallCard.unparsed', () => {
  it('[R] never marks a land unparsed', () => {
    const land = scryfall({ id: 'tapland', type_line: 'Land', oracle_text: 'Tapland enters tapped.\n{T}: Add {G}.' })
    expect(parseScryfallCard(land).unparsed).toBe(false)
  })

  it('[R] marks a creature with an activated ability unparsed', () => {
    const dork = scryfall({ id: 'dork', oracle_text: '{T}: Add {G}.', power: '1', toughness: '1' })
    expect(parseScryfallCard(dork).unparsed).toBe(true)
  })
})

describe('parseDeck with missing card data', () => {
  it('[R] deals an unparsed, uncastable stand-in instead of dropping the entry', () => {
    const deck: DeckCard[] = [{ scryfallId: 'missing', quantity: 3, zone: 'main' }]
    const library = parseDeck(deck, new Map())

    expect(library).toHaveLength(3)
    expect(library[0]).toMatchObject({ unparsed: true, cost: null, cardType: 'other' })
  })
})

describe('simulationCoverage', () => {
  it('[R] is the share of nonland cards that are fully parsed', () => {
    const deck = [
      forest(),
      simCard({ id: 'a' }),
      simCard({ id: 'b' }),
      simCard({ id: 'c', unparsed: true }),
      simCard({ id: 'd', unparsed: true }),
    ]
    expect(simulationCoverage(deck)).toBe(0.5)
  })

  it('[R] is 1 for a deck with no nonland cards', () => {
    expect(simulationCoverage([forest()])).toBe(1)
  })
})

const COVERED = deckOf(Array.from({ length: 24 }, (_, i) => forest(`f-${i}`)), simCard({ id: 'bear', power: 2, toughness: 2 }))
const BLIND = deckOf(Array.from({ length: 24 }, (_, i) => forest(`f-${i}`)), simCard({ id: 'mystery', power: 2, toughness: 2, unparsed: true }))

describe('runSimulation coverage gate', () => {
  it('[R] measures the win rate when both decks clear the threshold', () => {
    const result = runSimulation(COVERED, COVERED, 20, 1)
    expect(result.coverage).toEqual([1, 1])
    expect(result.winRateMeasured).toBe(true)
  })

  it('[R] reports the win rate as unmeasured when either deck is under the threshold', () => {
    const result = runSimulation(COVERED, BLIND, 20, 1)
    expect(result.coverage[1]).toBeLessThan(COVERAGE_THRESHOLD)
    expect(result.winRateMeasured).toBe(false)
    // The games still ran: the caller can see what the sim was blind to.
    expect(result.totalGames).toBe(20)
  })
})

describe('simulationSignal', () => {
  const references = [
    { name: 'ref-a', deck: COVERED },
    { name: 'ref-b', deck: COVERED },
  ]

  it('[R] pools wins across every reference matchup', () => {
    const signal = simulationSignal(COVERED, references, 7, 10)
    const pooled = signal.matchups.reduce((n, m) => n + m.result.wins[0], 0)

    expect(signal.measured).toBe(true)
    expect(signal.matchups.map((m) => m.reference)).toEqual(['ref-a', 'ref-b'])
    expect(signal.winRate).toBe(pooled / 20)
    expect(signal.winRateCI95).not.toBeNull()
  })

  it('[R] withholds the win rate for a candidate under the threshold but keeps the matchups', () => {
    const signal = simulationSignal(BLIND, references, 7, 10)

    expect(signal.measured).toBe(false)
    expect(signal.winRate).toBeNull()
    expect(signal.winRateCI95).toBeNull()
    expect(signal.matchups).toHaveLength(2)
  })

  it('[R] runs headless with the default progress callback', () => {
    expect(() => runSimulation(COVERED, COVERED, 5, 3)).not.toThrow()
  })
})
