import { committedColors, type DeckIntent } from './deck-intent'
import type { DeckSection } from './section-plan'
import type { CoreCombo, ChatMessage } from './wizard-state'

const KEY_PREFIX = 'manaschmiede-deck-pending:'

/**
 * Per-deck pending slot: the transient mid-review state (M2 staged re-derive
 * plan + M3 offered combos + the re-fill chat) that survives a reload. Keyed
 * by deck id, separate from the curated 60 (`manaschmiede-decks`) — nothing
 * here touches the persisted deck until the user Applies.
 *
 * `intentFingerprint` records which committed intent the slot was derived
 * against, so a committed-intent change can evict a now-stale slot.
 */
export interface DeckPending {
  intentFingerprint: string
  stagedPlan?: DeckSection[]
  offeredCombos?: CoreCombo[]
  refillChat?: ChatMessage[]
}

/**
 * The structural slice of a DeckIntent that warrants a plan re-derive AND a
 * pending-slot eviction: committed colors (WUBRG-ordered via committedColors,
 * so order-stable regardless of how the color map was assembled) plus the
 * archetypes in array order. Soft fields (strategy / budget / rarity / traits)
 * are deliberately excluded — they don't change the structural plan.
 *
 * Shared by `intentFingerprint` (M4 slot eviction) and `structuralFieldsChanged`
 * (M2 re-derive trigger) so the two predicates can never drift.
 */
export function structuralKey(intent: DeckIntent): string {
  return JSON.stringify({
    colors: committedColors(intent),
    archetypes: intent.archetypes,
  })
}

/** Stable fingerprint over the structural fields only. */
export function intentFingerprint(intent: DeckIntent): string {
  return structuralKey(intent)
}

/**
 * Whether the slot was derived against a different structural intent — the
 * predicate form of `evictStalePending`, which does the same comparison and
 * acts on it. Change one and change the other.
 */
export function isPendingStale(pending: DeckPending, currentIntent: DeckIntent): boolean {
  return intentFingerprint(currentIntent) !== pending.intentFingerprint
}

export function loadDeckPending(id: string): DeckPending | null {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + id) || 'null')
  } catch {
    return null
  }
}

export function persistDeckPending(id: string, pending: DeckPending): void {
  localStorage.setItem(KEY_PREFIX + id, JSON.stringify(pending))
}

export function clearDeckPending(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id)
}

/**
 * Pure helper: build the next `DeckPending` state for a setter that either
 * drops a key (when `value` is falsy) or sets it (when `value` is truthy).
 * The `intentFingerprint` field is ALWAYS updated to `fingerprint`, so the
 * slot stays stamped with the current committed-intent fingerprint regardless
 * of whether the key is being set or dropped.
 *
 * Extracted from the three structurally-identical setters in `useDeckPending`
 * (`setStagedPlan`, `setOfferedCombos`, `setRefillChat`).
 */
export function buildPendingUpdate<K extends keyof Omit<DeckPending, 'intentFingerprint'>>(
  key: K,
  value: DeckPending[K] | undefined,
  prev: DeckPending,
  fingerprint: string,
): DeckPending {
  if (!value) {
    const { [key]: _drop, ...rest } = prev
    return { ...rest, intentFingerprint: fingerprint }
  }
  return { ...prev, [key]: value, intentFingerprint: fingerprint }
}

/**
 * Pure helper: the "cleared on Apply" contract for a CARD-LEVEL proposal
 * (chat / re-fill / combo). Applying one evicts the card-level review state —
 * the offered combos and the re-fill chat — and stamps the current fingerprint.
 *
 * `stagedPlan` is deliberately KEPT: decision 4 makes a re-derived plan its own
 * staging layer with its own Accept/Discard, so only acceptPlan/discardPlan may
 * clear it. Dropping it here would strand the on-screen banner against a slot
 * that no longer holds the plan — the banner survives, a reload loses it.
 */
export function clearCardLevelPending(prev: DeckPending, fingerprint: string): DeckPending {
  const { offeredCombos: _c, refillChat: _r, ...rest } = prev
  return { ...rest, intentFingerprint: fingerprint }
}

/**
 * Pure core of the decision-6 eviction, expressed over a FINGERPRINT rather
 * than an intent so it can run on every render instead of only on mount. The
 * predicate it acts on is the one `isPendingStale` reports.
 *
 * A slot whose `intentFingerprint` still matches is returned unchanged — the
 * SAME reference, so a caller can use `!==` to decide whether it has to write.
 * A slot derived against a different structural intent collapses to the empty
 * slot: the staged plan, the offered combos, and the re-fill chat were all
 * derived against an intent the user has since changed.
 *
 * Running this only on mount is what let a stale slot be laundered: the intent
 * changed, then any setter re-stamped the current fingerprint onto the old keys
 * (`buildPendingUpdate` always re-stamps), and the next reload resumed a plan
 * that no longer matched the committed intent.
 */
export function evictStalePending(pending: DeckPending, fingerprint: string): DeckPending {
  if (pending.intentFingerprint === fingerprint) return pending
  return { intentFingerprint: fingerprint }
}

/**
 * Pure initialiser for the pending-slot: the decision-6 eviction path.
 *
 * Given a loaded slot (or `null`) and the current committed intent:
 * - `null`   → return an empty slot `{ intentFingerprint: <current> }`
 * - stale    → drop the whole staged layer (`stagedPlan`, `offeredCombos`, and
 *              `refillChat`), return `{ intentFingerprint: <current> }`
 * - fresh    → return the loaded data as-is (its fingerprint already equals the
 *              current one, so there is nothing to update).
 *
 * Extracted so it can be tested in isolation (the initialiser function of
 * `useState` is otherwise invisible to unit tests).
 */
export function hydratePending(loaded: DeckPending | null, currentIntent: DeckIntent): DeckPending {
  const fingerprint = intentFingerprint(currentIntent)
  if (!loaded) return { intentFingerprint: fingerprint }
  return evictStalePending(loaded, fingerprint)
}
