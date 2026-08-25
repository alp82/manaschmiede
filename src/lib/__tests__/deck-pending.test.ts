/**
 * The pure rules of the per-deck pending slot: the fingerprint, the staleness
 * predicate, and the four state builders.
 *
 * Reading and writing the slot moved to `storage/deck-store.ts` (issue #29),
 * so the I/O cases that used to live here — round-trip, per-deck keying,
 * clearing, corrupt and missing slots, key isolation — are in
 * `deck-store.test.ts` now.
 *
 * CRITICAL NOTE FOR THE IMPLEMENTER:
 *   `intentFingerprint` MUST encode the SAME structural-field set as
 *   `structuralFieldsChanged` in `src/lib/use-staged-rederive.ts`
 *   (committed colors + archetypes) — they must not drift, or a re-derive
 *   could fire without invalidating the slot (or vice-versa).
 *   Ideally share a `structuralKey(intent)` helper between them.
 *
 * Manual smoke tests (NOT in this file — final review only):
 *   - useDeckPending hook
 *   - $id.tsx reload-resume integration
 *   - Apply-clears-slot flow
 */

import { describe, it, expect } from 'vitest'
import {
  intentFingerprint,
  isPendingStale,
  hydratePending,
  evictStalePending,
  buildPendingUpdate,
  clearCardLevelPending,
} from '../deck-pending'
import type { DeckIntent } from '../deck-intent'
import type { DeckSection } from '../section-plan'
import type { CoreCombo } from '../wizard-state'
import type { ChatMessage } from '../wizard-state'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<DeckIntent> = {}): DeckIntent {
  return {
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'unselected' },
    archetypes: ['aggro'],
    traits: [],
    customStrategy: '',
    budgetMin: null,
    budgetMax: null,
    rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
    ...overrides,
  }
}

function makeSection(id: string, targetCount: number): DeckSection {
  return {
    id,
    label: id,
    description: '',
    targetCount,
    role: 'creatures',
    scryfallHints: [],
  }
}

function makePending(intentOverride?: Partial<DeckIntent>) {
  const baseIntent = makeIntent(intentOverride)
  const offeredCombos: CoreCombo[] = [
    {
      name: 'Goblin Rush',
      cards: [{ name: 'Goblin Guide', scryfallId: 'abc' }],
      explanation: 'Fast aggro',
    },
  ]
  const refillChat: ChatMessage[] = [
    { role: 'user', content: 'suggest cards' },
    { role: 'assistant', content: 'here are 3' },
  ]
  return {
    intentFingerprint: intentFingerprint(baseIntent),
    stagedPlan: [makeSection('aggressive-creatures', 16), makeSection('burn-tricks', 6)],
    offeredCombos,
    refillChat,
  }
}

// ─── intentFingerprint — structural stability ─────────────────────────────────

