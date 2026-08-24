/**
 * `wizardReducer` is a pure function of 23 cases and, until this file, had zero
 * tests. It needs no DOM and no mocks. Alongside it, `hydrateWizardState` — the
 * pure core extracted out of `initialWizardState` — is covered here too, since
 * the shallow `{ ...defaultState(), ...parsed }` merge it replaced could hand
 * the app a state object the reducer's own invariants never allow.
 *
 * Asserted contracts:
 *
 *   C1  step navigation      NEXT_STEP high-water mark, PREV_STEP never lowers
 *                            it, GO_TO_STEP is a silent no-op past maxStepReached
 *   C2  seed card            upgrade-only colour promotion, never demote
 *   C3  colours              SET_COLOR / CLEAR_COLORS
 *   C4  archetypes / traits  archetypes cap at 3 add-only, traits have no cap
 *   C5  combos               SET_CORE_COMBOS always nulls the selection;
 *                            SELECT_COMBO's downstream clear
 *   C6  deck metadata        SET_DECK / SET_DECK_METADATA use `??`, so an
 *                            explicit '' clears
 *   C7  locks                TOGGLE_LOCK accepts ids absent from deckCards
 *   C8  sections             ASSIGN_SECTION is per-section replace
 *   C9  purity               every action leaves its input state untouched
 *   C10 hydration            partial colours, the legacy budgetLimit key, an
 *                            out-of-range step, and maxStepReached < step
 *   C11 reset pairing        resetWizard couples RESET with clearWizardAux
 *
 * Deferred to #20: SELECT_COMBO's range guard (index -1, index 99, and the
 * `selectedComboIndex: null` skip path). Written red they would leave main with
 * a failing suite between the two merges, so they land with the fix.
 *
 * NOT unit-testable here (UI / integration):
 *   - the "rarityFilter is never empty" invariant, which lives in StepTraits
 *   - the step-transition animation and URL-step sync in new.tsx
 *   - whether a dispatched action is reachable from the UI at all
 *
 * Known gaps pinned as PASSING tests (current behaviour, not endorsements):
 *   - SET_RARITY_FILTER accepts []
 *   - TOGGLE_LOCK can leave an orphan lock for a removed card
 *   - SET_SECTION_PLAN leaves assignments for dropped section ids behind
 *   - RESET does not touch localStorage
 *   - CLEAR_SECTION_ASSIGNMENTS is never dispatched anywhere — a dead action
 *
 * `src/test-setup.ts`'s MemoryStorage is a module-level singleton with no
 * per-test reset, so the storage-touching blocks clear it in `beforeEach`.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  wizardReducer,
  hydrateWizardState,
  initialWizardState,
  persistWizardState,
  persistWizardAux,
  loadWizardAux,
  clearWizardState,
  resetWizard,
  type WizardState,
  type WizardAction,
  type CoreCombo,
} from '../wizard-state'
import type { ScryfallCard } from '../scryfall/types'
import type { DeckCard } from '../deck-utils'
import type { DeckSection } from '../section-plan'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    step: 1,
    maxStepReached: 1,
    seedCard: null,
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    format: 'casual',
    selectedArchetypes: [],
    selectedTraits: [],
    customStrategy: '',
    budgetMin: null,
    budgetMax: null,
    rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
    coreCombos: [],
    selectedComboIndex: null,
    deckCards: [],
    lockedCardIds: [],
    deckName: '',
    deckDescription: '',
    chatMessages: [],
    sectionPlan: [],
    sectionAssignments: {},
    ...overrides,
  }
}

function makeCombo(name: string): CoreCombo {
  return { name, cards: [{ name: `${name} piece`, scryfallId: `id-${name}` }], explanation: `${name} wins` }
}

function makeCard(scryfallId: string): DeckCard {
  return { scryfallId, quantity: 1, zone: 'main' }
}

function makeSection(id: string): DeckSection {
  return { id, label: id, description: '', targetCount: 4, role: 'creatures', scryfallHints: [] }
}

const seedCard = { id: 'seed-1', name: 'Lightning Bolt' } as unknown as ScryfallCard

/**
 * One instance of every action in the union — the purity table's input. Typed
 * as a Record over `WizardAction['type']` so a 24th action added to the union
 * fails the typecheck here instead of silently escaping the C9 purity pass.
 */
