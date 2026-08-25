/**
 * RED tests — `src/lib/deck-surface.ts` does not exist yet.
 *
 * The seam is one `DeckSurface` with two adapters, the same shape
 * `section-fill-intent.ts` already uses for fill:
 *
 *   deckSurfaceFromWizard({ state, dispatch, history, ... })  -> DeckSurface
 *   deckSurfaceFromSavedDeck({ deck, setDeck, history, ... }) -> DeckSurface
 *
 * Both adapters are plain functions over already-computed values, so every
 * mutator is drivable from node with a fake `dispatch` / `setDeck` and no
 * React. That is what these tests do: call a mutator, then assert on the
 * actions or state updaters it emitted.
 *
 * Behaviours pinned here (issue #26):
 *   - the two containers agree on add / quantity / remove / apply
 *   - `applyProposal` honours `targetSection` on BOTH surfaces
 *   - `applyProposal` snapshots on BOTH surfaces (the route did not)
 *   - the route's mutators read `prev`, never a captured closure, because
 *     `useStagedRederive` is the other writer of sectionPlan/sectionAssignments
 *   - removing a locked card in the wizard also clears the lock, so re-adding
 *     it does not bring it back locked (the live divergence #26 names)
 *
 * NOT unit-testable (noted here, not written):
 *   - the containers' own wiring into DeckEditor (React render)
 *   - autosave / colour derivation / PDF (route-only effects)
 */
import { describe, it, expect } from 'vitest'
import {
  deckSurfaceFromWizard,
  deckSurfaceFromSavedDeck,
  assignAddedCard,
  inheritProposalSections,
  type DeckSurface,
} from '../deck-surface'
import { wizardReducer } from '../wizard-state'
import type { WizardState, WizardAction } from '../wizard-state'
import type { Deck } from '../deck'
import type { DeckCard, DeckDisplayCard } from '../deck-utils'
import type { DeckSection } from '../section-plan'
import type { ScryfallCard } from '../scryfall/types'
import type { PendingChanges } from '../useDeckChat'
import type { CardChange } from '../deck-chat-types'

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeCard(id: string, type_line = 'Creature — Elf'): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line,
    oracle_text: '',
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function deckCard(scryfallId: string, quantity = 1, locked?: boolean): DeckCard {
  const c: DeckCard = { scryfallId, quantity, zone: 'main' }
  if (locked !== undefined) c.locked = locked
  return c
}

/** A plan with one lane per role, so pickSectionForCard always lands somewhere. */
function plan(): DeckSection[] {
  const roles: DeckSection['role'][] = ['creatures', 'spells', 'support', 'interaction', 'lands']
  return roles.map((role) => ({
    id: role,
    label: role,
    description: '',
    targetCount: 8,
    role,
    scryfallHints: [],
  }))
}

function wizardState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    step: 4,
    maxStepReached: 4,
    seedCard: null,
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
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
    deckName: 'Wizard Deck',
    deckDescription: 'from the wizard',
    chatMessages: [],
    sectionPlan: plan(),
    sectionAssignments: {},
    ...overrides,
  }
}

function localDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Route Deck',
    description: 'from the route',
    cards: [],
    sectionPlan: plan(),
    sectionAssignments: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A `CardChange` row with the quantity bookkeeping filled in. */
function added(scryfallId: string, card?: ScryfallCard): CardChange {
  return { name: `Card ${scryfallId}`, scryfallId, scryfallCard: card, type: 'added', oldQuantity: 0, newQuantity: 1 }
}

function removed(scryfallId: string): CardChange {
  return { name: `Card ${scryfallId}`, scryfallId, type: 'removed', oldQuantity: 1, newQuantity: 0 }
}

function proposal(overrides: Partial<PendingChanges> = {}): PendingChanges {
  return {
    deckName: '',
    description: '',
    changes: [],
    resolvedCards: [],
    ...overrides,
  }
}

/** Records snapshot/undo/redo calls so mutators can be asserted against them. */
function fakeHistory() {
  const calls: string[] = []
  return {
    calls,
    snapshot: () => { calls.push('snapshot') },
    undo: () => { calls.push('undo') },
    redo: () => { calls.push('redo') },
    canUndo: true,
    canRedo: false,
  }
}

const noSections: Record<string, DeckDisplayCard[]> = {}

// ─── Wizard adapter harness ───────────────────────────────────────────────

