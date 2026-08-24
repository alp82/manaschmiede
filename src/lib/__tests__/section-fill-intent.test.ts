/**
 * RED tests — sectionFillIntentFromWizard and sectionFillIntentFromDeck do not
 * exist yet. They must be exported from src/lib/section-fill-intent.ts.
 *
 * Asserted signatures:
 *   interface SectionFillIntent {
 *     selectedArchetypes: string[]
 *     selectedTraits: string[]
 *     customStrategy: string
 *     format: DeckFormat
 *     budgetMin: number | null
 *     budgetMax: number | null
 *     rarityFilter: string[]
 *     sectionAssignments: Record<string, string[]>
 *     getFillColors(): { ready: boolean; colors?: ManaColor[] }
 *   }
 *   sectionFillIntentFromWizard(state: WizardState): SectionFillIntent
 *   sectionFillIntentFromDeck(
 *     intent: DeckIntent,
 *     fallbackColors: ManaColor[],
 *     sectionAssignments?: Record<string, string[]>,
 *   ): SectionFillIntent
 *
 * NOT unit-testable (noted here, not written):
 *   - callFillSection network call (integration/e2e)
 *   - useSectionFill hook (React hook, not unit-tested)
 */
import { describe, it, expect } from 'vitest'
import { sectionFillIntentFromWizard, sectionFillIntentFromDeck } from '../section-fill-intent'
import type { SectionFillIntent } from '../section-fill-intent'
import { emptyIntent } from '../deck-intent'
import type { DeckIntent } from '../deck-intent'
import type { ManaColor } from '../mana-colors'
import type { WizardState } from '../wizard-state'
import type { ScryfallCard } from '../scryfall/types'
import type { CoreCombo } from '../wizard-state'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeScryfallCard(id: string, color_identity: string[]): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: 'Creature',
    oracle_text: '',
    color_identity,
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function makeCombo(name: string, cards: CoreCombo['cards']): CoreCombo {
  return { name, explanation: `${name} combo`, cards }
}

function defaultWizardState(): WizardState {
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
  }
}

function emptyDeckIntent(): DeckIntent {
  return emptyIntent()
}

// ─── sectionFillIntentFromWizard — C1: format passthrough ─────────────────

describe('sectionFillIntentFromWizard - C1: format passthrough', () => {
  it("passes 'casual' through unchanged (adapter does NOT strip; callFillSection does)", () => {
    const state: WizardState = { ...defaultWizardState(), format: 'casual' }
    const result: SectionFillIntent = sectionFillIntentFromWizard(state)
    expect(result.format).toBe('casual')
  })

  it("passes 'standard' through unchanged", () => {
    const state: WizardState = { ...defaultWizardState(), format: 'standard' }
    const result: SectionFillIntent = sectionFillIntentFromWizard(state)
    expect(result.format).toBe('standard')
  })

  it("passes 'modern' through unchanged", () => {
    const state: WizardState = { ...defaultWizardState(), format: 'modern' }
    const result: SectionFillIntent = sectionFillIntentFromWizard(state)
    expect(result.format).toBe('modern')
  })
})

// ─── sectionFillIntentFromWizard — regression: all fields mapped ──────────

describe('sectionFillIntentFromWizard - regression: all fields mapped', () => {
  const state: WizardState = {
    ...defaultWizardState(),
    selectedArchetypes: ['aggro', 'midrange'],
    selectedTraits: ['tribal', 'graveyard'],
    customStrategy: 'Go wide and sacrifice',
    format: 'modern',
    budgetMin: 0.25,
    budgetMax: 3.0,
    rarityFilter: ['common', 'uncommon'],
    sectionAssignments: { creatures: ['card-a', 'card-b'], spells: ['card-c'] },
  }

  it('selectedArchetypes maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.selectedArchetypes).toEqual(['aggro', 'midrange'])
  })

  it('selectedTraits maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.selectedTraits).toEqual(['tribal', 'graveyard'])
  })

  it('customStrategy maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.customStrategy).toBe('Go wide and sacrifice')
  })

  it('budgetMin maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.budgetMin).toBe(0.25)
  })

  it('budgetMax maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.budgetMax).toBe(3.0)
  })

  it('budgetMin null passes as null', () => {
    const s: WizardState = { ...state, budgetMin: null }
    const result = sectionFillIntentFromWizard(s)
    expect(result.budgetMin).toBeNull()
  })

  it('budgetMax null passes as null', () => {
    const s: WizardState = { ...state, budgetMax: null }
    const result = sectionFillIntentFromWizard(s)
    expect(result.budgetMax).toBeNull()
  })

  it('rarityFilter maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.rarityFilter).toEqual(['common', 'uncommon'])
  })

  it('sectionAssignments maps', () => {
    const result = sectionFillIntentFromWizard(state)
    expect(result.sectionAssignments).toEqual({
      creatures: ['card-a', 'card-b'],
      spells: ['card-c'],
    })
  })

  it('sectionAssignments {} passes as {}', () => {
    const s: WizardState = { ...state, sectionAssignments: {} }
    const result = sectionFillIntentFromWizard(s)
    expect(result.sectionAssignments).toEqual({})
  })
})

