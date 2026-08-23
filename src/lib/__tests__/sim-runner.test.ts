import { describe, expect, it } from 'vitest'
import { runSimulation } from '../simulation/runner'
import type { SimulationResult } from '../simulation/types'
import { deckOf, forest, land, simCard } from './sim-fixtures'

/**
 * `elapsed` is wall-clock, so it's the one field that can't repeat. Every other
 * field is a pure function of (decks, games, seed) - that's what makes a seed
 * worth surfacing in the UI at all.
 */
function withoutElapsed(result: SimulationResult) {
  const { elapsed: _elapsed, ...rest } = result
  return rest
}

const GREEN_DECK = deckOf(
  Array.from({ length: 24 }, (_, i) => forest(`forest-${i}`)),
  simCard({ id: 'bear', power: 2, toughness: 2 }),
)

const RED_DECK = deckOf(
  Array.from({ length: 22 }, (_, i) => land(`mountain-${i}`, ['R'])),
  simCard({ id: 'goblin', power: 1, toughness: 1, cost: { generic: 0, colored: { R: 1 }, cmc: 1 } }),
)

const noop = () => {}

describe('runSimulation', () => {
  it('returns the same result for the same seed', () => {
    const first = runSimulation(GREEN_DECK, RED_DECK, 50, 4242, noop)
    const second = runSimulation(GREEN_DECK, RED_DECK, 50, 4242, noop)

    expect(withoutElapsed(second)).toEqual(withoutElapsed(first))
  })

  it('returns a different result for a different seed', () => {
    const first = runSimulation(GREEN_DECK, RED_DECK, 50, 4242, noop)
    const second = runSimulation(GREEN_DECK, RED_DECK, 50, 9999, noop)

    expect(withoutElapsed(second)).not.toEqual(withoutElapsed(first))
  })
})