function wizardSurface(state: WizardState, extra: { lockedCardIds?: Set<string>; editorSections?: DeckSection[] } = {}) {
  const actions: WizardAction[] = []
  const history = fakeHistory()
  const cardData: ScryfallCard[] = []
  const surface = deckSurfaceFromWizard({
    state,
    dispatch: (action) => { actions.push(action) },
    history,
    cards: state.deckCards,
    lockedCardIds: extra.lockedCardIds ?? new Set(state.lockedCardIds),
    plan: state.sectionPlan,
    sections: extra.editorSections,
    sectionCards: noSections,
    cardDataMap: new Map(),
    cardsLoading: false,
    onCardData: (card) => { cardData.push(card) },
  })
  return { surface, actions, history, cardData }
}

// ─── Route adapter harness ────────────────────────────────────────────────

function routeSurface(deck: Deck) {
  const updaters: Array<(prev: Deck | null) => Deck | null> = []
  const history = fakeHistory()
  const names: string[] = []
  const descriptions: string[] = []
  const cardData: ScryfallCard[] = []
  const surface = deckSurfaceFromSavedDeck({
    deck,
    setDeck: (updater) => { updaters.push(updater) },
    history,
    lockedCardIds: new Set(deck.cards.filter((c) => c.locked).map((c) => c.scryfallId)),
    sections: deck.sectionPlan ?? [],
    sectionCards: noSections,
    cardDataMap: new Map(),
    cardsLoading: false,
    onCardData: (card) => { cardData.push(card) },
    name: deck.name,
    description: deck.description ?? '',
    onNameChange: (n) => { names.push(n) },
    onDescriptionChange: (d) => { descriptions.push(d) },
  })
  /** Run every queued updater against `prev`, the way React would. */
  const settle = (prev: Deck | null = deck) =>
    updaters.reduce<Deck | null>((acc, updater) => updater(acc), prev)
  return { surface, updaters, settle, history, names, descriptions, cardData }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe('assignAddedCard', () => {
  it('files a genuinely added card under its best-fit lane', () => {
    const result = assignAddedCard({}, plan(), makeCard('elf'), ['elf'])
    expect(result).toEqual({ sectionId: 'creatures', scryfallIds: ['elf'] })
  })

  it('returns null when the merge rejected the card', () => {
    expect(assignAddedCard({}, plan(), makeCard('elf'), [])).toBeNull()
  })

  it('returns null when there is no plan to file into', () => {
    expect(assignAddedCard({}, [], makeCard('elf'), ['elf'])).toBeNull()
  })

  it('returns null when the lane already holds the card', () => {
    expect(assignAddedCard({ creatures: ['elf'] }, plan(), makeCard('elf'), ['elf'])).toBeNull()
  })

  it('appends to the lane rather than replacing it', () => {
    const result = assignAddedCard({ creatures: ['bear'] }, plan(), makeCard('elf'), ['elf'])
    expect(result).toEqual({ sectionId: 'creatures', scryfallIds: ['bear', 'elf'] })
  })
})

describe('inheritProposalSections', () => {
  it('returns the assignments untouched when the proposal changed nothing', () => {
    const assignments = { creatures: ['elf'] }
    expect(inheritProposalSections(assignments, plan(), proposal(), () => undefined)).toBe(assignments)
  })

  it('returns the assignments untouched when no plan exists', () => {
    const assignments = { creatures: ['elf'] }
    const p = proposal({ changes: [added('bear')] })
    expect(inheritProposalSections(assignments, [], p, () => undefined)).toBe(assignments)
  })

  it('honours targetSection for unpaired adds', () => {
    const p = proposal({
      targetSection: 'interaction',
      changes: [added('bear')],
    })
    const next = inheritProposalSections({}, plan(), p, () => makeCard('bear'))
    expect(next.interaction).toEqual(['bear'])
  })

  it('routes by role when no targetSection was named', () => {
    const p = proposal({ changes: [added('bear')] })
    const next = inheritProposalSections({}, plan(), p, () => makeCard('bear'))
    expect(next.creatures).toEqual(['bear'])
  })
})

// ─── Shared invariants: same behaviour from both containers ───────────────

interface SurfaceCase {
  label: string
  build: () => {
    surface: DeckSurface
    readCards: () => DeckCard[]
    readAssignments: () => Record<string, string[]>
    /** Deck name/description after the container has settled every write. */
    readMetadata: () => { name: string; description: string }
  }
}

const cases: SurfaceCase[] = [{
  label: 'wizard',
  build: () => {
    const state = wizardState({
      deckCards: [deckCard('bear', 2)],
      sectionAssignments: { creatures: ['bear'] },
      deckName: 'Kept',
      deckDescription: 'Kept blurb',
    })
    const h = wizardSurface(state)
    const lastSetDeck = () => {
      const decks = h.actions.filter((a): a is Extract<WizardAction, { type: 'SET_DECK' }> => a.type === 'SET_DECK')
      return decks.length > 0 ? decks[decks.length - 1].cards : state.deckCards
    }
    const assignments = () => {
      const next = { ...state.sectionAssignments }
      for (const a of h.actions) {
        if (a.type === 'ASSIGN_SECTION') next[a.sectionId] = a.scryfallIds
      }
      return next
    }
    // Replay the dispatched actions through the real reducer, so the wizard's
    // metadata answer comes from the reducer's own preserve-on-nullish rule.
    const metadata = () => {
      const next = h.actions.reduce(wizardReducer, state)
      return { name: next.deckName, description: next.deckDescription }
    }
    return { surface: h.surface, readCards: lastSetDeck, readAssignments: assignments, readMetadata: metadata }
  },
}, {
  label: 'route',
  build: () => {
    const deck = localDeck({
      cards: [deckCard('bear', 2)],
      sectionAssignments: { creatures: ['bear'] },
      name: 'Kept',
      description: 'Kept blurb',
    })
    const h = routeSurface(deck)
    return {
      surface: h.surface,
      readCards: () => h.settle()?.cards ?? [],
      readAssignments: () => h.settle()?.sectionAssignments ?? {},
      readMetadata: () => {
        const next = h.settle()
        return { name: next?.name ?? '', description: next?.description ?? '' }
      },
    }
  },
}]

for (const { label, build } of cases) {
  describe(`DeckSurface invariants — ${label}`, () => {
    it('addCard merges the card into the deck', () => {
      const { surface, readCards } = build()
      surface.addCard(makeCard('elf'))
      const cards = readCards()
      expect(cards.find((c) => c.scryfallId === 'elf')?.quantity).toBe(1)
      expect(cards.find((c) => c.scryfallId === 'bear')?.quantity).toBe(2)
    })

    it('addCard files the new card under its best-fit lane', () => {
      const { surface, readAssignments } = build()
      surface.addCard(makeCard('elf'))
      expect(readAssignments().creatures).toEqual(['bear', 'elf'])
    })

    it('changeQuantity rewrites only the named card', () => {
      const { surface, readCards } = build()
      surface.changeQuantity('bear', 4)
      expect(readCards()).toEqual([deckCard('bear', 4)])
    })

    it('removeCard drops the row', () => {
      const { surface, readCards } = build()
      surface.removeCard('bear')
      expect(readCards()).toEqual([])
    })

    it('applyProposal writes the resolved cards', () => {
      const { surface, readCards } = build()
      surface.applyProposal(proposal({ resolvedCards: [deckCard('elf', 3)] }))
      expect(readCards()).toEqual([deckCard('elf', 3)])
    })

    it('applyProposal honours targetSection for unpaired adds', () => {
      const { surface, readAssignments } = build()
      surface.applyProposal(proposal({
        resolvedCards: [deckCard('bear', 2), deckCard('bolt', 1)],
        targetSection: 'interaction',
        changes: [added('bolt', makeCard('bolt', 'Instant'))],
      }))
      expect(readAssignments().interaction).toEqual(['bolt'])
    })

    it('applyProposal keeps the prior name when the proposal carries none', () => {
      // useDeckChat stages a delta with empty name/description meaning "leave
      // them alone". Neither container preserves on '', so the empty string
      // must be normalised away before it reaches either one.
      const { surface, readMetadata } = build()
      surface.applyProposal(proposal({ resolvedCards: [deckCard('elf', 1)] }))
      expect(readMetadata()).toEqual({ name: 'Kept', description: 'Kept blurb' })
    })

    it('applyProposal adopts a renamed deck', () => {
      const { surface, readMetadata } = build()
      surface.applyProposal(proposal({ deckName: 'New', description: 'New blurb', resolvedCards: [] }))
      expect(readMetadata()).toEqual({ name: 'New', description: 'New blurb' })
    })

    it('applyProposal purges a removed card from its lane', () => {
      const { surface, readAssignments } = build()
      surface.applyProposal(proposal({
        resolvedCards: [],
        changes: [removed('bear')],
      }))
      expect(readAssignments().creatures).toEqual([])
    })
  })
}

// ─── Snapshotting: both surfaces make chat-apply undoable ─────────────────

describe('DeckSurface history', () => {
  it('the wizard snapshots before applying a proposal', () => {
    const h = wizardSurface(wizardState({ deckCards: [deckCard('bear', 2)] }))
    h.surface.applyProposal(proposal({ resolvedCards: [deckCard('elf', 1)] }))
    expect(h.history.calls).toContain('snapshot')
  })

  it('the route snapshots before applying a proposal (it did not before #26)', () => {
    const h = routeSurface(localDeck({ cards: [deckCard('bear', 2)] }))
    h.surface.applyProposal(proposal({ resolvedCards: [deckCard('elf', 1)] }))
    expect(h.history.calls).toContain('snapshot')
  })

  it('add / quantity / remove all snapshot on both surfaces', () => {
    for (const build of [() => wizardSurface(wizardState({ deckCards: [deckCard('bear', 2)] })), () => routeSurface(localDeck({ cards: [deckCard('bear', 2)] }))]) {
      const add = build(); add.surface.addCard(makeCard('elf'))
      expect(add.history.calls).toEqual(['snapshot'])
      const qty = build(); qty.surface.changeQuantity('bear', 3)
      expect(qty.history.calls).toEqual(['snapshot'])
      const rm = build(); rm.surface.removeCard('bear')
      expect(rm.history.calls).toEqual(['snapshot'])
    }
  })

  it('exposes the container history verbatim', () => {
    const h = wizardSurface(wizardState())
    h.surface.history.undo()
    h.surface.history.redo()
    expect(h.history.calls).toEqual(['undo', 'redo'])
    expect(h.surface.history.canUndo).toBe(true)
    expect(h.surface.history.canRedo).toBe(false)
  })
})

// ─── Wizard-specific ──────────────────────────────────────────────────────

describe('deckSurfaceFromWizard', () => {
  it('removing a locked card also clears the lock, so re-adding it is unlocked', () => {
    const state = wizardState({
      deckCards: [deckCard('combo', 4)],
      lockedCardIds: ['combo'],
    })
    const h = wizardSurface(state)
    h.surface.removeCard('combo')
    expect(h.actions).toContainEqual({ type: 'TOGGLE_LOCK', scryfallId: 'combo' })
  })

  it('removing an unlocked card leaves the lock list alone', () => {
    const state = wizardState({ deckCards: [deckCard('bear', 2)], lockedCardIds: ['combo'] })
    const h = wizardSurface(state)
    h.surface.removeCard('bear')
    expect(h.actions.some((a) => a.type === 'TOGGLE_LOCK')).toBe(false)
  })

  it('toggleLock dispatches the wizard lock action', () => {
    const h = wizardSurface(wizardState({ deckCards: [deckCard('bear', 2)] }))
    h.surface.toggleLock('bear')
    expect(h.actions).toEqual([{ type: 'TOGGLE_LOCK', scryfallId: 'bear' }])
  })

  it('renders the editor sections when the container supplies a synthetic core lane', () => {
    const core: DeckSection = { id: 'core', label: 'Core', description: '', targetCount: 8, role: 'creatures', scryfallHints: [] }
    const h = wizardSurface(wizardState(), { editorSections: [core, ...plan()] })
    expect(h.surface.sections[0].id).toBe('core')
  })

  it('files new cards into the plan, never into the synthetic core lane', () => {
    const core: DeckSection = { id: 'core', label: 'Core', description: '', targetCount: 8, role: 'creatures', scryfallHints: [] }
    const h = wizardSurface(wizardState(), { editorSections: [core, ...plan()] })
    h.surface.addCard(makeCard('elf'))
    const assign = h.actions.find((a) => a.type === 'ASSIGN_SECTION')
    expect(assign).toEqual({ type: 'ASSIGN_SECTION', sectionId: 'creatures', scryfallIds: ['elf'] })
  })

  it('projects the lock flag onto an applied proposal', () => {
    const state = wizardState({ deckCards: [deckCard('combo', 4)], lockedCardIds: ['combo'] })
    const h = wizardSurface(state)
    h.surface.applyProposal(proposal({ resolvedCards: [deckCard('combo', 4), deckCard('elf', 1)] }))
    const set = h.actions.find((a): a is Extract<WizardAction, { type: 'SET_DECK' }> => a.type === 'SET_DECK')!
    expect(set.cards.find((c) => c.scryfallId === 'combo')?.locked).toBe(true)
  })

  it('carries deck metadata through the proposal', () => {
    const h = wizardSurface(wizardState())
    h.surface.applyProposal(proposal({ deckName: 'Renamed', description: 'New blurb' }))
    const set = h.actions.find((a): a is Extract<WizardAction, { type: 'SET_DECK' }> => a.type === 'SET_DECK')!
    expect(set.name).toBe('Renamed')
    expect(set.description).toBe('New blurb')
  })

  it('setName and setDescription write deck metadata', () => {
    const h = wizardSurface(wizardState())
    h.surface.setName('Named')
    h.surface.setDescription('Described')
    expect(h.actions).toEqual([
      { type: 'SET_DECK_METADATA', name: 'Named' },
      { type: 'SET_DECK_METADATA', description: 'Described' },
    ])
  })

  it('only dispatches ASSIGN_SECTION for lanes an applied proposal actually moved', () => {
    const state = wizardState({
      deckCards: [deckCard('bear', 2)],
      sectionAssignments: { creatures: ['bear'], spells: ['bolt'] },
    })
    const h = wizardSurface(state)
    h.surface.applyProposal(proposal({
      resolvedCards: [deckCard('bear', 2), deckCard('growth', 1)],
      targetSection: 'support',
      changes: [added('growth')],
    }))
    const assigned = h.actions.filter((a) => a.type === 'ASSIGN_SECTION').map((a) => a.sectionId)
    expect(assigned).toEqual(['support'])
  })
})

// ─── Route-specific: every write reads `prev` ─────────────────────────────

describe('deckSurfaceFromSavedDeck — reads prev, never a closure', () => {
  it('addCard merges into the deck React hands it, not the captured one', () => {
    const captured = localDeck({ cards: [] })
    const h = routeSurface(captured)
    h.surface.addCard(makeCard('elf'))
    // Another writer landed a card between the click and the state update.
    const next = h.settle(localDeck({ cards: [deckCard('bear', 2)] }))!
    expect(next.cards.map((c) => c.scryfallId).sort()).toEqual(['bear', 'elf'])
  })

  it('applyProposal inherits against the plan React hands it', () => {
    // The captured deck has no plan at all; a staged re-derive accepted one
    // before the proposal landed. Reading `prev` is what makes the add file —
    // against the closure the empty plan would drop it into unassigned.
    const h = routeSurface(localDeck({ sectionPlan: [], sectionAssignments: {} }))
    h.surface.applyProposal(proposal({
      resolvedCards: [deckCard('bolt', 1)],
      targetSection: 'interaction',
      changes: [added('bolt')],
    }))
    const settled = h.settle(localDeck({ sectionPlan: plan(), sectionAssignments: {} }))!
    expect(settled.sectionAssignments?.interaction).toEqual(['bolt'])
  })

  it('toggleLock flips the row flag and snapshots', () => {
    const h = routeSurface(localDeck({ cards: [deckCard('bear', 2, false)] }))
    h.surface.toggleLock('bear')
    expect(h.settle()!.cards[0].locked).toBe(true)
    expect(h.history.calls).toEqual(['snapshot'])
  })

  it('setName mirrors into both the masthead input and the stored deck', () => {
    const h = routeSurface(localDeck())
    h.surface.setName('Renamed')
    expect(h.names).toEqual(['Renamed'])
    expect(h.settle()!.name).toBe('Renamed')
  })

  it('setDescription mirrors into both the masthead input and the stored deck', () => {
    const h = routeSurface(localDeck())
    h.surface.setDescription('New blurb')
    expect(h.descriptions).toEqual(['New blurb'])
    expect(h.settle()!.description).toBe('New blurb')
  })

  it('applyProposal leaves the masthead input alone when the proposal carries no name', () => {
    const h = routeSurface(localDeck({ name: 'Kept' }))
    h.surface.applyProposal(proposal({ resolvedCards: [] }))
    expect(h.names).toEqual([])
  })

  it('applyProposal mirrors a renamed deck into the masthead input', () => {
    const h = routeSurface(localDeck({ name: 'Old' }))
    h.surface.applyProposal(proposal({ deckName: 'New', description: 'Blurb', resolvedCards: [] }))
    expect(h.names).toEqual(['New'])
    expect(h.descriptions).toEqual(['Blurb'])
    expect(h.settle()!.name).toBe('New')
  })

  it('every mutation stamps updatedAt', () => {
    const h = routeSurface(localDeck({ updatedAt: 1 }))
    h.surface.changeQuantity('bear', 3)
    expect(h.settle()!.updatedAt).toBeGreaterThan(1)
  })
})