const ACTION_TABLE: Record<WizardAction['type'], WizardAction> = {
  SET_SEED_CARD: { type: 'SET_SEED_CARD', card: seedCard, costColors: ['R'] },
  CLEAR_SEED_CARD: { type: 'CLEAR_SEED_CARD' },
  SET_COLOR: { type: 'SET_COLOR', color: 'U', state: 'selected' },
  CLEAR_COLORS: { type: 'CLEAR_COLORS' },
  SET_FORMAT: { type: 'SET_FORMAT', format: 'standard' },
  TOGGLE_ARCHETYPE: { type: 'TOGGLE_ARCHETYPE', traitId: 'aggro' },
  TOGGLE_TRAIT: { type: 'TOGGLE_TRAIT', traitId: 'lifegain' },
  SET_CUSTOM_STRATEGY: { type: 'SET_CUSTOM_STRATEGY', text: 'go wide' },
  SET_BUDGET: { type: 'SET_BUDGET', min: 5, max: 50 },
  SET_RARITY_FILTER: { type: 'SET_RARITY_FILTER', rarities: ['rare'] },
  SET_CORE_COMBOS: { type: 'SET_CORE_COMBOS', combos: [makeCombo('a')] },
  SELECT_COMBO: { type: 'SELECT_COMBO', index: 0 },
  SET_DECK: { type: 'SET_DECK', cards: [makeCard('x')], name: 'n', description: 'd' },
  SET_DECK_METADATA: { type: 'SET_DECK_METADATA', name: 'n2', description: 'd2' },
  TOGGLE_LOCK: { type: 'TOGGLE_LOCK', scryfallId: 'x' },
  SET_CHAT_MESSAGES: { type: 'SET_CHAT_MESSAGES', messages: [{ role: 'user', content: 'hi' }] },
  SET_SECTION_PLAN: { type: 'SET_SECTION_PLAN', sections: [makeSection('s1')] },
  ASSIGN_SECTION: { type: 'ASSIGN_SECTION', sectionId: 's1', scryfallIds: ['x'] },
  CLEAR_SECTION_ASSIGNMENTS: { type: 'CLEAR_SECTION_ASSIGNMENTS' },
  NEXT_STEP: { type: 'NEXT_STEP' },
  PREV_STEP: { type: 'PREV_STEP' },
  GO_TO_STEP: { type: 'GO_TO_STEP', step: 1 },
  RESET: { type: 'RESET' },
}

const ALL_ACTIONS: WizardAction[] = Object.values(ACTION_TABLE)

// ─── C1: step navigation ─────────────────────────────────────────────────────

describe('C1: step navigation', () => {
  it('C1-a: NEXT_STEP advances the step and raises maxStepReached as a high-water mark', () => {
    const next = wizardReducer(makeState(), { type: 'NEXT_STEP' })
    expect(next.step).toBe(2)
    expect(next.maxStepReached).toBe(2)
  })

  it('C1-b: NEXT_STEP at step 4 returns the SAME object (no wasted re-render)', () => {
    const state = makeState({ step: 4, maxStepReached: 4 })
    expect(wizardReducer(state, { type: 'NEXT_STEP' })).toBe(state)
  })

  it('C1-c: NEXT_STEP below the high-water mark advances without lowering it', () => {
    const next = wizardReducer(makeState({ step: 1, maxStepReached: 4 }), { type: 'NEXT_STEP' })
    expect(next.step).toBe(2)
    expect(next.maxStepReached).toBe(4)
  })

  it('C1-d: PREV_STEP never lowers maxStepReached', () => {
    const next = wizardReducer(makeState({ step: 3, maxStepReached: 3 }), { type: 'PREV_STEP' })
    expect(next.step).toBe(2)
    expect(next.maxStepReached).toBe(3)
  })

  it('C1-e: PREV_STEP at step 1 returns the SAME object', () => {
    const state = makeState({ step: 1 })
    expect(wizardReducer(state, { type: 'PREV_STEP' })).toBe(state)
  })

  it('C1-f: GO_TO_STEP within maxStepReached moves the step', () => {
    const next = wizardReducer(makeState({ step: 1, maxStepReached: 3 }), { type: 'GO_TO_STEP', step: 3 })
    expect(next.step).toBe(3)
  })

  it('C1-g: GO_TO_STEP beyond maxStepReached is a SILENT no-op (same object, no error)', () => {
    const state = makeState({ step: 1, maxStepReached: 2 })
    expect(wizardReducer(state, { type: 'GO_TO_STEP', step: 4 })).toBe(state)
  })

  it('C1-h: GO_TO_STEP never raises maxStepReached itself', () => {
    const next = wizardReducer(makeState({ step: 3, maxStepReached: 3 }), { type: 'GO_TO_STEP', step: 1 })
    expect(next.maxStepReached).toBe(3)
  })
})

