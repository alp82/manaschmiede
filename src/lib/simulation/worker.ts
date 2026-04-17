import type { WorkerIncoming, WorkerOutgoing } from './types'
import { deserializeSimCard } from './types'
import { runSimulation } from './runner'

self.onmessage = (e: MessageEvent<WorkerIncoming>) => {
  const msg = e.data
  if (msg.type === 'start') {
    try {
      const deckA = msg.deckA.map(deserializeSimCard)
      const deckB = msg.deckB.map(deserializeSimCard)
      const result = runSimulation(deckA, deckB, msg.games, msg.seed, (completed) => {
        self.postMessage({
          type: 'progress',
          completed,
          total: msg.games,
        } satisfies WorkerOutgoing)
      })
      self.postMessage({
        type: 'result',
        result,
      } satisfies WorkerOutgoing)
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutgoing)
    }
  }
}
