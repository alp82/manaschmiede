import { useCallback, useState } from 'react'
import {
  loadDeckPending,
  persistDeckPending,
  clearDeckPending,
  intentFingerprint,
  buildPendingUpdate,
  hydratePending,
  clearCardLevelPending,
  type DeckPending,
} from './deck-pending'
import { useSkipFirst } from './use-skip-first'
import type { DeckIntent } from './deck-intent'
import type { DeckSection } from './section-plan'
import type { CoreCombo, ChatMessage } from './wizard-state'

export interface UseDeckPendingResult {
  pending: DeckPending
  setStagedPlan: (plan: DeckSection[] | null) => void
  setOfferedCombos: (combos: CoreCombo[] | undefined) => void
  setRefillChat: (chat: ChatMessage[] | undefined) => void
  /**
   * The "cleared on Apply" contract for a card-level proposal: drop the offered
   * combos + the re-fill chat, KEEPING the staged plan (its own layer, cleared
   * only by acceptPlan/discardPlan).
   */
  clearCardLevelPending: () => void
}

/**
 * Persistence-backed pending slot for a deck's mid-review state (the M2 staged
 * re-derive plan + the M3 offered combos + the re-fill chat). On mount it
 * hydrates from `manaschmiede-deck-pending:<deckId>`; a slot derived against a
 * now-stale committed intent (structural color/archetype change) has its staged
 * layer DROPPED so we never resume a plan/combos that no longer match the
 * committed intent. Every mutation persists the slot, recording the CURRENT
 * committed-intent fingerprint so the slot always knows which intent it belongs
 * to.
 */
export function useDeckPending(
  deckId: string,
  committedIntent: DeckIntent,
): UseDeckPendingResult {
  const fingerprint = intentFingerprint(committedIntent)

  const [pending, setPending] = useState<DeckPending>(() =>
    hydratePending(loadDeckPending(deckId), committedIntent),
  )

  // Skip the persist effect on the very first commit — the initial state came
  // straight from storage (or is the empty slot), so re-writing it is noise.
  useSkipFirst(() => {
    persistDeckPending(deckId, pending)
  }, [deckId, pending])

  const setStagedPlan = useCallback(
    (plan: DeckSection[] | null) => {
      setPending((prev) => buildPendingUpdate('stagedPlan', plan ?? undefined, prev, fingerprint))
    },
    [fingerprint],
  )

  const setOfferedCombos = useCallback(
    (combos: CoreCombo[] | undefined) => {
      setPending((prev) => buildPendingUpdate('offeredCombos', combos, prev, fingerprint))
    },
    [fingerprint],
  )

  const setRefillChat = useCallback(
    (chat: ChatMessage[] | undefined) => {
      setPending((prev) => buildPendingUpdate('refillChat', chat, prev, fingerprint))
    },
    [fingerprint],
  )

  const clearCardLevel = useCallback(() => {
    setPending((prev) => clearCardLevelPending(prev, fingerprint))
  }, [fingerprint])

  return {
    pending,
    setStagedPlan,
    setOfferedCombos,
    setRefillChat,
    clearCardLevelPending: clearCardLevel,
  }
}

export { clearDeckPending }
