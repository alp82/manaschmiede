/**
 * RED tests — emptyIntent, intentFromWizard, and deriveIntentFilters do not
 * exist yet. They must be exported from src/lib/deck-intent.ts.
 *
 * Asserted signatures:
 *   emptyIntent(): DeckIntent
 *   intentFromWizard(state: WizardState): DeckIntent
 *   deriveIntentFilters(intent: DeckIntent, fallbackColors?: ManaColor[]): DeckFilters
 *
 * DeckIntent shape:
 *   colors: Record<ManaColor, 'selected' | 'unselected'>
 *   archetypes: string[]
 *   traits: string[]
 *   customStrategy: string
 *   budgetMin: number | null
 *   budgetMax: number | null
 *   rarityFilter: string[]
 *
 * NOT unit-testable (manual / structural tests noted here, not written):
 *   - legacy-deck panel pre-seed (manual UI)
 *   - inert-edit behavior (manual UI)
 *   - addCard-does-not-consult-gate (structural/code-review)
 */
import { describe, it, expect } from 'vitest'
import { emptyIntent, intentFromWizard, deriveIntentFilters } from '../deck-intent'
import type { DeckIntent } from '../deck-intent'
import type { ManaColor } from '../../components/ManaSymbol'
import type { WizardState } from '../wizard-state'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixture helpers ───────────────────────────────────────────────────────

const ALL_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']

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

/** Minimal ScryfallCard for color_identity fixtures. */
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

// ─── emptyIntent ────────────────────────────────────────────────────────────

describe('emptyIntent', () => {
  it('returns the correct default shape', () => {
    const intent: DeckIntent = emptyIntent()
    // Every color must be 'unselected'
    for (const color of ALL_COLORS) {
      expect(intent.colors[color]).toBe('unselected')
    }
    expect(intent.archetypes).toEqual([])
    expect(intent.traits).toEqual([])
    expect(intent.customStrategy).toBe('')
    expect(intent.budgetMin).toBeNull()
    expect(intent.budgetMax).toBeNull()
    expect(intent.rarityFilter).toEqual(['common', 'uncommon', 'rare', 'mythic'])
  })

  it('two calls return deep-equal but non-identical objects', () => {
    const a = emptyIntent()
    const b = emptyIntent()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    // The colors records must also be separate objects
    expect(a.colors).not.toBe(b.colors)
  })

  it('colors record has exactly the five mana keys', () => {
    const intent = emptyIntent()
    expect(Object.keys(intent.colors).sort()).toEqual(['B', 'G', 'R', 'U', 'W'])
  })
})

// ─── intentFromWizard — basic field snapshots ────────────────────────────

describe('intentFromWizard — field snapshots', () => {
  it('snapshots selectedArchetypes from wizard state', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedArchetypes: ['aggro', 'burn'],
    }
    const intent = intentFromWizard(state)
    expect(intent.archetypes).toEqual(['aggro', 'burn'])
  })

  it('snapshots selectedTraits from wizard state', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedTraits: ['synergy', 'tribal'],
    }
    const intent = intentFromWizard(state)
    expect(intent.traits).toEqual(['synergy', 'tribal'])
  })

  it('snapshots customStrategy from wizard state', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      customStrategy: 'Swarm with cheap creatures',
    }
    const intent = intentFromWizard(state)
    expect(intent.customStrategy).toBe('Swarm with cheap creatures')
  })

  it('snapshots budgetMax value when set', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      budgetMax: 2.5,
    }
    const intent = intentFromWizard(state)
    expect(intent.budgetMax).toBe(2.5)
  })

  it('snapshots budgetMax as null when not set', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      budgetMax: null,
    }
    const intent = intentFromWizard(state)
    expect(intent.budgetMax).toBeNull()
  })

  it('snapshots budgetMin value when set', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      budgetMin: 0.25,
    }
    const intent = intentFromWizard(state)
    expect(intent.budgetMin).toBe(0.25)
  })

  it('snapshots budgetMin as null when not set', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    }
    const intent = intentFromWizard(state)
    expect(intent.budgetMin).toBeNull()
  })

  it('snapshots rarityFilter from wizard state', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      rarityFilter: ['common', 'uncommon'],
    }
    const intent = intentFromWizard(state)
    expect(intent.rarityFilter).toEqual(['common', 'uncommon'])
  })

  it('result is independent of state.deckCards — changing deckCards does not affect intent', () => {
    const base: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      selectedArchetypes: ['midrange'],
    }
    const withDeck: WizardState = {
      ...base,
      deckCards: [{ scryfallId: 'card-1', quantity: 4, zone: 'main' }],
    }
    const intentBase = intentFromWizard(base)
    const intentDeck = intentFromWizard(withDeck)
    // All non-color fields must be identical
    expect(intentBase.archetypes).toEqual(intentDeck.archetypes)
    expect(intentBase.traits).toEqual(intentDeck.traits)
    expect(intentBase.customStrategy).toBe(intentDeck.customStrategy)
    expect(intentBase.budgetMin).toBe(intentDeck.budgetMin)
    expect(intentBase.budgetMax).toBe(intentDeck.budgetMax)
    expect(intentBase.rarityFilter).toEqual(intentDeck.rarityFilter)
  })

  it('W selected only -> colors has W:selected, rest unselected', () => {
    // No combo selected, so getFillColors returns selected colors only.
    // W is committed; U/B/R/G are unselected — none used by combo either.
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    }
    const intent = intentFromWizard(state)
    expect(intent.colors.W).toBe('selected')
    expect(intent.colors.U).toBe('unselected')
    expect(intent.colors.B).toBe('unselected')
    expect(intent.colors.R).toBe('unselected')
    expect(intent.colors.G).toBe('unselected')
  })
})

