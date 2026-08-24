import type { GameResult, PerPlayer, PerPlayerRate, SimCard, SimulationResult } from './types'
import { MAX_TURNS, runGame } from './game-state'

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

function wilsonCI(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const p = wins / n
  const z = 1.96
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
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
  const seatWins: [number, number] = [0, 0]
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

  const wins: [number, number] = [0, 0]
  let draws = 0
  let totalTurns = 0
  const manaScrewCount: [number, number] = [0, 0]
  const manaFloodCount: [number, number] = [0, 0]
  const curveHitCount: [number, number] = [0, 0]
  const winConditions: Record<GameResult['winCondition'], number> = { life: 0, mill: 0, draw: 0 }
  const turnCounts: number[] = []
  const turnDistribution: number[] = new Array(MAX_TURNS + 1).fill(0)

  for (const r of results) {
    if (r.winner === -1) draws++
    else wins[r.winner]++
    winConditions[r.winCondition]++
    totalTurns += r.turns
    turnCounts.push(r.turns)
    if (r.turns <= MAX_TURNS) turnDistribution[r.turns]++
    for (const seat of [0, 1] as const) {
      if (r.manaScrew[seat]) manaScrewCount[seat]++
      if (r.manaFlood[seat]) manaFloodCount[seat]++
      if (r.curveHit[seat]) curveHitCount[seat]++
    }
  }

  const rate = (counts: [number, number]): PerPlayerRate =>
    games > 0 ? [counts[0] / games, counts[1] / games] : [0, 0]

  turnCounts.sort((a, b) => a - b)
  const medianTurns = turnCounts.length > 0
    ? turnCounts.length % 2 === 0
      ? (turnCounts[turnCounts.length / 2 - 1] + turnCounts[turnCounts.length / 2]) / 2
      : turnCounts[Math.floor(turnCounts.length / 2)]
    : 0

  const elapsed = performance.now() - start

  return {
    totalGames: games,
    wins,
    seatWins,
    draws,
    winConditions,
    avgTurns: games > 0 ? totalTurns / games : 0,
    medianTurns,
    manaScrewRate: rate(manaScrewCount),
    manaFloodRate: rate(manaFloodCount),
    curveHitRate: rate(curveHitCount),
    winRateCI95: wilsonCI(wins[0], games),
    elapsed,
    turnDistribution,
  }
}
