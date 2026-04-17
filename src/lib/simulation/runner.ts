import type { GameResult, SimCard, SimulationResult } from './types'
import { runGame } from './game-state'

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
  const BATCH_SIZE = 100

  for (let i = 0; i < games; i++) {
    const result = runGame(deckA, deckB, rng)
    results.push(result)

    if ((i + 1) % BATCH_SIZE === 0) {
      onProgress(i + 1)
    }
  }
  onProgress(games)

  const wins: [number, number] = [0, 0]
  let draws = 0
  let totalTurns = 0
  let manaScrewCount = 0
  let manaFloodCount = 0
  let curveHitCount = 0
  const turnCounts: number[] = []
  const turnDistribution: number[] = new Array(51).fill(0)

  for (const r of results) {
    if (r.winner === -1) draws++
    else wins[r.winner]++
    totalTurns += r.turns
    turnCounts.push(r.turns)
    if (r.turns <= 50) turnDistribution[r.turns]++
    if (r.p0ManaScrew) manaScrewCount++
    if (r.p0ManaFlood) manaFloodCount++
    if (r.p0CurveHit) curveHitCount++
  }

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
    draws,
    avgTurns: games > 0 ? totalTurns / games : 0,
    medianTurns,
    manaScrewRate: games > 0 ? manaScrewCount / games : 0,
    manaFloodRate: games > 0 ? manaFloodCount / games : 0,
    curveHitRate: games > 0 ? curveHitCount / games : 0,
    winRateCI95: wilsonCI(wins[0], games),
    elapsed,
    turnDistribution,
  }
}