// ─── C2: seed card ───────────────────────────────────────────────────────────

describe('C2: seed card', () => {
  it('C2-a: SET_SEED_CARD promotes an unselected cost colour to selected', () => {
    const next = wizardReducer(makeState(), { type: 'SET_SEED_CARD', card: seedCard, costColors: ['R'] })
    expect(next.colors.R).toBe('selected')
    expect(next.seedCard).toBe(seedCard)
  })

  it('C2-b: SET_SEED_CARD promotes maybe → selected', () => {
    const state = makeState({ colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'maybe', G: 'unselected' } })
    expect(wizardReducer(state, { type: 'SET_SEED_CARD', card: seedCard, costColors: ['R'] }).colors.R).toBe('selected')
  })

  it('C2-c: SET_SEED_CARD never DEMOTES an already-selected colour outside the cost', () => {
    const state = makeState({ colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' } })
    const next = wizardReducer(state, { type: 'SET_SEED_CARD', card: seedCard, costColors: ['R'] })
    expect(next.colors.W).toBe('selected')
  })

  it('C2-d: SET_SEED_CARD leaves non-cost colours untouched, including maybe', () => {
    const state = makeState({ colors: { W: 'unselected', U: 'maybe', B: 'unselected', R: 'unselected', G: 'unselected' } })
    const next = wizardReducer(state, { type: 'SET_SEED_CARD', card: seedCard, costColors: ['R'] })
    expect(next.colors.U).toBe('maybe')
  })

  it('C2-e: a colourless seed leaves colours VALUE-equal (identity does change)', () => {
    const state = makeState({ colors: { W: 'selected', U: 'maybe', B: 'unselected', R: 'unselected', G: 'unselected' } })
    const next = wizardReducer(state, { type: 'SET_SEED_CARD', card: seedCard, costColors: [] })
    expect(next.colors).toEqual(state.colors)
  })

  it('C2-f: CLEAR_SEED_CARD drops the seed but keeps the colours it promoted', () => {
    const state = makeState({ seedCard, colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'unselected' } })
    const next = wizardReducer(state, { type: 'CLEAR_SEED_CARD' })
    expect(next.seedCard).toBeNull()
    expect(next.colors.R).toBe('selected')
  })
})

// ─── C3: colours ─────────────────────────────────────────────────────────────

describe('C3: colours', () => {
  it('C3-a: SET_COLOR sets one colour and leaves the rest alone', () => {
    const next = wizardReducer(makeState(), { type: 'SET_COLOR', color: 'G', state: 'maybe' })
    expect(next.colors).toEqual({ W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'maybe' })
  })

  it('C3-b: CLEAR_COLORS resets all five to unselected', () => {
    const state = makeState({ colors: { W: 'selected', U: 'maybe', B: 'selected', R: 'maybe', G: 'selected' } })
    expect(wizardReducer(state, { type: 'CLEAR_COLORS' }).colors).toEqual({
      W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected',
    })
  })
})

// ─── C4: archetypes and traits ───────────────────────────────────────────────

