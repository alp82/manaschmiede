import { describe, expect, it } from 'vitest'
import { metricRate, runSimulation, wilsonCI } from '../simulation/runner'
import { MAX_TURNS } from '../simulation/game-state'
import type { GameResult, SimulationResult } from '../simulation/types'
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
  it('[R] returns the same result for the same seed', () => {
    const first = runSimulation(GREEN_DECK, RED_DECK, 50, 4242, noop)
    const second = runSimulation(GREEN_DECK, RED_DECK, 50, 4242, noop)

    expect(withoutElapsed(second)).toEqual(withoutElapsed(first))
  })

  it('[R] returns a different result for a different seed', () => {
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

describe('the decks it was handed', () => {
  /**
   * `runSimulation` plays thousands of games off one pair of arrays. Anything
   * it writes back - a shuffle in place, a tapped flag on a shared card - would
   * carry into every later game, and into whatever the caller does with the
   * deck afterwards.
   */
  it('[R] leaves both deck arrays untouched', () => {
    const deckA = deckOf([forest('a'), forest('b')], simCard({ id: 'bear', power: 2, toughness: 2 }))
    const deckB = deckOf([land('mountain', ['R'])], simCard({ id: 'goblin' }))
    const before = [structuredClone(deckA), structuredClone(deckB)]

    runSimulation(deckA, deckB, 50, 7, noop)

    expect(deckA).toEqual(before[0])
    expect(deckB).toEqual(before[1])
  })

  it('[R] plays a deck against itself without the two seats sharing state', () => {
    // The same array in both seats is the mirror-match case, and it is the one
    // that breaks loudest if a game writes to the deck.
    const deck = deckOf([forest('a')], simCard({ id: 'bear', power: 2, toughness: 2 }))
    const before = structuredClone(deck)

    const result = runSimulation(deck, deck, 50, 7, noop)

    expect(deck).toEqual(before)
    expect(result.wins[0] + result.wins[1] + result.draws).toBe(50)
  })
})

describe('onProgress', () => {
  const progressFor = (games: number) => {
    const completed: number[] = []
    runSimulation(GREEN_DECK, RED_DECK, games, 1, (n) => completed.push(n))
    return completed
  }

  it('[R] reports every hundredth game and then the total', () => {
    expect(progressFor(250)).toEqual([100, 200, 250])
  })

  it('[R] reports the total for a run shorter than one batch', () => {
    expect(progressFor(30)).toEqual([30])
  })

  it('[R] reports the total even for an empty run', () => {
    expect(progressFor(0)).toEqual([0])
  })

  it('[R] always reports the total last, even when that repeats a batch', () => {
    // The final call is unconditional on purpose: a caller that drives a
    // progress bar off it always sees 100%, whatever the batch size divides
    // into. A run of exactly 200 therefore reports 200 twice, and anything
    // counting the calls rather than reading the last one is wrong.
    expect(progressFor(200)).toEqual([100, 200, 200])
  })
})

describe('the accounting', () => {
  const result = runSimulation(GREEN_DECK, RED_DECK, 300, 11, noop)

  it('[R] assigns every game to a winner or to a draw', () => {
    expect(result.wins[0] + result.wins[1] + result.draws).toBe(result.totalGames)
  })

  it('[R] counts the same games in seat order as in deck order', () => {
    expect(result.seatWins[0] + result.seatWins[1]).toBe(result.wins[0] + result.wins[1])
  })

  it('[R] reports one turn bucket per round, plus a zero bucket', () => {
    expect(result.turnDistribution).toHaveLength(MAX_TURNS + 1)
    expect(result.turnDistribution[0]).toBe(0)
  })

  it('[R] puts every game in a turn bucket', () => {
    // A game that reached the cap still has `turns === MAX_TURNS`, so nothing
    // falls off the end of the histogram.
    const counted = result.turnDistribution.reduce((a, b) => a + b, 0)

    expect(counted).toBe(result.totalGames)
  })

  it('[R] reports averages consistent with the histogram', () => {
    const weighted = result.turnDistribution.reduce((sum, count, turn) => sum + count * turn, 0)

    expect(result.avgTurns).toBeCloseTo(weighted / result.totalGames, 10)
    expect(result.medianTurns).toBeGreaterThan(0)
    expect(result.medianTurns).toBeLessThanOrEqual(MAX_TURNS)
  })

  it('[R] reports every rate as a fraction of the games that sampled it', () => {
    for (const rates of [result.manaScrewRate, result.manaFloodRate, result.curveHitRate]) {
      for (const rate of rates) {
        expect(rate).toBeGreaterThanOrEqual(0)
        expect(rate).toBeLessThanOrEqual(1)
      }
    }
  })

  it('[R] accounts for every game when the count is odd', () => {
    const odd = runSimulation(GREEN_DECK, RED_DECK, 51, 11, noop)

    expect(odd.totalGames).toBe(51)
    expect(odd.wins[0] + odd.wins[1] + odd.draws).toBe(51)
  })

  it('[R] returns a zeroed result for a run of no games', () => {
    const empty = runSimulation(GREEN_DECK, RED_DECK, 0, 11, noop)

    expect(empty.totalGames).toBe(0)
    expect(empty.wins).toEqual([0, 0])
    expect(empty.draws).toBe(0)
    expect(empty.avgTurns).toBe(0)
    expect(empty.medianTurns).toBe(0)
    expect(empty.manaScrewRate).toEqual([0, 0])
    expect(empty.winRateCI95).toEqual([0, 0])
    expect(empty.turnDistribution.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('wilsonCI', () => {
  it('[R] reports a point at zero for no games', () => {
    // The panel divides by the interval width, so an empty run has to come back
    // as a degenerate interval rather than as NaN.
    expect(wilsonCI(0, 0)).toEqual([0, 0])
  })

  it('[R] tops out at exactly 1 when every game was won', () => {
    const [lower, upper] = wilsonCI(40, 40)

    expect(upper).toBe(1)
    expect(lower).toBeGreaterThan(0.9)
    expect(lower).toBeLessThan(1)
  })

  it('[R] bottoms out at exactly 0 when no game was won', () => {
    const [lower, upper] = wilsonCI(0, 40)

    expect(lower).toBe(0)
    expect(upper).toBeGreaterThan(0)
    expect(upper).toBeLessThan(0.1)
  })

  it('[R] brackets the observed rate', () => {
    const [lower, upper] = wilsonCI(30, 100)

    expect(lower).toBeLessThanOrEqual(0.3)
    expect(upper).toBeGreaterThanOrEqual(0.3)
  })

  it('[R] narrows as the sample grows', () => {
    const widths = [10, 100, 1000, 10000].map((n) => {
      const [lower, upper] = wilsonCI(n / 2, n)
      return upper - lower
    })

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1])
    }
  })

  it('[R] stays inside 0 and 1 at every rate', () => {
    for (let wins = 0; wins <= 20; wins++) {
      const [lower, upper] = wilsonCI(wins, 20)

      expect(lower).toBeGreaterThanOrEqual(0)
      expect(upper).toBeLessThanOrEqual(1)
      expect(lower).toBeLessThanOrEqual(upper)
    }
  })
})

describe('which deck sits in which seat', () => {
  /**
   * A deck of exactly seven cards, so the library is empty from the start and
   * the game is decided by the draw step alone: the player on the draw attempts
   * a draw on round 1 and loses, and the player on the play survives to round 2
   * and loses then. Either way this deck loses - but *which seat* wins says
   * which side of the table it was sitting on, which is the thing under test.
   */
  const NO_LIBRARY = [
    forest('a'),
    forest('b'),
    forest('c'),
    forest('d'),
    simCard({ id: 'bear-1', power: 2, toughness: 2 }),
    simCard({ id: 'bear-2', power: 2, toughness: 2 }),
    simCard({ id: 'bear-3', power: 2, toughness: 2 }),
  ]
  const FULL_LIBRARY = deckOf([], forest())

  it('[R] puts deck A on the play for the first game', () => {
    const one = runSimulation(NO_LIBRARY, FULL_LIBRARY, 1, 3, noop)

    // Deck A decked itself, so deck B won - from seat 1, the draw.
    expect(one.wins).toEqual([0, 1])
    expect(one.seatWins).toEqual([0, 1])
  })

  it('[R] puts deck A on the draw for the second game', () => {
    const two = runSimulation(NO_LIBRARY, FULL_LIBRARY, 2, 3, noop)

    // Deck B won both, once from each seat.
    expect(two.wins).toEqual([0, 2])
    expect(two.seatWins).toEqual([1, 1])
  })

  it('[R] gives deck A the extra game on the play when the count is odd', () => {
    // 51 games: deck A takes the play 26 times and the draw 25. Deck B wins
    // every game, so its seat tally is the mirror image of deck A's.
    const odd = runSimulation(NO_LIBRARY, FULL_LIBRARY, 51, 3, noop)

    expect(odd.wins).toEqual([0, 51])
    expect(odd.seatWins).toEqual([25, 26])
  })
})

describe('metricRate', () => {
  /** A finished game carrying one reading per seat for every mana metric. */
  const game = (
    manaScrew: [boolean | null, boolean | null],
    manaFlood: [boolean | null, boolean | null] = [null, null],
  ): GameResult => ({
    winner: 0,
    turns: 10,
    winCondition: 'life',
    manaScrew,
    manaFlood,
    curveHit: [null, null],
  })

  it('[R] divides by the games that sampled the metric, not by every game', () => {
    // One screwed game and one that ended before turn 4. Over every game that
    // reads 50%, which is the fast game reported as clean mana rather than as
    // no reading at all.
    const rates = metricRate([game([true, true]), game([null, null])], 'manaScrew')

    expect(rates).toEqual([1, 1])
  })

  it('[R] keeps a denominator per seat', () => {
    // One seat can be sampled while the other is not: the loser never takes
    // the turn the winner won on.
    const rates = metricRate([game([true, null]), game([false, false])], 'manaScrew')

    expect(rates).toEqual([0.5, 0])
  })

  it('[R] reads zero rather than NaN for a metric no game sampled', () => {
    expect(metricRate([game([null, null])], 'manaFlood')).toEqual([0, 0])
    expect(metricRate([], 'manaFlood')).toEqual([0, 0])
  })

  it('[R] reads each metric off its own field', () => {
    const rates = metricRate([game([false, false], [true, true])], 'manaFlood')

    expect(rates).toEqual([1, 1])
  })
})
