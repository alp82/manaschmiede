import { describe, expect, it } from 'vitest'
import { deserializeSimCard, serializeSimCard } from '../simulation/types'
import type { Keyword } from '../simulation/types'
import { cost, forest, simCard } from './sim-fixtures'

/**
 * The worker boundary. `SimCard.keywords` is a `Set`, and structured cloning
 * carries a `Set` but `JSON` does not - so the pair exists to keep the wire
 * format explicit rather than to depend on which one the host uses. A keyword
 * lost here reads as a vanilla creature on the other side, silently.
 */
describe('serializeSimCard and deserializeSimCard', () => {
  const knight = simCard({
    id: 'knight',
    name: 'White Knight',
    cost: cost(1, { W: 1 }),
    power: 2,
    toughness: 2,
    keywords: new Set<Keyword>(['first_strike', 'flying']),
    effects: [{ trigger: 'etb', action: { type: 'draw', count: 1 } }],
  })

  it('[R] sends the keywords as an array', () => {
    expect(serializeSimCard(knight).keywords).toEqual(['first_strike', 'flying'])
  })

  it('[R] restores the keywords as a set', () => {
    const restored = deserializeSimCard(serializeSimCard(knight))

    expect(restored.keywords).toBeInstanceOf(Set)
    expect(restored.keywords.has('first_strike')).toBe(true)
    expect(restored.keywords.has('flying')).toBe(true)
  })

  it('[R] round-trips a card unchanged', () => {
    expect(deserializeSimCard(serializeSimCard(knight))).toEqual(knight)
  })

  it('[R] round-trips a land, cost and all', () => {
    // A land's `cost` is null, which is what keeps it out of `chooseCasts`.
    const restored = deserializeSimCard(serializeSimCard(forest('a')))

    expect(restored).toEqual(forest('a'))
    expect(restored.cost).toBeNull()
  })

  it('[R] round-trips a card with no keywords', () => {
    const vanilla = simCard({ id: 'bear', power: 2, toughness: 2 })

    expect(deserializeSimCard(serializeSimCard(vanilla)).keywords).toEqual(new Set())
  })

  it('[R] survives the structured clone the worker post actually does', () => {
    const wire = structuredClone(serializeSimCard(knight))

    expect(deserializeSimCard(wire)).toEqual(knight)
  })
})