describe('C4: archetypes and traits', () => {
  it('C4-a: TOGGLE_ARCHETYPE adds when absent', () => {
    expect(wizardReducer(makeState(), { type: 'TOGGLE_ARCHETYPE', traitId: 'aggro' }).selectedArchetypes).toEqual(['aggro'])
  })

  it('C4-b: TOGGLE_ARCHETYPE removes when present', () => {
    const state = makeState({ selectedArchetypes: ['aggro', 'burn'] })
    expect(wizardReducer(state, { type: 'TOGGLE_ARCHETYPE', traitId: 'aggro' }).selectedArchetypes).toEqual(['burn'])
  })

  it('C4-c: TOGGLE_ARCHETYPE caps at 3 — a fourth ADD is a no-op (same object)', () => {
    const state = makeState({ selectedArchetypes: ['a', 'b', 'c'] })
    expect(wizardReducer(state, { type: 'TOGGLE_ARCHETYPE', traitId: 'd' })).toBe(state)
  })

  it('C4-d: the cap is add-only — REMOVAL still works at 3', () => {
    const state = makeState({ selectedArchetypes: ['a', 'b', 'c'] })
    expect(wizardReducer(state, { type: 'TOGGLE_ARCHETYPE', traitId: 'b' }).selectedArchetypes).toEqual(['a', 'c'])
  })

  it('C4-e: TOGGLE_TRAIT has NO cap', () => {
    const state = makeState({ selectedTraits: ['a', 'b', 'c', 'd'] })
    expect(wizardReducer(state, { type: 'TOGGLE_TRAIT', traitId: 'e' }).selectedTraits).toHaveLength(5)
  })

  it('C4-f: SET_RARITY_FILTER accepts [] — the never-empty invariant is UI-only', () => {
    expect(wizardReducer(makeState(), { type: 'SET_RARITY_FILTER', rarities: [] }).rarityFilter).toEqual([])
  })

  it('C4-g: SET_BUDGET writes both bounds, nulls included', () => {
    const next = wizardReducer(makeState({ budgetMin: 5, budgetMax: 50 }), { type: 'SET_BUDGET', min: null, max: null })
    expect(next.budgetMin).toBeNull()
    expect(next.budgetMax).toBeNull()
  })
})

// ─── C5: combos ──────────────────────────────────────────────────────────────

describe('C5: combos', () => {
  const combos = [makeCombo('alpha'), makeCombo('beta')]

  it('C5-a: SET_CORE_COMBOS always nulls the selection', () => {
    const state = makeState({ coreCombos: combos, selectedComboIndex: 1 })
    expect(wizardReducer(state, { type: 'SET_CORE_COMBOS', combos }).selectedComboIndex).toBeNull()
  })

  it('C5-b: SET_CORE_COMBOS nulls the selection even when RE-SETTING the same combos (navigateHistory pin)', () => {
    const state = makeState({ coreCombos: combos, selectedComboIndex: 0 })
    const next = wizardReducer(state, { type: 'SET_CORE_COMBOS', combos: state.coreCombos })
    expect(next.selectedComboIndex).toBeNull()
    expect(next.coreCombos).toBe(state.coreCombos)
  })

  it('C5-c: SELECT_COMBO seeds deckName / deckDescription from the chosen combo', () => {
    const state = makeState({ coreCombos: combos })
    const next = wizardReducer(state, { type: 'SELECT_COMBO', index: 1 })
    expect(next.selectedComboIndex).toBe(1)
    expect(next.deckName).toBe('beta')
    expect(next.deckDescription).toBe('beta wins')
  })

  it('C5-d: re-selecting the SAME index keeps the deck and the metadata', () => {
    const state = makeState({
      coreCombos: combos,
      selectedComboIndex: 0,
      deckCards: [makeCard('x')],
      deckName: 'user typed this',
    })
    const next = wizardReducer(state, { type: 'SELECT_COMBO', index: 0 })
    expect(next.deckName).toBe('user typed this')
    expect(next.deckCards).toHaveLength(1)
  })

  it('C5-e: switching to a DIFFERENT combo with a populated deck clears the downstream deck state', () => {
    const state = makeState({
      coreCombos: combos,
      selectedComboIndex: 0,
      deckCards: [makeCard('x')],
      lockedCardIds: ['x'],
      sectionPlan: [makeSection('s1')],
      sectionAssignments: { s1: ['x'] },
    })
    const next = wizardReducer(state, { type: 'SELECT_COMBO', index: 1 })
    expect(next.deckCards).toEqual([])
    expect(next.lockedCardIds).toEqual([])
    expect(next.sectionPlan).toEqual([])
    expect(next.sectionAssignments).toEqual({})
  })

  it('C5-f: switching combos with an EMPTY deck rewrites metadata only', () => {
    const state = makeState({ coreCombos: combos, selectedComboIndex: 0, deckName: 'alpha' })
    const next = wizardReducer(state, { type: 'SELECT_COMBO', index: 1 })
    expect(next.deckName).toBe('beta')
    expect(next.deckCards).toEqual([])
  })
})