describe('intentFingerprint - structural stability (committed colors + archetypes ONLY)', () => {
  it('TC-5a: two equal intents → same fingerprint', () => {
    expect(intentFingerprint(makeIntent())).toBe(intentFingerprint(makeIntent()))
  })

  it('TC-5b: customStrategy-only change → SAME fingerprint', () => {
    const base = makeIntent()
    const changed = makeIntent({ customStrategy: 'totally different strategy' })
    expect(intentFingerprint(base)).toBe(intentFingerprint(changed))
  })

  it('TC-5c: budgetMax-only change → SAME fingerprint', () => {
    const base = makeIntent()
    const changed = makeIntent({ budgetMax: 99.99 })
    expect(intentFingerprint(base)).toBe(intentFingerprint(changed))
  })

  it('TC-5d: rarityFilter-only change → SAME fingerprint', () => {
    const base = makeIntent()
    const changed = makeIntent({ rarityFilter: ['common'] })
    expect(intentFingerprint(base)).toBe(intentFingerprint(changed))
  })

  it('TC-5e: traits-only change → SAME fingerprint (traits are SOFT)', () => {
    const base = makeIntent()
    const changed = makeIntent({ traits: ['tribal', 'synergy'] })
    expect(intentFingerprint(base)).toBe(intentFingerprint(changed))
  })

  it('TC-5f: committed-color change (R only → R+G) → DIFFERENT fingerprint', () => {
    const base = makeIntent()
    const changed = makeIntent({
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'selected' },
    })
    expect(intentFingerprint(base)).not.toBe(intentFingerprint(changed))
  })

  it('TC-5g: all colors unselected (color removed) → DIFFERENT fingerprint', () => {
    const base = makeIntent()
    const changed = makeIntent({
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    })
    expect(intentFingerprint(base)).not.toBe(intentFingerprint(changed))
  })

  it("TC-5h: archetype change (['aggro'] → ['midrange']) → DIFFERENT fingerprint", () => {
    const base = makeIntent()
    const changed = makeIntent({ archetypes: ['midrange'] })
    expect(intentFingerprint(base)).not.toBe(intentFingerprint(changed))
  })

  it("TC-5i: archetype addition (['aggro'] → ['aggro','burn']) → DIFFERENT fingerprint", () => {
    const base = makeIntent()
    const changed = makeIntent({ archetypes: ['aggro', 'burn'] })
    expect(intentFingerprint(base)).not.toBe(intentFingerprint(changed))
  })

  it("TC-5j: archetype removal (['aggro'] → []) → DIFFERENT fingerprint", () => {
    const base = makeIntent()
    const changed = makeIntent({ archetypes: [] })
    expect(intentFingerprint(base)).not.toBe(intentFingerprint(changed))
  })

  it('TC-5k: fingerprint is a non-empty string', () => {
    const fp = intentFingerprint(makeIntent())
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })

  it('TC-5l: WUBRG order-stable — colors set in any order produce the same fingerprint (derive via committedColors)', () => {
    // Both intents have R and G selected — same committed colors, just verifying
    // that the fingerprint encodes them in stable WUBRG order regardless of
    // how the Record<ManaColor, ...> was assembled.
    const rgIntent: DeckIntent = {
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'selected' },
      archetypes: ['aggro'],
      traits: [],
      customStrategy: '',
      budgetMin: null,
      budgetMax: null,
      rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
    }
    // Construct an identical committed set but with the object keys in a
    // different insertion order (G before R). Because JS objects don't
    // guarantee insertion order for string keys in iteration, the fingerprint
    // must use committedColors (WUBRG filter) — not Object.entries order.
    const rgIntentAlt: DeckIntent = {
      colors: { G: 'selected', R: 'selected', W: 'unselected', U: 'unselected', B: 'unselected' },
      archetypes: ['aggro'],
      traits: [],
      customStrategy: '',
      budgetMin: null,
      budgetMax: null,
      rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
    }
    expect(intentFingerprint(rgIntent)).toBe(intentFingerprint(rgIntentAlt))
  })
})

// ─── isPendingStale(pending, currentIntent) ───────────────────────────────────

describe('isPendingStale(pending, currentIntent)', () => {
  it('TC-6a: pending fingerprint from baseIntent, currentIntent = baseIntent → false (not stale)', () => {
    const baseIntent = makeIntent()
    const pending = { intentFingerprint: intentFingerprint(baseIntent) }
    expect(isPendingStale(pending, baseIntent)).toBe(false)
  })

  it('TC-6b: structural color change in currentIntent → true (stale)', () => {
    const baseIntent = makeIntent()
    const pending = { intentFingerprint: intentFingerprint(baseIntent) }
    const changedIntent = makeIntent({
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'selected' },
    })
    expect(isPendingStale(pending, changedIntent)).toBe(true)
  })

  it('TC-6c: archetype change → true (stale)', () => {
    const baseIntent = makeIntent()
    const pending = { intentFingerprint: intentFingerprint(baseIntent) }
    const changedIntent = makeIntent({ archetypes: ['midrange'] })
    expect(isPendingStale(pending, changedIntent)).toBe(true)
  })

  it('TC-6d: soft-only change (budgetMax) → false (not stale)', () => {
    const baseIntent = makeIntent()
    const pending = { intentFingerprint: intentFingerprint(baseIntent) }
    const changedIntent = makeIntent({ budgetMax: 50.0 })
    expect(isPendingStale(pending, changedIntent)).toBe(false)
  })
})

// ─── hydratePending (G1: eviction + rehydration initialiser) ─────────────────

