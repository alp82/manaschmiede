import { useState, useEffect, useCallback, useMemo } from 'react'
import type { DeckCard } from '../lib/deck-utils'
import type { ScryfallCard } from '../lib/scryfall/types'
import type { PerPlayerRate, SimulationResult } from '../lib/simulation/types'
import { Button } from './ui/Button'
import { useSimulation } from '../lib/simulation/use-simulation'
import { loadDecks, type LocalDeck } from '../lib/deck-storage'
import { getLocalizedCardData } from '../lib/scryfall/client'
import { useI18n } from '../lib/i18n'

interface SimulationPanelProps {
  deckId: string
  deckName: string
  cards: DeckCard[]
  cardDataMap: Map<string, ScryfallCard>
}

export function SimulationPanel({ deckId, deckName, cards, cardDataMap }: SimulationPanelProps) {
  const { scryfallLang } = useI18n()
  const { state, run, cancel } = useSimulation()
  const [opponentId, setOpponentId] = useState<string>('mirror')
  const [opponentDeck, setOpponentDeck] = useState<LocalDeck | null>(null)
  const [opponentCardData, setOpponentCardData] = useState<Map<string, ScryfallCard>>(new Map())
  const [loadingOpponent, setLoadingOpponent] = useState(false)

  const savedDecks = useMemo(() => {
    return loadDecks().filter((d) => d.id !== deckId)
  }, [deckId])

  // Fetch opponent card data when selection changes
  useEffect(() => {
    if (opponentId === 'mirror') {
      setOpponentDeck(null)
      setOpponentCardData(new Map())
      return
    }

    const selected = savedDecks.find((d) => d.id === opponentId)
    if (!selected) return

    setOpponentDeck(selected)
    setLoadingOpponent(true)

    const newMap = new Map<string, ScryfallCard>()
    let cancelled = false

    async function fetchAll() {
      for (const dc of selected!.cards) {
        if (cancelled) return
        const card = await getLocalizedCardData(undefined, dc.scryfallId, undefined, undefined, scryfallLang)
        if (card) newMap.set(dc.scryfallId, card)
      }
      if (!cancelled) {
        setOpponentCardData(newMap)
        setLoadingOpponent(false)
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [opponentId, savedDecks, scryfallLang])

  const isMirror = opponentId === 'mirror'

  /**
   * A run is a function of both decks *and* the seed, so the seed alone doesn't
   * identify it. Edit a deck or switch opponents after a run and the same seed
   * yields a different result - this key is what lets the UI notice.
   */
  const matchupKey = useMemo(
    () => `${opponentId}|${deckSignature(cards)}|${deckSignature(opponentDeck?.cards)}`,
    [opponentId, cards, opponentDeck],
  )
  const [ranMatchup, setRanMatchup] = useState<string | null>(null)

  /**
   * `seed` omitted means a fresh sample; passing the seed of a finished run
   * reproduces it game for game, which is what makes a surprising result
   * checkable and a bug report reproducible.
   */
  const handleRun = useCallback((seed?: number) => {
    if (isMirror) {
      run(cards, cardDataMap, undefined, undefined, undefined, seed)
    } else if (opponentDeck) {
      run(cards, cardDataMap, opponentDeck.cards, opponentCardData, undefined, seed)
    } else {
      return
    }
    setRanMatchup(matchupKey)
  }, [isMirror, cards, cardDataMap, opponentDeck, opponentCardData, matchupKey, run])

  const runFresh = useCallback(() => handleRun(), [handleRun])
  const repeatSeed = useCallback(() => handleRun(state.seed), [handleRun, state.seed])

  /** Repeating a seed only reproduces anything while the matchup is unchanged. */
  const canRepeatSeed = state.status === 'done' && ranMatchup === matchupKey

  const opponentName = isMirror ? deckName : (opponentDeck?.name ?? 'Opponent')

  /** Short side labels for the per-deck metrics; full names don't fit a column. */
  const sideLabels: [string, string] = isMirror
    ? ['A', 'B']
    : [abbreviate(deckName), abbreviate(opponentName)]

  return (
    <div className="divide-y divide-hairline/60 border border-hairline bg-ash-800/40">
      <div className="flex items-center justify-between px-4 py-3">
        <h4 className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
          SIMULATION
        </h4>
        <div className="flex items-center gap-2">
          {state.status === 'idle' && (
            <Button variant="secondary" size="sm" onClick={runFresh} disabled={loadingOpponent}>
              RUN SIMULATION
            </Button>
          )}
          {state.status === 'running' && (
            <Button variant="ghost" size="sm" onClick={cancel}>
              CANCEL
            </Button>
          )}
          {state.status === 'done' && (
            <>
              {canRepeatSeed && (
                <Button variant="ghost" size="sm" onClick={repeatSeed} disabled={loadingOpponent}>
                  REPEAT SEED
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={runFresh} disabled={loadingOpponent}>
                RE-RUN
              </Button>
            </>
          )}
          {state.status === 'error' && (
            <Button variant="secondary" size="sm" onClick={runFresh} disabled={loadingOpponent}>
              TRY AGAIN
            </Button>
          )}
        </div>
      </div>

      {/* Opponent selector */}
      <div className="px-4 py-3">
        <label className="mb-2 block font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
          OPPONENT
        </label>
        <select
          value={opponentId}
          onChange={(e) => setOpponentId(e.target.value)}
          className="w-full cursor-pointer appearance-none border border-hairline bg-ash-800 px-3 py-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-100 focus:border-cream-200 focus:outline-none"
        >
          <option value="mirror">MIRROR MATCH</option>
          {savedDecks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.cards.reduce((s, c) => s + c.quantity, 0)} cards
            </option>
          ))}
        </select>
        {loadingOpponent && (
          <span className="mt-1 block font-mono text-mono-marginal tabular-nums text-cream-500">
            Loading opponent deck...
          </span>
        )}
      </div>

      {state.status === 'running' && (
        <div className="px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-mono-marginal tabular-nums text-cream-400">
              {Math.round(state.progress * 100)}%
            </span>
          </div>
          <div className="h-px w-full bg-hairline/40">
            <div
              className="h-px bg-cream-100 transition-[width] duration-100"
              style={{ width: `${state.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {state.status === 'error' && state.error && (
        <div className="px-4 py-4">
          <p className="font-mono text-mono-tag text-ink-red-bright">{state.error}</p>
        </div>
      )}

      {state.status === 'done' && state.result && (
        <>
          {/* Win rates */}
          <div className="grid grid-cols-3 divide-x divide-hairline/60">
            <StatBox
              label={isMirror ? 'COPY A' : deckName.toUpperCase()}
              value={`${((state.result.wins[0] / state.result.totalGames) * 100).toFixed(1)}%`}
            />
            <StatBox
              label="DRAWS"
              value={`${((state.result.draws / state.result.totalGames) * 100).toFixed(1)}%`}
            />
            <StatBox
              label={isMirror ? 'COPY B' : opponentName.toUpperCase()}
              value={`${((state.result.wins[1] / state.result.totalGames) * 100).toFixed(1)}%`}
            />
          </div>

          <div className="grid grid-cols-3 divide-x divide-hairline/60">
            <SplitStatBox
              label="MANA SCREW"
              sides={sideLabels}
              rates={state.result.manaScrewRate}
            />
            <SplitStatBox
              label="MANA FLOOD"
              sides={sideLabels}
              rates={state.result.manaFloodRate}
            />
            <SplitStatBox
              label="CURVE HIT"
              sides={sideLabels}
              rates={state.result.curveHitRate}
            />
          </div>

          {/*
            AVG TURNS, MEDIAN TURNS and the TURN DISTRIBUTION heading below all
            read a round count, and say TURNS on purpose. The number is the
            round the game ended on, which is the turn the winner ended it on -
            "decided on turn eight" is how a Magic player reads a game length,
            and ROUNDS would be accurate but unfamiliar.
          */}
          <div className="grid grid-cols-2 divide-x divide-hairline/60">
            <StatBox
              label="AVG TURNS"
              value={state.result.avgRounds.toFixed(1)}
            />
            <StatBox
              label="MEDIAN TURNS"
              value={state.result.medianRounds.toFixed(1)}
            />
          </div>

          <div className="px-4 py-4">
            <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              TURN DISTRIBUTION
            </h4>
            <RoundHistogram distribution={state.result.roundDistribution} />
          </div>

          <div className="px-4 py-3">
            <span className="font-mono text-mono-marginal tabular-nums text-cream-500">
              {state.result.totalGames} games in {state.result.elapsed.toFixed(0)}ms
              {' — '}
              95% CI [{(state.result.winRateCI95[0] * 100).toFixed(1)}%, {(state.result.winRateCI95[1] * 100).toFixed(1)}%]
              {' — '}
              ON THE PLAY {(onThePlayRate(state.result) * 100).toFixed(1)}%
              {' — '}
              DECKED OUT {((state.result.winConditions.mill / state.result.totalGames) * 100).toFixed(1)}%
              {' — '}
              SEED {state.seed}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/** Identifies a deck by what the simulation actually reads: which cards, how many, where. */
function deckSignature(cards: DeckCard[] | undefined): string {
  if (!cards) return ''
  return cards.map((c) => `${c.scryfallId}:${c.quantity}:${c.zone}`).join(',')
}

/**
 * Player 0's share of the games that had a winner. The seats alternate every
 * game, so this is the matchup's tempo bias and not one deck's advantage.
 */
function onThePlayRate(result: SimulationResult): number {
  const decided = result.seatWins[0] + result.seatWins[1]
  return decided > 0 ? result.seatWins[0] / decided : 0
}

/** Enough of a deck name to tell two of them apart in a narrow column. */
function abbreviate(name: string): string {
  const upper = name.toUpperCase()
  return upper.length > 8 ? `${upper.slice(0, 7).trimEnd()}…` : upper
}

/**
 * One metric, reported for both decks.
 *
 * Mana screw, flood, and curve are properties of a deck's draws, not of the
 * matchup. Showing a single number means picking one of the two decks and
 * labelling it as if it described both.
 */
function SplitStatBox({
  label,
  sides,
  rates,
}: {
  label: string
  sides: [string, string]
  rates: PerPlayerRate
}) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
        {label}
      </div>
      <div className="mt-2 space-y-1">
        {sides.map((side, i) => (
          // Index as key: two decks can share an abbreviated name.
          <div key={i} className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {side}
            </span>
            <span className="font-mono text-mono-num tabular-nums text-cream-100">
              {(rates[i] * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="font-mono text-xl tabular-nums text-cream-100">{value}</div>
      <div className="mt-1 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
        {label}
      </div>
    </div>
  )
}

function RoundHistogram({ distribution }: { distribution: number[] }) {
  const trimmed = distribution.slice(1)
  let lastNonZero = 0
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] > 0) { lastNonZero = i; break }
  }
  const visible = trimmed.slice(0, Math.max(lastNonZero + 1, 10))
  const max = Math.max(...visible, 1)

  return (
    <div className="flex items-end gap-px">
      {visible.map((count, i) => {
        const barHeight = max > 0 ? Math.round((count / max) * 48) : 0
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            {count > 0 && (
              <span className="font-mono text-[9px] tabular-nums text-cream-400">
                {count}
              </span>
            )}
            <div
              className="w-full bg-cream-300"
              style={{ height: `${barHeight}px`, minHeight: count > 0 ? '2px' : '0' }}
            />
            {(i + 1) % 5 === 0 && (
              <span className="font-mono text-[9px] tabular-nums text-cream-500">
                {i + 1}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
