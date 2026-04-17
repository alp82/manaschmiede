/**
 * Prototype: Simulation benchmark harness
 *
 * Mount this component anywhere to test:
 * 1. Worker instantiation under Vite + SSR
 * 2. Progress reporting via postMessage
 * 3. Performance of 5000 games
 * 4. React hook cleanup under Strict Mode
 *
 * Usage: import { SimBenchmark } from '../.prototypes/sim-benchmark'
 *        and render <SimBenchmark /> in any page.
 *
 * NOT production code. Lives in .prototypes/ for reference.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types (duplicated from worker — in production these live in shared types.ts) ──

type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G'

interface SimCard {
  name: string
  isLand: boolean
  cmc: number
  power: number
  toughness: number
  producesColor: ManaColor | null
  hasHaste: boolean
  hasFlying: boolean
  hasDeathtouch: boolean
  hasFirstStrike: boolean
  hasTrample: boolean
  hasLifelink: boolean
}

type WorkerOutgoing =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; wins: [number, number]; draws: number; avgTurns: number; elapsed: number }
  | { type: 'error'; message: string }

// ── Test Decks ─────────────────────────────────────────────────────────

function makeCard(
  name: string,
  overrides: Partial<SimCard> = {},
): SimCard {
  return {
    name,
    isLand: false,
    cmc: 2,
    power: 2,
    toughness: 2,
    producesColor: null,
    hasHaste: false,
    hasFlying: false,
    hasDeathtouch: false,
    hasFirstStrike: false,
    hasTrample: false,
    hasLifelink: false,
    ...overrides,
  }
}

function buildTestDeck(style: 'aggro' | 'midrange'): SimCard[] {
  const cards: SimCard[] = []

  // 24 lands
  for (let i = 0; i < 24; i++) {
    cards.push(makeCard('Mountain', { isLand: true, cmc: 0, power: 0, toughness: 0, producesColor: 'R' }))
  }

  if (style === 'aggro') {
    // 16x 1-drops (2/1 haste)
    for (let i = 0; i < 16; i++) {
      cards.push(makeCard('Goblin Guide', { cmc: 1, power: 2, toughness: 1, hasHaste: true }))
    }
    // 12x 2-drops (3/1)
    for (let i = 0; i < 12; i++) {
      cards.push(makeCard('Ash Zealot', { cmc: 2, power: 3, toughness: 1, hasFirstStrike: true }))
    }
    // 8x 3-drops (3/3)
    for (let i = 0; i < 8; i++) {
      cards.push(makeCard('Boros Reckoner', { cmc: 3, power: 3, toughness: 3 }))
    }
  } else {
    // 8x 2-drops (2/3)
    for (let i = 0; i < 8; i++) {
      cards.push(makeCard('Wall of Omens', { cmc: 2, power: 2, toughness: 3 }))
    }
    // 12x 3-drops (3/3 flying)
    for (let i = 0; i < 12; i++) {
      cards.push(makeCard('Mantis Rider', { cmc: 3, power: 3, toughness: 3, hasFlying: true }))
    }
    // 8x 4-drops (4/4)
    for (let i = 0; i < 8; i++) {
      cards.push(makeCard('Siege Rhino', { cmc: 4, power: 4, toughness: 4, hasLifelink: true }))
    }
    // 8x 5-drops (5/5 trample)
    for (let i = 0; i < 8; i++) {
      cards.push(makeCard('Thragtusk', { cmc: 5, power: 5, toughness: 5, hasTrample: true }))
    }
  }

  return cards
}

// ── Hook ───────────────────────────────────────────────────────────────

interface SimState {
  running: boolean
  progress: number
  total: number
  result: { wins: [number, number]; draws: number; avgTurns: number; elapsed: number } | null
  error: string | null
}

function useSimWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<SimState>({
    running: false,
    progress: 0,
    total: 0,
    result: null,
    error: null,
  })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const run = useCallback((deckA: SimCard[], deckB: SimCard[], games: number) => {
    // Terminate previous worker if running
    workerRef.current?.terminate()

    setState({ running: true, progress: 0, total: games, result: null, error: null })

    const worker = new Worker(
      new URL('./sim-benchmark.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerOutgoing>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          setState((s) => ({ ...s, progress: msg.completed }))
          break
        case 'result':
          setState((s) => ({
            ...s,
            running: false,
            progress: msg.wins[0] + msg.wins[1] + msg.draws,
            result: { wins: msg.wins, draws: msg.draws, avgTurns: msg.avgTurns, elapsed: msg.elapsed },
          }))
          break
        case 'error':
          setState((s) => ({ ...s, running: false, error: msg.message }))
          break
      }
    }

    worker.onerror = (e) => {
      setState((s) => ({ ...s, running: false, error: e.message }))
    }

    worker.postMessage({
      type: 'start',
      deckA,
      deckB,
      games,
      seed: Date.now(),
    })
  }, [])

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setState((s) => ({ ...s, running: false }))
  }, [])

  return { ...state, run, cancel }
}

// ── Component ──────────────────────────────────────────────────────────

export function SimBenchmark() {
  const [games, setGames] = useState(5000)
  const sim = useSimWorker()

  const handleRun = () => {
    const deckA = buildTestDeck('aggro')
    const deckB = buildTestDeck('midrange')
    sim.run(deckA, deckB, games)
  }

  const pct = sim.total > 0 ? ((sim.progress / sim.total) * 100).toFixed(1) : '0'

  return (
    <div style={{ fontFamily: 'JetBrains Mono, monospace', padding: 32, color: '#f0ece2' }}>
      <h2 style={{ fontFamily: 'Cinzel, serif', marginBottom: 16 }}>
        SIMULATION BENCHMARK
      </h2>

      <div style={{ marginBottom: 16 }}>
        <label>
          Games:{' '}
          <input
            type="number"
            value={games}
            onChange={(e) => setGames(Number(e.target.value))}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(240, 236, 226, 0.4)',
              color: '#f0ece2',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 14,
              width: 80,
            }}
          />
        </label>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <button
          onClick={handleRun}
          disabled={sim.running}
          style={{
            background: sim.running ? 'transparent' : '#8b2500',
            color: '#f0ece2',
            border: '1px solid #8b2500',
            padding: '8px 16px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: sim.running ? 'not-allowed' : 'pointer',
          }}
        >
          {sim.running ? 'RUNNING...' : 'RUN BENCHMARK'}
        </button>

        {sim.running && (
          <button
            onClick={sim.cancel}
            style={{
              background: 'transparent',
              color: '#8b2500',
              border: '1px solid #8b2500',
              padding: '8px 16px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
        )}
      </div>

      {/* Progress bar */}
      {sim.running && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, marginBottom: 4, color: 'rgba(240, 236, 226, 0.6)' }}>
            {pct}% — {sim.progress} / {sim.total}
          </div>
          <div style={{ height: 1, background: 'rgba(240, 236, 226, 0.2)', width: '100%' }}>
            <div
              style={{
                height: 1,
                background: '#f0ece2',
                width: `${pct}%`,
                transition: 'width 100ms',
              }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {sim.result && (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div style={{ borderBottom: '1px solid rgba(240, 236, 226, 0.4)', paddingBottom: 8, marginBottom: 8 }}>
            RESULTS — {sim.total} games in {sim.result.elapsed.toFixed(0)}ms
            ({(sim.total / (sim.result.elapsed / 1000)).toFixed(0)} games/sec)
          </div>
          <div>DECK A (aggro): {sim.result.wins[0]} wins ({((sim.result.wins[0] / sim.total) * 100).toFixed(1)}%)</div>
          <div>DECK B (midrange): {sim.result.wins[1]} wins ({((sim.result.wins[1] / sim.total) * 100).toFixed(1)}%)</div>
          <div>DRAWS: {sim.result.draws} ({((sim.result.draws / sim.total) * 100).toFixed(1)}%)</div>
          <div>AVG TURNS: {sim.result.avgTurns.toFixed(1)}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(240, 236, 226, 0.5)' }}>
            {sim.result.elapsed < 10000
              ? '✓ PASS — under 10s target'
              : '✗ FAIL — exceeds 10s target, need optimization'}
          </div>
        </div>
      )}

      {/* Error */}
      {sim.error && (
        <div style={{ color: '#8b2500', fontSize: 13 }}>
          ERROR: {sim.error}
        </div>
      )}

      {/* Test info */}
      <div style={{ marginTop: 32, fontSize: 11, color: 'rgba(240, 236, 226, 0.4)', lineHeight: 1.6 }}>
        Deck A: 24 Mountains, 16× 2/1 haste (1cmc), 12× 3/1 first-strike (2cmc), 8× 3/3 (3cmc)<br />
        Deck B: 24 Mountains, 8× 2/3 (2cmc), 12× 3/3 flying (3cmc), 8× 4/4 lifelink (4cmc), 8× 5/5 trample (5cmc)
      </div>
    </div>
  )
}