// ─── intentFromWizard B2 — maybe-color promotion via getFillColors ────────

describe('intentFromWizard B2 — used-maybe promotion (CRITICAL)', () => {
  /**
   * Fixture design:
   *   state.colors = { U:'selected', R:'maybe', rest:'unselected' }
   *   selectedComboIndex = 0
   *   coreCombos[0].cards[0].scryfallCard.color_identity = ['U','R']
   *
   * getFillColors will union selected (['U']) with the combo's color_identity (['U','R'])
   * -> returns ['U','R'] (WUBRG order).
   * intentFromWizard must map that to { U:'selected', R:'selected', rest:'unselected' }.
   * R was a 'maybe' and the combo USES red -> promoted to 'selected'.
   */
  it('R:maybe promoted to selected when combo USES red (color_identity includes R)', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'maybe', G: 'unselected' },
      selectedComboIndex: 0,
      coreCombos: [
        {
          name: 'UR Spells',
          explanation: 'Burn spells plus blue cantrips',
          cards: [
            {
              name: 'Lightning Bolt',
              scryfallId: 'bolt-id',
              scryfallCard: makeScryfallCard('bolt-id', ['U', 'R']),
            },
          ],
        },
      ],
    }
    const intent = intentFromWizard(state)
    // U was already selected; R was maybe and combo uses red -> both selected
    expect(intent.colors.U).toBe('selected')
    expect(intent.colors.R).toBe('selected')
    // Others remain unselected
    expect(intent.colors.W).toBe('unselected')
    expect(intent.colors.B).toBe('unselected')
    expect(intent.colors.G).toBe('unselected')
  })

  /**
   * Fixture design:
   *   state.colors = { U:'selected', R:'maybe', rest:'unselected' }
   *   selectedComboIndex = 0
   *   coreCombos[0].cards[0].scryfallCard.color_identity = ['U'] (no red)
   *
   * getFillColors unions selected (['U']) with combo color_identity (['U'])
   * -> returns ['U'] only.
   * R was a 'maybe' but combo does NOT use red -> dropped, R stays 'unselected'.
   */
  it('R:maybe dropped to unselected when combo does NOT use red', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'maybe', G: 'unselected' },
      selectedComboIndex: 0,
      coreCombos: [
        {
          name: 'Mono Blue',
          explanation: 'Pure blue control',
          cards: [
            {
              name: 'Counterspell',
              scryfallId: 'counter-id',
              scryfallCard: makeScryfallCard('counter-id', ['U']),
            },
          ],
        },
      ],
    }
    const intent = intentFromWizard(state)
    // R was maybe but combo does not use red -> dropped
    expect(intent.colors.U).toBe('selected')
    expect(intent.colors.R).toBe('unselected')
    expect(intent.colors.W).toBe('unselected')
    expect(intent.colors.B).toBe('unselected')
    expect(intent.colors.G).toBe('unselected')
  })

  /**
   * No combo selected (selectedComboIndex = null) with a 'maybe' color.
   * getFillColors returns only committed selected colors.
   * Maybe colors drop entirely — not promoted, not passed through.
   */
  it('maybe colors drop entirely when no combo is selected', () => {
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'maybe', G: 'unselected' },
      selectedComboIndex: null,
    }
    const intent = intentFromWizard(state)
    expect(intent.colors.U).toBe('selected')
    expect(intent.colors.R).toBe('unselected')
  })

  /**
   * Verifies that intentFromWizard delegates to getFillColors — the committed
   * colors in the intent must exactly equal the colors returned by getFillColors(state).
   * This guards the delegation contract regardless of the specific fixture above.
   */
  it('committed colors equal getFillColors(state).colors mapped', () => {
    // Use a fully-resolved state where getFillColors is computable
    const state: WizardState = {
      ...defaultWizardState(),
      colors: { W: 'selected', U: 'selected', B: 'unselected', R: 'maybe', G: 'unselected' },
      selectedComboIndex: 0,
      coreCombos: [
        {
          name: 'WUR',
          explanation: 'White blue red',
          cards: [
            {
              name: 'Jeskai Card',
              scryfallId: 'jeskai-id',
              // color_identity includes R -> R promoted from maybe
              scryfallCard: makeScryfallCard('jeskai-id', ['W', 'U', 'R']),
            },
          ],
        },
      ],
    }
    // getFillColors(state) should return ['W','U','R'] (WUBRG order)
    // intentFromWizard should produce colors that match exactly
    const intent = intentFromWizard(state)
    expect(intent.colors.W).toBe('selected')
    expect(intent.colors.U).toBe('selected')
    expect(intent.colors.R).toBe('selected')
    expect(intent.colors.B).toBe('unselected')
    expect(intent.colors.G).toBe('unselected')
  })
})