// ─── C6: deck and metadata ───────────────────────────────────────────────────

describe('C6: deck and metadata', () => {
  it('C6-a: SET_DECK replaces the cards', () => {
    const cards = [makeCard('x'), makeCard('y')]
    expect(wizardReducer(makeState(), { type: 'SET_DECK', cards }).deckCards).toBe(cards)
  })

  it('C6-b: SET_DECK uses ?? not || — an explicit empty name CLEARS it (ReopenComboPicker stages name: "")', () => {
    const state = makeState({ deckName: 'old' })
    expect(wizardReducer(state, { type: 'SET_DECK', cards: [], name: '' }).deckName).toBe('')
  })

  it('C6-c: SET_DECK with no name keeps the existing name', () => {
    const state = makeState({ deckName: 'kept' })
    expect(wizardReducer(state, { type: 'SET_DECK', cards: [] }).deckName).toBe('kept')
  })

  it('C6-d: SET_DECK_METADATA uses ?? too — an explicit empty description clears it', () => {
    const state = makeState({ deckDescription: 'old' })
    expect(wizardReducer(state, { type: 'SET_DECK_METADATA', description: '' }).deckDescription).toBe('')
  })

  it('C6-e: SET_DECK_METADATA leaves deckCards alone', () => {
    const state = makeState({ deckCards: [makeCard('x')] })
    expect(wizardReducer(state, { type: 'SET_DECK_METADATA', name: 'n' }).deckCards).toBe(state.deckCards)
  })

  it('C6-f: SET_CHAT_MESSAGES replaces the transcript', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }]
    expect(wizardReducer(makeState(), { type: 'SET_CHAT_MESSAGES', messages }).chatMessages).toBe(messages)
  })
})

// ─── C7: locks ───────────────────────────────────────────────────────────────

describe('C7: locks', () => {
  it('C7-a: TOGGLE_LOCK adds then removes', () => {
    const locked = wizardReducer(makeState(), { type: 'TOGGLE_LOCK', scryfallId: 'x' })
    expect(locked.lockedCardIds).toEqual(['x'])
    expect(wizardReducer(locked, { type: 'TOGGLE_LOCK', scryfallId: 'x' }).lockedCardIds).toEqual([])
  })

  it('C7-b: TOGGLE_LOCK accepts an id ABSENT from deckCards — removing a card leaves an orphan lock', () => {
    const state = makeState({ deckCards: [makeCard('x')] })
    expect(wizardReducer(state, { type: 'TOGGLE_LOCK', scryfallId: 'not-in-deck' }).lockedCardIds).toEqual(['not-in-deck'])
  })
})

// ─── C8: sections ────────────────────────────────────────────────────────────

describe('C8: sections', () => {
  it('C8-a: ASSIGN_SECTION is per-section REPLACE, not append', () => {
    const state = makeState({ sectionAssignments: { s1: ['a', 'b'] } })
    expect(wizardReducer(state, { type: 'ASSIGN_SECTION', sectionId: 's1', scryfallIds: ['c'] }).sectionAssignments).toEqual({ s1: ['c'] })
  })

  it('C8-b: ASSIGN_SECTION leaves other sections untouched', () => {
    const state = makeState({ sectionAssignments: { s1: ['a'], s2: ['b'] } })
    expect(wizardReducer(state, { type: 'ASSIGN_SECTION', sectionId: 's1', scryfallIds: ['c'] }).sectionAssignments).toEqual({ s1: ['c'], s2: ['b'] })
  })

  it('C8-c: ASSIGN_SECTION does NOT dedupe and does NOT enforce cross-section exclusivity', () => {
    const state = makeState({ sectionAssignments: { s2: ['a'] } })
    const next = wizardReducer(state, { type: 'ASSIGN_SECTION', sectionId: 's1', scryfallIds: ['a', 'a'] })
    expect(next.sectionAssignments).toEqual({ s1: ['a', 'a'], s2: ['a'] })
  })

  it('C8-d: SET_SECTION_PLAN leaves assignments for DROPPED section ids behind', () => {
    const state = makeState({ sectionPlan: [makeSection('s1')], sectionAssignments: { s1: ['a'] } })
    const next = wizardReducer(state, { type: 'SET_SECTION_PLAN', sections: [makeSection('s2')] })
    expect(next.sectionAssignments).toEqual({ s1: ['a'] })
  })

  it('C8-e: CLEAR_SECTION_ASSIGNMENTS empties the map (dead action — nothing dispatches it)', () => {
    const state = makeState({ sectionAssignments: { s1: ['a'] } })
    expect(wizardReducer(state, { type: 'CLEAR_SECTION_ASSIGNMENTS' }).sectionAssignments).toEqual({})
  })
})

