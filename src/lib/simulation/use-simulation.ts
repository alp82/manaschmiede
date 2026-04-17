import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScryfallCard } from '../scryfall/types'
import type { DeckCard } from '../deck-utils'
import type { SimulationState, WorkerOutgoing } from './types'
import { serializeSimCard } from './types'
import { parseDeck } from './parser'

export function useSimulation() {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<SimulationState>({
    status: 'idle',
    progress: 0,
    result: null,
    error: null,
  })

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const run = useCallback(
    (
      myCards: DeckCard[],
      myCardData: Map<string, ScryfallCard>,
      opponentCards?: DeckCard[],
      opponentCardData?: Map<string, ScryfallCard>,
      games = 5000,
    ) => {
      if (typeof window === 'undefined') return

      workerRef.current?.terminate()

      const deckA = parseDeck(myCards, myCardData)
      if (deckA.length === 0) {
        setState({ status: 'error', progress: 0, result: null, error: 'No valid cards in deck' })
        return
      }

      let deckB = deckA
      if (opponentCards && opponentCardData) {
        deckB = parseDeck(opponentCards, opponentCardData)
        if (deckB.length === 0) {
          setState({ status: 'error', progress: 0, result: null, error: 'No valid cards in opponent deck' })
          return
        }
      }

      setState({ status: 'running', progress: 0, result: null, error: null })

      const worker = new Worker(
        new URL('./worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker

      worker.onmessage = (e: MessageEvent<WorkerOutgoing>) => {
        const msg = e.data
        switch (msg.type) {
          case 'progress':
            setState((s) => ({ ...s, progress: msg.total > 0 ? msg.completed / msg.total : 0 }))
            break
          case 'result':
            setState({ status: 'done', progress: 1, result: msg.result, error: null })
            break
          case 'error':
            setState({ status: 'error', progress: 0, result: null, error: msg.message })
            break
        }
      }

      worker.onerror = (e) => {
        setState({ status: 'error', progress: 0, result: null, error: e.message })
      }

      worker.postMessage({
        type: 'start',
        deckA: deckA.map(serializeSimCard),
        deckB: deckB.map(serializeSimCard),
        games,
        seed: Date.now(),
      })
    },
    [],
  )

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setState({ status: 'idle', progress: 0, result: null, error: null })
  }, [])

  return { state, run, cancel }
}
