import type { GameResult, PerPlayer, PerPlayerRate, SimCard, SimulationResult } from './types'
import { MAX_ROUNDS, runGame } from './game-state'

function xorshift128(seed: number) {
  let s0 = seed | 0 || 1
  let s1 = (seed * 1664525 + 1013904223) | 0 || 1
  let s2 = (seed * 214013 + 2531011) | 0 || 1
  let s3 = (seed * 48271) | 0 || 1
  return (): number => {
    const t = s3
    s3 = s2
    s2 = s1
    s1 = s0
    let u = t ^ (t << 11)
    u = u ^ (u >>> 8)
    s0 = u ^ s1 ^ (s1 >>> 19)
    return (s0 >>> 0) / 4294967296
  }
}

/**
 * The 95% Wilson score interval for `wins` out of `n`.
 *
 * Exported for the suite: the boundaries are what the panel reads as "how much
 * of this number is noise", and they are not observable through
 * `runSimulation` at the sample sizes a test can afford.
 */
export function wilsonCI(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const p = wins / n
  const z = 1.96
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

/** The `GameResult` fields `metricRate` can be asked about. */
type MetricField = 'manaScrew' | 'manaFlood' | 'curveHit'

/**
 * How often `metric` was true, per deck, over the games that sampled it.
 *
 * The denominator is the sampled games and not the whole run. A `null` reading
 * means the game ended before the metric's sample turn, and counting that as a
 * miss puts game length back into the number: a deck that wins on turn six
 * cannot flood on turn eight, so dividing by every game reports a fast deck as
 * a disciplined one. A metric no game sampled reads 0 rather than NaN.
 *
 * Exported for the suite - the two denominators only disagree on a run holding
 * both sampled and unsampled games, which is not something a seed can pin.
 */
export function metricRate(results: readonly GameResult[], metric: MetricField): PerPlayerRate {
  const hits: PerPlayer<number> = [0, 0]
  const sampled: PerPlayer<number> = [0, 0]

  for (const result of results) {
    for (const seat of [0, 1] as const) {
      const reading = result[metric][seat]
      if (reading === null) continue
      sampled[seat]++
      if (reading) hits[seat]++
    }
  }

  return [
    sampled[0] > 0 ? hits[0] / sampled[0] : 0,
    sampled[1] > 0 ? hits[1] / sampled[1] : 0,
  ]
}

const swap = <T,>([a, b]: PerPlayer<T>): PerPlayer<T> => [b, a]

/**
 * The same game with the two seats swapped, so a result played with deck B on
 * the play can be counted under deck A's column.
 */
function swapSeats(result: GameResult): GameResult {
  return {
    ...result,
    winner: result.winner === -1 ? -1 : ((1 - result.winner) as 0 | 1),
    manaScrew: swap(result.manaScrew),
    manaFlood: swap(result.manaFlood),
    curveHit: swap(result.curveHit),
  }
}

/**
 * Plays `deckA` against `deckB` and reports how the two decks did.
 *
 * The seats alternate: deck A is on the play for every other game. Being on the
 * play is worth real win percentage - it is most of what one deck can hold over
 * an identical copy of itself - so leaving one deck in seat 0 for the whole run
 * measures the seat as much as the deck, and two identical decks come back with
 * different win rates. Alternating puts that advantage on both decks equally
 * and leaves `wins` measuring the decks. `seatWins` keeps the seat effect
 * visible rather than hidden.
 *
 * An odd `games` gives deck A one extra game on the play.
 */
export function runSimulation(
  deckA: SimCard[],
  deckB: SimCard[],
  games: number,
  seed: number,
  onProgress: (completed: number) => void,
): SimulationResult {
  const rng = xorshift128(seed)
  const start = performance.now()

  const results: GameResult[] = []
  const seatWins: PerPlayer<number> = [0, 0]
  const BATCH_SIZE = 100

  for (let i = 0; i < games; i++) {
    const aOnThePlay = i % 2 === 0
    const played = aOnThePlay ? runGame(deckA, deckB, rng) : runGame(deckB, deckA, rng)
    if (played.winner !== -1) seatWins[played.winner]++
    results.push(aOnThePlay ? played : swapSeats(played))

    if ((i + 1) % BATCH_SIZE === 0) {
      onProgress(i + 1)
    }
  }
  onProgress(games)

  const wins: PerPlayer<number> = [0, 0]
  let draws = 0
  let totalRounds = 0
  const winConditions: Record<GameResult['winCondition'], number> = { life: 0, mill: 0, draw: 0 }
  const roundCounts: number[] = []
  const roundDistribution: number[] = new Array(MAX_ROUNDS + 1).fill(0)

  for (const r of results) {
    if (r.winner === -1) draws++
    else wins[r.winner]++
    winConditions[r.winCondition]++
    totalRounds += r.rounds
    roundCounts.push(r.rounds)
    if (r.rounds <= MAX_ROUNDS) roundDistribution[r.rounds]++
  }

  roundCounts.sort((a, b) => a - b)
  const medianRounds = roundCounts.length > 0
    ? roundCounts.length % 2 === 0
      ? (roundCounts[roundCounts.length / 2 - 1] + roundCounts[roundCounts.length / 2]) / 2
      : roundCounts[Math.floor(roundCounts.length / 2)]
    : 0

  const elapsed = performance.now() - start

  return {
    totalGames: games,
    wins,
    seatWins,
    draws,
    winConditions,
    avgRounds: games > 0 ? totalRounds / games : 0,
    medianRounds,
    manaScrewRate: metricRate(results, 'manaScrew'),
    manaFloodRate: metricRate(results, 'manaFlood'),
    curveHitRate: metricRate(results, 'curveHit'),
    winRateCI95: wilsonCI(wins[0], games),
    elapsed,
    roundDistribution,
  }
}