// ─── C9: purity ──────────────────────────────────────────────────────────────

describe('C9: purity — no action mutates its input state', () => {
  it.each(ALL_ACTIONS.map((a) => [a.type, a] as const))('C9: %s leaves the input state deep-equal to its clone', (_type, action) => {
    const state = makeState({
      step: 2,
      maxStepReached: 3,
      colors: { W: 'selected', U: 'maybe', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedArchetypes: ['aggro'],
      selectedTraits: ['lifegain'],
      coreCombos: [makeCombo('alpha')],
      selectedComboIndex: 0,
      deckCards: [makeCard('x')],
      lockedCardIds: ['x'],
      deckName: 'name',
      deckDescription: 'desc',
      chatMessages: [{ role: 'user', content: 'hi' }],
      sectionPlan: [makeSection('s1')],
      sectionAssignments: { s1: ['x'] },
    })
    const clone = structuredClone(state)
    wizardReducer(state, action)
    expect(state).toEqual(clone)
  })
})

// ─── C10: hydration ──────────────────────────────────────────────────────────

describe('C10: hydrateWizardState', () => {
  it('C10-a: no stored state → the defaults', () => {
    expect(hydrateWizardState(null)).toEqual(makeState())
  })

  it('C10-b: a PARTIAL colours record does not punch a hole — unlisted colours keep their default', () => {
    const hydrated = hydrateWizardState({ colors: { R: 'selected' } })
    expect(hydrated.colors).toEqual({ W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'unselected' })
  })

  it('C10-c: a null colours record falls back to the defaults', () => {
    expect(hydrateWizardState({ colors: null }).colors).toEqual(makeState().colors)
  })

  it('C10-d: a null sectionAssignments falls back to an empty map', () => {
    expect(hydrateWizardState({ sectionAssignments: null }).sectionAssignments).toEqual({})
  })

  it('C10-e: legacy budgetLimit migrates to budgetMax when budgetMax is absent', () => {
    expect(hydrateWizardState({ budgetLimit: 40 }).budgetMax).toBe(40)
  })

  it('C10-f: with BOTH keys present, budgetMax wins and budgetLimit does not survive into the state', () => {
    const hydrated = hydrateWizardState({ budgetLimit: 40, budgetMax: 90 })
    expect(hydrated.budgetMax).toBe(90)
    expect(hydrated).not.toHaveProperty('budgetLimit')
  })

  it('C10-g: an explicit budgetMax of null still evicts the legacy key', () => {
    const hydrated = hydrateWizardState({ budgetLimit: 40, budgetMax: null })
    expect(hydrated.budgetMax).toBeNull()
    expect(hydrated).not.toHaveProperty('budgetLimit')
  })

  it('C10-h: a stored step of 7 clamps to 4 so a step always renders', () => {
    expect(hydrateWizardState({ step: 7, maxStepReached: 7 }).step).toBe(4)
  })

  it('C10-i: a stored step of 0 or a non-number clamps to 1', () => {
    expect(hydrateWizardState({ step: 0 }).step).toBe(1)
    expect(hydrateWizardState({ step: 'three' }).step).toBe(1)
  })

  it('C10-j: maxStepReached below step is reconciled UP to step', () => {
    const hydrated = hydrateWizardState({ step: 3, maxStepReached: 1 })
    expect(hydrated.step).toBe(3)
    expect(hydrated.maxStepReached).toBe(3)
  })

  it('C10-k: maxStepReached above step is preserved (going back is legal)', () => {
    const hydrated = hydrateWizardState({ step: 1, maxStepReached: 4 })
    expect(hydrated.maxStepReached).toBe(4)
  })

  it('C10-l: maxStepReached out of range clamps too', () => {
    expect(hydrateWizardState({ step: 2, maxStepReached: 99 }).maxStepReached).toBe(4)
  })

  it('C10-m: known stored keys still merge over the defaults (the rest of the shallow merge is intact)', () => {
    expect(hydrateWizardState({ deckName: 'resumed', selectedTraits: ['lifegain'] })).toMatchObject({
      deckName: 'resumed',
      selectedTraits: ['lifegain'],
    })
  })

  it('C10-m2: UNKNOWN stored keys still pass straight through — only budgetLimit is evicted by name', () => {
    const hydrated = hydrateWizardState({ someRetiredKey: 1 }) as WizardState & { someRetiredKey?: number }
    expect(hydrated.someRetiredKey).toBe(1)
    // The residual of bug 2: any other retired key a past build wrote survives
    // and the persist effect keeps writing it back. Only budgetLimit is named.
  })

  it('C10-m3: stored field VALUES are not validated — hydration guards shape, not type', () => {
    const hydrated = hydrateWizardState({ deckCards: 'not-an-array' }) as unknown as { deckCards: unknown }
    expect(hydrated.deckCards).toBe('not-an-array')
  })

  it('C10-n: hydrateWizardState does not mutate its input', () => {
    const parsed = { budgetLimit: 40, colors: { R: 'selected' }, step: 9 }
    const clone = structuredClone(parsed)
    hydrateWizardState(parsed)
    expect(parsed).toEqual(clone)
  })
})

describe('C10: initialWizardState (storage-backed)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('C10-o: empty storage → the defaults', () => {
    expect(initialWizardState()).toEqual(makeState())
  })

  it('C10-p: round-trips a persisted state', () => {
    persistWizardState(makeState({ step: 2, maxStepReached: 2, deckName: 'saved' }))
    expect(initialWizardState()).toMatchObject({ step: 2, deckName: 'saved' })
  })

  it('C10-q: corrupt JSON → the defaults, no throw', () => {
    localStorage.setItem('manaschmiede-wizard', '{not json')
    expect(initialWizardState()).toEqual(makeState())
  })

  it('C10-r: a persisted out-of-range step is clamped on the way back in', () => {
    localStorage.setItem('manaschmiede-wizard', JSON.stringify({ step: 7, maxStepReached: 7 }))
    expect(initialWizardState().step).toBe(4)
  })
})

