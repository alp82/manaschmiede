/**
 * RED tests — loadDeckPending, persistDeckPending, clearDeckPending,
 * intentFingerprint, and isPendingStale do NOT exist yet.
 * All must be exported from src/lib/deck-pending.ts (M4 implementer).
 *
 * CRITICAL NOTE FOR THE IMPLEMENTER:
 *   `intentFingerprint` MUST encode the SAME structural-field set as
 *   `structuralFieldsChanged` in `src/lib/use-staged-rederive.ts`
 *   (committed colors + archetypes) — they must not drift, or a re-derive
 *   could fire without invalidating the slot (or vice-versa).
 *   Ideally share a `structuralKey(intent)` helper between them.
 *
 * Storage key prefix: 'manaschmiede-deck-pending:<deckId>'
 * (must not collide with 'manaschmiede-decks' or 'manaschmiede-wizard')
 *
 * Manual smoke tests (NOT in this file — final review only):
 *   - useDeckPending hook
 *   - $id.tsx reload-resume integration
 *   - deleteDeck slot-clear extension
 *   - Apply-clears-slot flow
 *
 * This file covers deck-pending.ts's pure functions only.
 */

import { beforeEach, describe, it, expect } from 'vitest'
import {
  loadDeckPending,
  persistDeckPending,
  clearDeckPending,
  intentFingerprint,
  isPendingStale,
  hydratePending,
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

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
})

// ─── persistDeckPending / loadDeckPending — round-trip ───────────────────────

describe('persistDeckPending / loadDeckPending - round-trip', () => {
  it('TC-1a: persist makePending() under deck-A, load returns deep-equal (all nested fields)', () => {
    const pending = makePending()
    persistDeckPending('deck-A', pending)
    const loaded = loadDeckPending('deck-A')
    expect(loaded).toEqual(pending)
  })

  it('TC-1b: persist minimal object (intentFingerprint only, no optional fields) → load returns same shape (optional fields absent, not null-coerced)', () => {
    const minimal = { intentFingerprint: 'fp-xyz' }
    persistDeckPending('deck-B', minimal)
    const loaded = loadDeckPending('deck-B')
    expect(loaded).toEqual({ intentFingerprint: 'fp-xyz' })
    // Optional fields must be absent, not present as null/undefined
    expect(loaded).not.toHaveProperty('stagedPlan')
    expect(loaded).not.toHaveProperty('offeredCombos')
    expect(loaded).not.toHaveProperty('refillChat')
  })

  it('TC-1c: persist v1 then v2 (different fingerprint) under deck-A → load returns v2', () => {
    const v1 = { intentFingerprint: 'fp-v1' }
    const v2 = { intentFingerprint: 'fp-v2' }
    persistDeckPending('deck-A', v1)
    persistDeckPending('deck-A', v2)
    const loaded = loadDeckPending('deck-A')
    expect(loaded).toEqual(v2)
  })
})

// ─── namespacing ──────────────────────────────────────────────────────────────

describe('namespacing', () => {
  it('TC-2a: persist different data under deck-A and deck-B → each loads its own (no cross-contamination)', () => {
    const pendingA = makePending()
    const pendingB = { intentFingerprint: 'fp-b-only', stagedPlan: [makeSection('burn-spells', 10)] }
    persistDeckPending('deck-A', pendingA)
    persistDeckPending('deck-B', pendingB)
    expect(loadDeckPending('deck-A')).toEqual(pendingA)
    expect(loadDeckPending('deck-B')).toEqual(pendingB)
  })

  it('TC-2b: persist under deck-A → localStorage key is manaschmiede-deck-pending:deck-A, parseable JSON, deep-equal to input', () => {
    const pending = makePending()
    persistDeckPending('deck-A', pending)
    const raw = localStorage.getItem('manaschmiede-deck-pending:deck-A')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed).toEqual(pending)
  })

  it('TC-2c: persist under deck-A → manaschmiede-decks sentinel is UNCHANGED', () => {
    localStorage.setItem('manaschmiede-decks', '["sentinel"]')
    persistDeckPending('deck-A', makePending())
    expect(localStorage.getItem('manaschmiede-decks')).toBe('["sentinel"]')
  })

  it('TC-2d: persist under deck-A → manaschmiede-wizard sentinel is UNCHANGED', () => {
    localStorage.setItem('manaschmiede-wizard', '{"step":1}')
    persistDeckPending('deck-A', makePending())
    expect(localStorage.getItem('manaschmiede-wizard')).toBe('{"step":1}')
  })
})

// ─── clearDeckPending ────────────────────────────────────────────────────────

describe('clearDeckPending', () => {
  it('TC-3a: persist A and B, clear A → load A is null, load B intact', () => {
    const pendingA = makePending()
    const pendingB = { intentFingerprint: 'fp-b' }
    persistDeckPending('deck-A', pendingA)
    persistDeckPending('deck-B', pendingB)
    clearDeckPending('deck-A')
    expect(loadDeckPending('deck-A')).toBeNull()
    expect(loadDeckPending('deck-B')).toEqual(pendingB)
  })

  it('TC-3b: clear a never-persisted id → no throw, load returns null', () => {
    expect(() => clearDeckPending('never-existed')).not.toThrow()
    expect(loadDeckPending('never-existed')).toBeNull()
  })

  it('TC-3c: persist A, clear A → localStorage.getItem(manaschmiede-deck-pending:deck-A) is null', () => {
    persistDeckPending('deck-A', makePending())
    clearDeckPending('deck-A')
    expect(localStorage.getItem('manaschmiede-deck-pending:deck-A')).toBeNull()
  })
})

// ─── loadDeckPending — missing/corrupt ────────────────────────────────────────

describe('loadDeckPending - missing/corrupt', () => {
  it('TC-4a: load never-persisted id → null (not undefined, not {})', () => {
    const result = loadDeckPending('no-such-deck')
    expect(result).toBeNull()
  })

  it('TC-4b: slot contains invalid JSON → returns null, does NOT throw (mirrors deck-storage.ts parse guard)', () => {
    localStorage.setItem('manaschmiede-deck-pending:corrupt-deck', 'not valid json {{{')
    expect(() => {
      const result = loadDeckPending('corrupt-deck')
      expect(result).toBeNull()
    }).not.toThrow()
  })

  it("TC-4c: slot contains 'null' → load returns null", () => {
    localStorage.setItem('manaschmiede-deck-pending:null-deck', 'null')
    expect(loadDeckPending('null-deck')).toBeNull()
  })
})

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
