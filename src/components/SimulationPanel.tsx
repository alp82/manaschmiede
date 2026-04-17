import { useState, useEffect, useCallback, useMemo } from 'react'
import type { DeckCard } from '../lib/deck-utils'
import type { ScryfallCard } from '../lib/scryfall/types'
import { Button } from './ui/Button'
import { useSimulation } from '../lib/simulation/use-simulation'
import { loadDecks, type LocalDeck } from '../lib/deck-storage'
import { getLocalizedCardData } from '../lib/scryfall/client'
import { useI18n } from '../lib/i18n'
import { FORMAT_LABELS } from '../lib/deck-utils'

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

  const handleRun = useCallback(() => {
    if (isMirror) {
      run(cards, cardDataMap)
    } else if (opponentDeck) {
      run(cards, cardDataMap, opponentDeck.cards, opponentCardData)
    }
  }, [isMirror, cards, cardDataMap, opponentDeck, opponentCardData, run])

  const opponentName = isMirror ? deckName : (opponentDeck?.name ?? 'Opponent')

  return (
    <div className="divide-y divide-hairline/60 border border-hairline bg-ash-800/40">
      <div className="flex items-center justify-between px-4 py-3">
        <h4 className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
          SIMULATION
        </h4>
        {state.status === 'idle' && (
          <Button variant="secondary" size="sm" onClick={handleRun} disabled={loadingOpponent}>
            RUN SIMULATION
          </Button>
        )}
        {state.status === 'running' && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            CANCEL
          </Button>
        )}
        {state.status === 'done' && (
          <Button variant="secondary" size="sm" onClick={handleRun} disabled={loadingOpponent}>
            RE-RUN
          </Button>
        )}
        {state.status === 'error' && (
          <Button variant="secondary" size="sm" onClick={handleRun} disabled={loadingOpponent}>
            TRY AGAIN
          </Button>
        )}
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
              {d.name} — {FORMAT_LABELS[d.format]} — {d.cards.reduce((s, c) => s + c.quantity, 0)} cards
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
              label={isMirror ? 'P1 WINS' : deckName.toUpperCase()}
              value={`${((state.result.wins[0] / state.result.totalGames) * 100).toFixed(1)}%`}
            />
            <StatBox
              label="DRAWS"
              value={`${((state.result.draws / state.result.totalGames) * 100).toFixed(1)}%`}
            />
            <StatBox
              label={isMirror ? 'P2 WINS' : opponentName.toUpperCase()}
              value={`${((state.result.wins[1] / state.result.totalGames) * 100).toFixed(1)}%`}
            />
          </div>

          <div className="grid grid-cols-3 divide-x divide-hairline/60">
            <StatBox
              label="MANA SCREW"
              value={`${(state.result.manaScrewRate * 100).toFixed(1)}%`}
            />
            <StatBox
              label="MANA FLOOD"
              value={`${(state.result.manaFloodRate * 100).toFixed(1)}%`}
            />
            <StatBox
              label="CURVE HIT"
              value={`${(state.result.curveHitRate * 100).toFixed(1)}%`}
            />
          </div>

          <div className="grid grid-cols-2 divide-x divide-hairline/60">
            <StatBox
              label="AVG TURNS"
              value={state.result.avgTurns.toFixed(1)}
            />
            <StatBox
              label="MEDIAN TURNS"
              value={state.result.medianTurns.toFixed(1)}
            />
          </div>

          <div className="px-4 py-4">
            <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              TURN DISTRIBUTION
            </h4>
            <TurnHistogram distribution={state.result.turnDistribution} />
          </div>

          <div className="px-4 py-3">
            <span className="font-mono text-mono-marginal tabular-nums text-cream-500">
              {state.result.totalGames} games in {state.result.elapsed.toFixed(0)}ms
              {' — '}
              95% CI [{(state.result.winRateCI95[0] * 100).toFixed(1)}%, {(state.result.winRateCI95[1] * 100).toFixed(1)}%]
            </span>
          </div>
        </>
      )}
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

function TurnHistogram({ distribution }: { distribution: number[] }) {
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
