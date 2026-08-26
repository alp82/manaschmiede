import type { PerPlayer, SimCard, SimulationResult } from './types'
import { COVERAGE_THRESHOLD, runSimulation, simulationCoverage, wilsonCI } from './runner'

/**
 * Headless entry for the bench: the simulation signal (CONTEXT.md) for one
 * candidate deck against a fixed reference set of house decks.
 *
 * The reference set is a hook, not a list - the decks arrive as parsed
 * `SimCard[]`s chosen when the bench v2 scenario set is (#66). Nothing here
 * knows a card name. Runs from node with no worker and no DOM.
 */

/** One house deck of the reference set, named for the report. */
export interface ReferenceDeck {
  name: string
  deck: SimCard[]
}

export const BENCH_GAMES = 1000

export interface ReferenceMatchup {
  reference: string
  result: SimulationResult
}

export interface SimulationSignal {
  /** Coverage of the candidate; the reference decks' coverage is in each matchup. */
  coverage: number
  /**
   * Whether `winRate` may be quoted. False when the candidate or any
   * reference deck sits under `COVERAGE_THRESHOLD`; the matchups are still
   * reported so the sweep can see which archetype the sim is blind to.
   */
  measured: boolean
  /** Candidate wins over every game against every reference, or `null` when unmeasured. */
  winRate: number | null
  /** Wilson interval over the pooled games; `null` when unmeasured. */
  winRateCI95: PerPlayer<number> | null
  /** Candidate's mana-screw and flood rates, averaged across the matchups. */
  manaScrewRate: number
  manaFloodRate: number
  matchups: ReferenceMatchup[]
}

/**
 * Plays `candidate` against each reference deck for `games` games at `seed`,
 * and pools the outcome. The same seed is reused per matchup so a re-run
 * against a changed reference set replays the unchanged matchups exactly.
 */
export function simulationSignal(
  candidate: SimCard[],
  references: readonly ReferenceDeck[],
  seed: number,
  games = BENCH_GAMES,
): SimulationSignal {
  const matchups = references.map((ref) => ({
    reference: ref.name,
    result: runSimulation(candidate, ref.deck, games, seed),
  }))

  const coverage = simulationCoverage(candidate)
  const measured =
    coverage >= COVERAGE_THRESHOLD && matchups.every((m) => m.result.winRateMeasured)

  const totalGames = matchups.reduce((n, m) => n + m.result.totalGames, 0)
  const wins = matchups.reduce((n, m) => n + m.result.wins[0], 0)
  const mean = (pick: (r: SimulationResult) => number) =>
    matchups.length === 0 ? 0 : matchups.reduce((n, m) => n + pick(m.result), 0) / matchups.length

  return {
    coverage,
    measured,
    winRate: measured && totalGames > 0 ? wins / totalGames : null,
    winRateCI95: measured && totalGames > 0 ? wilsonCI(wins, totalGames) : null,
    manaScrewRate: mean((r) => r.manaScrewRate[0]),
    manaFloodRate: mean((r) => r.manaFloodRate[0]),
    matchups,
  }
}
