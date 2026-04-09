import { useCallback, useEffect, useRef } from 'react'
import type { DeckCard } from './deck-utils'
import type { WizardAction } from './wizard-state'
import { loadWizardAux, persistWizardAux } from './wizard-state'

const MAX_HISTORY = 30

export function useDeckHistory(
  currentCards: DeckCard[],
  dispatch: React.Dispatch<WizardAction>,
) {
  const initialized = useRef(false)
  const past = useRef<DeckCard[][]>([])
  const future = useRef<DeckCard[][]>([])
  const lastSnapshot = useRef<string>('')

  // Restore from localStorage on first render
  if (!initialized.current) {
    initialized.current = true
    const aux = loadWizardAux()
    if (aux.deckHistoryPast.length > 0) past.current = aux.deckHistoryPast
    if (aux.deckHistoryFuture.length > 0) future.current = aux.deckHistoryFuture
  }

  const persistStacks = useCallback(() => {
    persistWizardAux({ deckHistoryPast: past.current, deckHistoryFuture: future.current })
  }, [])

  // Take a snapshot before a change - skip if identical to the last saved state
  const snapshot = useCallback(() => {
    const key = JSON.stringify(currentCards)
    // Compare against the top of the undo stack to avoid duplicates
    const topKey = past.current.length > 0 ? JSON.stringify(past.current[past.current.length - 1]) : ''
    if (key === topKey || key === lastSnapshot.current) return
    past.current.push(currentCards)
    if (past.current.length > MAX_HISTORY) past.current.shift()
    future.current = []
    lastSnapshot.current = key
    persistStacks()
  }, [currentCards, persistStacks])

  const undo = useCallback(() => {
    if (past.current.length === 0) return
    future.current.push(currentCards)
    const prev = past.current.pop()!
    lastSnapshot.current = JSON.stringify(prev)
    dispatch({ type: 'SET_DECK', cards: prev })
    persistStacks()
  }, [currentCards, dispatch, persistStacks])

  const redo = useCallback(() => {
    if (future.current.length === 0) return
    past.current.push(currentCards)
    const next = future.current.pop()!
    lastSnapshot.current = JSON.stringify(next)
    dispatch({ type: 'SET_DECK', cards: next })
    persistStacks()
  }, [currentCards, dispatch, persistStacks])

  return {
    snapshot,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