// ─── C11: reset pairing and aux persistence ──────────────────────────────────

describe('C11: reset pairing and aux persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('C11-a: RESET returns the defaults', () => {
    const state = makeState({ step: 4, maxStepReached: 4, deckName: 'x', deckCards: [makeCard('x')] })
    expect(wizardReducer(state, { type: 'RESET' })).toEqual(makeState())
  })

  it('C11-b: RESET is a pure reducer case — it does NOT touch localStorage', () => {
    persistWizardState(makeState({ deckName: 'still here' }))
    wizardReducer(makeState({ deckName: 'still here' }), { type: 'RESET' })
    expect(localStorage.getItem('manaschmiede-wizard')).toContain('still here')
  })

  it('C11-c: resetWizard dispatches RESET *and* clears the aux slot', () => {
    persistWizardAux({ comboHistory: [[makeCombo('alpha')]], historyIndex: 3 })
    const dispatch = vi.fn()
    resetWizard(dispatch)
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESET' })
    expect(loadWizardAux().comboHistory).toEqual([])
    expect(loadWizardAux().historyIndex).toBe(0)
  })

  it('C11-d: clearWizardState removes BOTH the wizard and the aux key', () => {
    persistWizardState(makeState({ deckName: 'x' }))
    persistWizardAux({ historyIndex: 2 })
    clearWizardState()
    expect(localStorage.getItem('manaschmiede-wizard')).toBeNull()
    expect(localStorage.getItem('manaschmiede-wizard-aux')).toBeNull()
  })

  it('C11-e: loadWizardAux fills missing keys from the defaults', () => {
    localStorage.setItem('manaschmiede-wizard-aux', JSON.stringify({ historyIndex: 5 }))
    const aux = loadWizardAux()
    expect(aux.historyIndex).toBe(5)
    expect(aux.comboBuffer).toEqual([])
  })
})