describe('hydratePending(loaded, currentIntent)', () => {
  const baseIntent = makeIntent()
  const currentFp = intentFingerprint(baseIntent)

  const stagedPlan = [makeSection('aggressive-creatures', 16), makeSection('burn-tricks', 6)]
  const offeredCombos = [
    {
      name: 'Goblin Rush',
      cards: [{ name: 'Goblin Guide', scryfallId: 'abc' }],
      explanation: 'Fast aggro',
    },
  ]

  it('G1-a: loaded === null → returns { intentFingerprint: current }, no other fields', () => {
    const result = hydratePending(null, baseIntent)
    expect(result).toEqual({ intentFingerprint: currentFp })
    expect(result).not.toHaveProperty('stagedPlan')
    expect(result).not.toHaveProperty('offeredCombos')
  })

  it('G1-b: stale slot (fingerprint mismatch) → drops stagedPlan + offeredCombos, returns only { intentFingerprint: current }', () => {
    const staleIntent = makeIntent({ archetypes: ['control'] })
    const staleLoaded = {
      intentFingerprint: intentFingerprint(staleIntent),
      stagedPlan,
      offeredCombos,
    }
    // currentIntent is baseIntent (aggro), staleLoaded was derived against control → stale
    const result = hydratePending(staleLoaded, baseIntent)
    expect(result).toEqual({ intentFingerprint: currentFp })
    expect(result).not.toHaveProperty('stagedPlan')
    expect(result).not.toHaveProperty('offeredCombos')
  })

  it('G1-b2: stale slot via color change → drops stagedPlan + offeredCombos', () => {
    const otherColors = makeIntent({
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'selected' },
    })
    const staleLoaded = {
      intentFingerprint: intentFingerprint(otherColors),
      stagedPlan,
      offeredCombos,
    }
    const result = hydratePending(staleLoaded, baseIntent)
    expect(result.intentFingerprint).toBe(currentFp)
    expect(result).not.toHaveProperty('stagedPlan')
    expect(result).not.toHaveProperty('offeredCombos')
  })

  it('G1-c: fresh slot (fingerprint matches) → returns loaded data with current fingerprint, all fields preserved', () => {
    const freshLoaded = {
      intentFingerprint: currentFp,
      stagedPlan,
      offeredCombos,
    }
    const result = hydratePending(freshLoaded, baseIntent)
    expect(result.intentFingerprint).toBe(currentFp)
    expect(result.stagedPlan).toEqual(stagedPlan)
    expect(result.offeredCombos).toEqual(offeredCombos)
  })

  it('G1-c2: fresh slot with refillChat → refillChat preserved', () => {
    const refillChat = [{ role: 'user' as const, content: 'suggest cards' }]
    const freshLoaded = {
      intentFingerprint: currentFp,
      stagedPlan,
      refillChat,
    }
    const result = hydratePending(freshLoaded, baseIntent)
    expect(result.refillChat).toEqual(refillChat)
  })
})

// ─── evictStalePending (G2: eviction on every render, not just on mount) ─────
//
// The mount-only eviction let a stale slot be laundered: an intent change made
// the slot stale, then any setter re-stamped the CURRENT fingerprint while
// preserving the other keys, so the next reload saw a fresh-looking slot
// holding a plan derived against an intent the user had since changed.
// `evictStalePending` is the render-phase core that closes that window.

describe('evictStalePending(pending, fingerprint)', () => {
  const baseIntent = makeIntent()
  const currentFp = intentFingerprint(baseIntent)
  const staleFp = intentFingerprint(makeIntent({ archetypes: ['control'] }))

  it('G2-a: fingerprint matches → returns the SAME reference (caller uses !== to decide whether to write)', () => {
    const slot = { ...makePending(), intentFingerprint: currentFp }
    expect(evictStalePending(slot, currentFp)).toBe(slot)
  })

  it('G2-b: fingerprint matches → every field survives', () => {
    const slot = { ...makePending(), intentFingerprint: currentFp }
    const result = evictStalePending(slot, currentFp)
    expect(result.stagedPlan).toEqual(slot.stagedPlan)
    expect(result.offeredCombos).toEqual(slot.offeredCombos)
    expect(result.refillChat).toEqual(slot.refillChat)
  })

  it('G2-c: fingerprint moved → collapses to the empty slot under the NEW fingerprint', () => {
    const slot = { ...makePending(), intentFingerprint: staleFp }
    const result = evictStalePending(slot, currentFp)
    expect(result).toEqual({ intentFingerprint: currentFp })
    expect(result).not.toHaveProperty('stagedPlan')
    expect(result).not.toHaveProperty('offeredCombos')
    expect(result).not.toHaveProperty('refillChat')
  })

  it('G2-d: already-empty slot under a moved fingerprint → empty slot, no throw', () => {
    expect(evictStalePending({ intentFingerprint: staleFp }, currentFp)).toEqual({
      intentFingerprint: currentFp,
    })
  })

  it('G2-e: does not mutate the input slot', () => {
    const slot = { ...makePending(), intentFingerprint: staleFp }
    const before = JSON.parse(JSON.stringify(slot))
    evictStalePending(slot, currentFp)
    expect(slot).toEqual(before)
  })

  it('G2-f: laundering path — a setter fired after an intent change cannot resurrect the staged layer', () => {
    // Slot derived against the OLD intent, still holding the staged layer.
    const slot = { ...makePending(), intentFingerprint: staleFp }
    // The user commits a structural intent change, then types in the chat.
    // The hook evicts first, so the setter writes onto the EMPTY slot.
    const evicted = evictStalePending(slot, currentFp)
    const afterSetter = buildPendingUpdate(
      'refillChat',
      [{ role: 'user' as const, content: 'more burn' }],
      evicted,
      currentFp,
    )
    expect(afterSetter.intentFingerprint).toBe(currentFp)
    expect(afterSetter.refillChat).toHaveLength(1)
    expect(afterSetter).not.toHaveProperty('stagedPlan')
    expect(afterSetter).not.toHaveProperty('offeredCombos')
    // And the slot is no longer stale, so a reload resumes nothing stale.
    expect(isPendingStale(afterSetter, baseIntent)).toBe(false)
  })

  it('G2-g: without the eviction the same setter DOES launder the slot (the bug this closes)', () => {
    const slot = { ...makePending(), intentFingerprint: staleFp }
    const laundered = buildPendingUpdate(
      'refillChat',
      [{ role: 'user' as const, content: 'more burn' }],
      slot,
      currentFp,
    )
    expect(laundered).toHaveProperty('stagedPlan')
    expect(isPendingStale(laundered, baseIntent)).toBe(false)
  })
})