// ─── deriveIntentFilters ──────────────────────────────────────────────────

describe('deriveIntentFilters', () => {
  /**
   * Decision 1: only committed ('selected') colors go through.
   * Landmine guard: 'maybe' in wizard state is NOT in DeckIntent.colors
   * (intentFromWizard already resolved it), but deriveIntentFilters only sees
   * 'selected' | 'unselected' in intent.colors. The test below asserts
   * that only 'selected' colors appear in filters.colors.
   */
  it('selected={U,W}, rest unselected -> filters.colors contains W and U only (WUBRG order)', () => {
    const intent: DeckIntent = {
      ...emptyIntent(),
      colors: { W: 'selected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
    }
    const filters = deriveIntentFilters(intent)
    // WUBRG order: W before U
    expect(filters.colors).toEqual(['W', 'U'])
  })

  it('all unselected + fallbackColors -> filters.colors uses fallback', () => {
    const intent: DeckIntent = emptyIntent() // all unselected
    const filters = deriveIntentFilters(intent, ['R', 'G'])
    expect(filters.colors).toEqual(['R', 'G'])
  })

  it('all unselected + no fallback -> filters.colors is empty (no constraint)', () => {
    const intent: DeckIntent = emptyIntent()
    const filters = deriveIntentFilters(intent)
    expect(filters.colors).toEqual([])
  })

  it('all unselected + empty fallback array -> filters.colors is empty', () => {
    const intent: DeckIntent = emptyIntent()
    const filters = deriveIntentFilters(intent, [])
    expect(filters.colors).toEqual([])
  })

  it('committed wins when non-empty: selected={U}, fallback=[R] -> filters.colors is [U] not [R]', () => {
    const intent: DeckIntent = {
      ...emptyIntent(),
      colors: { W: 'unselected', U: 'selected', B: 'unselected', R: 'unselected', G: 'unselected' },
    }
    const filters = deriveIntentFilters(intent, ['R'])
    expect(filters.colors).toEqual(['U'])
  })

  it('budgetMin passed through to filters', () => {
    const intent: DeckIntent = { ...emptyIntent(), budgetMin: 0.5 }
    const filters = deriveIntentFilters(intent)
    expect(filters.budgetMin).toBe(0.5)
  })

  it('budgetMax passed through to filters', () => {
    const intent: DeckIntent = { ...emptyIntent(), budgetMax: 3.0 }
    const filters = deriveIntentFilters(intent)
    expect(filters.budgetMax).toBe(3.0)
  })

  it('budgetMin null passed through as null (not undefined)', () => {
    const intent: DeckIntent = { ...emptyIntent(), budgetMin: null }
    const filters = deriveIntentFilters(intent)
    expect(filters.budgetMin).toBeNull()
  })

  it('rarityFilter passed through to filters.rarities', () => {
    const intent: DeckIntent = { ...emptyIntent(), rarityFilter: ['common', 'uncommon'] }
    const filters = deriveIntentFilters(intent)
    expect(filters.rarities).toEqual(['common', 'uncommon'])
  })

  it('DeckFilters shape: has colors, budgetMin, budgetMax, rarities fields', () => {
    const intent: DeckIntent = {
      ...emptyIntent(),
      colors: { W: 'selected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      budgetMin: 0.1,
      budgetMax: 5.0,
      rarityFilter: ['rare', 'mythic'],
    }
    const filters = deriveIntentFilters(intent)
    expect(filters).toHaveProperty('colors')
    expect(filters).toHaveProperty('budgetMin')
    expect(filters).toHaveProperty('budgetMax')
    expect(filters).toHaveProperty('rarities')
  })
})
