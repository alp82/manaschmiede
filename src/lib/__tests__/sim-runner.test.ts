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

describe('seats', () => {
  /**
   * Being on the play is worth real win percentage, so a run that leaves one
   * deck in seat 0 throughout measures the seat as much as the deck. These are
   * the properties that make a reported win rate a statement about decks.
   */
  const mirror = runSimulation(GREEN_DECK, GREEN_DECK, 2000, 42, noop)

  it('[R] splits a mirror match evenly', () => {
    // With the seats alternating this is an accounting invariant rather than a
    // claim about the model - it fails if the seats stop alternating, or if
    // `swapSeats` misses a field. The claim about the model is the seat spread
    // below.
    const decided = mirror.wins[0] + mirror.wins[1]

    expect(Math.abs(mirror.wins[0] / decided - 0.5)).toBeLessThan(0.03)
  })

  it('[R] does not send a quarter of a mirror match to the round cap', () => {
    expect(mirror.draws / mirror.totalGames).toBeLessThan(0.05)
  })

  it('[R] keeps the seat advantage in an aggressive mirror plausible', () => {
    // This is the assertion that can fail. An aggressive deck should favour the
    // player who moves first, by enough to see and not by so much that the
    // extra card the player on the draw sees counts for nothing. It read 43%
    // when tempo was worth nothing in the model, and 87% when the combat AI
    // stalled every board and the game came down to who decked first.
    const decided = mirror.seatWins[0] + mirror.seatWins[1]
    const onThePlay = mirror.seatWins[0] / decided

    expect(onThePlay).toBeGreaterThan(0.5)
    expect(onThePlay).toBeLessThan(0.65)
  })

  it('[R] reports the same matchup either way round', () => {
    const forward = runSimulation(GREEN_DECK, RED_DECK, 1000, 42, noop)
    const reversed = runSimulation(RED_DECK, GREEN_DECK, 1000, 42, noop)

    expect(Math.abs(forward.wins[0] - reversed.wins[1])).toBeLessThan(60)
  })

  it('[R] reports the mana metrics for both decks', () => {
    const result = runSimulation(GREEN_DECK, RED_DECK, 200, 42, noop)

    expect(result.manaScrewRate).toHaveLength(2)
    expect(result.manaFloodRate).toHaveLength(2)
    expect(result.curveHitRate).toHaveLength(2)
    expect(result.curveHitRate[0]).not.toBe(result.curveHitRate[1])
  })

  it('[R] keeps the headline win rate inside its own interval', () => {
    // The win, draw, and loss percentages the panel shows are all over
    // `totalGames`, so the interval has to be too.
    const rate = mirror.wins[0] / mirror.totalGames

    expect(rate).toBeGreaterThanOrEqual(mirror.winRateCI95[0])
    expect(rate).toBeLessThanOrEqual(mirror.winRateCI95[1])
  })

  it('[R] accounts for every game in the win conditions', () => {
    const { life, mill, draw } = mirror.winConditions

    expect(life + mill + draw).toBe(mirror.totalGames)
    expect(draw).toBe(mirror.draws)
  })
})
