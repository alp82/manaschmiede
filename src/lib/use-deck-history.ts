import { useCallback, useMemo, useRef } from 'react'
import type { DeckCard } from './deck-utils'
import { loadWizardAux, persistWizardAux } from './wizard-state'

const MAX_HISTORY = 30

export interface DeckHistoryState {
  past: DeckCard[][]
  future: DeckCard[][]
  /** JSON key of the most recently snapshotted cards. */
  lastSnapshot: string
}

export interface DeckHistoryOpts {
  /** When false, aux storage is never touched. */
  persist?: boolean
  maxHistory?: number
}

export interface DeckHistoryAux {
  load: () => { deckHistoryPast: DeckCard[][]; deckHistoryFuture: DeckCard[][] }
  persist: (data: { deckHistoryPast: DeckCard[][]; deckHistoryFuture: DeckCard[][] }) => void
}

export interface DeckHistoryCore {
  state: DeckHistoryState
  snapshot(currentCards: DeckCard[]): DeckHistoryState
  undo(currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null }
  redo(currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null }
}

/**
 * Pure undo/redo core for the deck history. Owns the mutable past/future
 * stacks and the snapshot/undo/redo math with zero React and zero direct
 * storage access — persistence is delegated to the injected `aux`, and only
 * when `persist` is on. `useDeckHistory` wraps this; the unit tests drive it
 * directly.
 */
export function createDeckHistoryCore(
  opts?: DeckHistoryOpts,
  aux?: DeckHistoryAux,
): DeckHistoryCore {
  const persist = opts?.persist ?? false
  const maxHistory = opts?.maxHistory ?? MAX_HISTORY

  const state: DeckHistoryState = { past: [], future: [], lastSnapshot: '' }

  // Restore stacks once on construction — only when persisting.
  if (persist && aux) {
    const loaded = aux.load()
    if (loaded.deckHistoryPast.length > 0) state.past = loaded.deckHistoryPast
    if (loaded.deckHistoryFuture.length > 0) state.future = loaded.deckHistoryFuture
  }

  const persistStacks = () => {
    if (!persist || !aux) return
    aux.persist({ deckHistoryPast: state.past, deckHistoryFuture: state.future })
  }

  const snapshot = (currentCards: DeckCard[]): DeckHistoryState => {
    const key = JSON.stringify(currentCards)
    const topKey = state.past.length > 0 ? JSON.stringify(state.past[state.past.length - 1]) : ''
    if (key === topKey || key === state.lastSnapshot) return state
    state.past.push([...currentCards])
    if (state.past.length > maxHistory) state.past.shift()
    state.future = []
    state.lastSnapshot = key
    persistStacks()
    return state
  }

  const undo = (currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null } => {
    if (state.past.length === 0) return { state, cards: null }
    state.future.push([...currentCards])
    const prev = state.past.pop()!
    state.lastSnapshot = JSON.stringify(prev)
    persistStacks()
    return { state, cards: prev }
  }

  const redo = (currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null } => {
    if (state.future.length === 0) return { state, cards: null }
    state.past.push([...currentCards])
    const next = state.future.pop()!
    state.lastSnapshot = JSON.stringify(next)
    persistStacks()
    return { state, cards: next }
  }

  return { state, snapshot, undo, redo }
}

const wizardAux: DeckHistoryAux = {
  load: () => {
    const aux = loadWizardAux()
    return { deckHistoryPast: aux.deckHistoryPast, deckHistoryFuture: aux.deckHistoryFuture }
  },
  persist: persistWizardAux,
}

export function useDeckHistory(
  currentCards: DeckCard[],
  applyCards: (cards: DeckCard[]) => void,
  opts?: { persist?: boolean },
) {
  const persist = opts?.persist ?? false
  const coreRef = useRef<DeckHistoryCore | null>(null)
  if (!coreRef.current) {
    coreRef.current = createDeckHistoryCore(
      { persist },
      persist ? wizardAux : undefined,
    )
  }
  const core = coreRef.current

  const snapshot = useCallback(() => {
    core.snapshot(currentCards)
  }, [core, currentCards])

  const undo = useCallback(() => {
    const { cards } = core.undo(currentCards)
    if (cards) applyCards(cards)
  }, [core, currentCards, applyCards])

  const redo = useCallback(() => {
    const { cards } = core.redo(currentCards)
    if (cards) applyCards(cards)
  }, [core, currentCards, applyCards])

  // Stable identity between renders that changed nothing, so consumers can
  // memoize on it — `deckSurfaceFromWizard` / `deckSurfaceFromSavedDeck` both
  // take the history object and would otherwise be rebuilt every render. The
  // stack lengths are read off the mutable core, so they belong in the deps:
  // every push or pop happens alongside a state change that re-renders.
  const pastLength = core.state.past.length
  const futureLength = core.state.future.length
  return useMemo(
    () => ({
      snapshot,
      undo,
      redo,
      canUndo: pastLength > 0,
      canRedo: futureLength > 0,
    }),
    [snapshot, undo, redo, pastLength, futureLength],
  )
}