// ─── sectionFillIntentFromWizard — getFillColors gate (wizard adapter) ────

describe('sectionFillIntentFromWizard - getFillColors gate (wizard adapter)', () => {
  it('no colors selected + no combo -> {ready:true, colors:[]} (wizard-state.ts:227-229)', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedComboIndex: null,
    }
    const result = sectionFillIntentFromWizard(state)
    expect(result.getFillColors()).toEqual({ ready: true, colors: [] })
  })

  it('W selected, no combo -> {ready:true, colors:[\'W\']}', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedComboIndex: null,
    }
    const result = sectionFillIntentFromWizard(state)
    expect(result.getFillColors()).toEqual({ ready: true, colors: ['W'] })
  })

  it('combo selected but a card has no scryfallCard -> {ready:false}', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedComboIndex: 0,
      coreCombos: [
        makeCombo('Blue Combo', [
          { name: 'Unresolved Card', scryfallId: 'unresolved-id' }, // no scryfallCard
        ]),
      ],
    }
    const result = sectionFillIntentFromWizard(state)
    expect(result.getFillColors().ready).toBe(false)
  })

  it("combo resolved, card color_identity ['U','R'] -> {ready:true, colors:['U','R']}", () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedComboIndex: 0,
      coreCombos: [
        makeCombo('UR Combo', [
          {
            name: 'UR Card',
            scryfallId: 'ur-id',
            scryfallCard: makeScryfallCard('ur-id', ['U', 'R']),
          },
        ]),
      ],
    }
    const result = sectionFillIntentFromWizard(state)
    expect(result.getFillColors()).toEqual({ ready: true, colors: ['U', 'R'] })
  })
})

// ─── sectionFillIntentFromDeck — C2: getFillColors load-window gate ───────

describe('sectionFillIntentFromDeck - C2: getFillColors load-window gate', () => {
  it('emptyIntent + fallbackColors [] -> {ready:false} (empty committed AND empty fallback blocks)', () => {
    const result = sectionFillIntentFromDeck(emptyDeckIntent(), [])
    expect(result.getFillColors().ready).toBe(false)
  })

  it('committed colors present (U,G selected) + [] -> {ready:true, colors:[\'U\',\'G\']} (WUBRG order)', () => {
    const intent: DeckIntent = {
      ...emptyDeckIntent(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'unselected', G: 'selected' },
    }
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.getFillColors()).toEqual({ ready: true, colors: ['U', 'G'] })
  })

  it("emptyIntent + fallbackColors ['R','G'] -> {ready:true, colors:['R','G']}", () => {
    const result = sectionFillIntentFromDeck(emptyDeckIntent(), ['R', 'G'])
    expect(result.getFillColors()).toEqual({ ready: true, colors: ['R', 'G'] })
  })

  it("committed (U selected) wins over fallback ['R'] -> {ready:true, colors:['U']}", () => {
    const intent: DeckIntent = {
      ...emptyDeckIntent(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
    }
    const result = sectionFillIntentFromDeck(intent, ['R'])
    expect(result.getFillColors()).toEqual({ ready: true, colors: ['U'] })
  })
})

// ─── sectionFillIntentFromDeck — field mapping ────────────────────────────

describe('sectionFillIntentFromDeck - field mapping', () => {
  const intent: DeckIntent = {
    colors: { W: 'selected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
    archetypes: ['control-id', 'tempo-id'],
    traits: ['flash-id'],
    customStrategy: 'Counter and draw',
    budgetMin: 1.0,
    budgetMax: 10.0,
    rarityFilter: ['rare', 'mythic'],
  }

  it('selectedArchetypes from intent.archetypes', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.selectedArchetypes).toEqual(['control-id', 'tempo-id'])
  })

  it('selectedTraits from intent.traits', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.selectedTraits).toEqual(['flash-id'])
  })

  it('customStrategy maps', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.customStrategy).toBe('Counter and draw')
  })

  it('budgetMin maps', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.budgetMin).toBe(1.0)
  })

  it('budgetMax maps', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.budgetMax).toBe(10.0)
  })

  it('rarityFilter maps', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.rarityFilter).toEqual(['rare', 'mythic'])
  })

  it('sectionAssignments defaults to {} when the caller omits them', () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.sectionAssignments).toEqual({})
  })

  it('sectionAssignments passes the deck-supplied map through unchanged', () => {
    const assignments = { creatures: ['card-a', 'card-b'], lands: ['card-c'] }
    const result = sectionFillIntentFromDeck(intent, [], assignments)
    expect(result.sectionAssignments).toEqual(assignments)
  })

  it("format === 'casual' (RESOLVED GAP: app is hard 60-card-casual-only, constant default)", () => {
    const result = sectionFillIntentFromDeck(intent, [])
    expect(result.format).toBe('casual')
  })
})