// ─── buildPendingUpdate (R2: setter pure core) ───────────────────────────────

describe('buildPendingUpdate', () => {
  const fp = 'test-fingerprint'
  const prevFull = {
    intentFingerprint: 'old-fp',
    stagedPlan: [makeSection('aggressive-creatures', 16)],
    offeredCombos: [{ name: 'Combo', cards: [], explanation: 'e' }],
  }

  it('R2-a: value truthy → sets the key and updates fingerprint', () => {
    const newPlan = [makeSection('burn-tricks', 6)]
    const result = buildPendingUpdate('stagedPlan', newPlan, prevFull, fp)
    expect(result.stagedPlan).toEqual(newPlan)
    expect(result.intentFingerprint).toBe(fp)
    // other fields untouched
    expect(result.offeredCombos).toEqual(prevFull.offeredCombos)
  })

  it('R2-b: value undefined → drops the key and updates fingerprint', () => {
    const result = buildPendingUpdate('stagedPlan', undefined, prevFull, fp)
    expect(result).not.toHaveProperty('stagedPlan')
    expect(result.intentFingerprint).toBe(fp)
    // other fields still present
    expect(result.offeredCombos).toEqual(prevFull.offeredCombos)
  })

  it('R2-c: value falsy (undefined) for offeredCombos → drops offeredCombos', () => {
    const result = buildPendingUpdate('offeredCombos', undefined, prevFull, fp)
    expect(result).not.toHaveProperty('offeredCombos')
    expect(result.intentFingerprint).toBe(fp)
  })

  it('R2-d: fingerprint is ALWAYS updated regardless of drop/set', () => {
    const setResult = buildPendingUpdate('stagedPlan', [makeSection('a', 1)], prevFull, fp)
    const dropResult = buildPendingUpdate('stagedPlan', undefined, prevFull, fp)
    expect(setResult.intentFingerprint).toBe(fp)
    expect(dropResult.intentFingerprint).toBe(fp)
  })
})

// ─── clearCardLevelPending — the "cleared on Apply" contract ─────────────────

/**
 * A card-level Apply (chat / re-fill / combo proposal) evicts the CARD-LEVEL
 * review state from the slot: the offered combos and the re-fill chat. It must
 * NOT touch `stagedPlan` — decision 4 makes the re-derived plan its own staging
 * layer with its own Accept/Discard, so only acceptPlan/discardPlan may clear it.
 *
 * Regression: the original `clearStaged` did the inverse — it dropped
 * `stagedPlan` (so a mid-review reload silently lost a plan whose banner was
 * still on screen) and kept `refillChat`.
 */
describe('clearCardLevelPending (card-level Apply eviction)', () => {
  const intent = makeIntent()
  const fp = intentFingerprint(intent)

  it('TC-7a: drops offeredCombos', () => {
    expect(clearCardLevelPending(makePending(), fp).offeredCombos).toBeUndefined()
  })

  it('TC-7b: drops refillChat', () => {
    expect(clearCardLevelPending(makePending(), fp).refillChat).toBeUndefined()
  })

  it('TC-7c: KEEPS stagedPlan — the staged plan is its own layer (decision 4)', () => {
    const prev = makePending()
    expect(clearCardLevelPending(prev, fp).stagedPlan).toEqual(prev.stagedPlan)
  })

  it('TC-7d: stamps the CURRENT fingerprint', () => {
    expect(clearCardLevelPending(makePending(), 'FP-CURRENT').intentFingerprint).toBe('FP-CURRENT')
  })

  it('TC-7e: already-empty slot → no throw, fingerprint stamped, no keys added', () => {
    expect(clearCardLevelPending({ intentFingerprint: 'old' }, fp)).toEqual({ intentFingerprint: fp })
  })

  it('TC-7f: does not mutate the input slot', () => {
    const prev = makePending()
    clearCardLevelPending(prev, fp)
    expect(prev.offeredCombos).toBeDefined()
    expect(prev.refillChat).toBeDefined()
  })
})
