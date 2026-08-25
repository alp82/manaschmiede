import { isBasicLandId } from '../../convex/lib/basicLands'
import type { DeckCard, DeckDisplayCard } from './deck-utils'
import { mergeCardsIntoDeck, projectLocked } from './deck-utils'
import type { LocalDeck } from './deck-storage'
import type { DeckSection } from './section-plan'
import { pickSectionForCard } from './section-plan'
import { applySectionInheritance } from './section-assignment'
import type { ScryfallCard } from './scryfall/types'
import type { PendingChanges } from './useDeckChat'
import type { WizardState, WizardAction } from './wizard-state'

/**
 * One editing surface, two containers.
 *
 * The wizard's fill step and the deck route render the same editor against two
 * different state containers — `WizardState` via `dispatch`, `LocalDeck` via
 * `setDeck`. Before this module each wrote the mutators separately and they
 * drifted (issue #26). `DeckSurface` is the seam; `deckSurfaceFromWizard`
 * and `deckSurfaceFromLocalDeck` are its two adapters, the same shape
 * `section-fill-intent.ts` already uses for section fill.
 *
 * Two things stay out on purpose:
 *
 * - **Zone.** Every write in both containers targets `'main'`
 *   (`mergeCardsIntoDeck` hardcodes it, `useDeckDisplay` filters on it), so the
 *   surface is zone-free and the zone adapters that used to convert in opposite
 *   directions are gone.
 * - **Everything each container owns alone.** Section fill, the synthetic
 *   `core` lane and the search suffix stay in the wizard; staged re-derive,
 *   autosave, colour derivation and the PDF stay in the route.
 *
 * The adapters are plain functions over already-computed values, not hooks, so
 * every mutator is drivable from a node test with a fake `dispatch` /
 * `setDeck`. No method reads `this` — callers detach them freely (DeckEditor
 * destructures them, the card list is handed them one at a time), so keep it
 * that way.
 */

export interface DeckSurfaceHistory {
  undo(): void
  redo(): void
  readonly canUndo: boolean
  readonly canRedo: boolean
}

/** A container history that mutators can also snapshot into. */
interface WritableHistory extends DeckSurfaceHistory {
  snapshot(): void
}

export interface DeckSurface {
  /** Deck rows as the editor renders them — locked flags already projected. */
  readonly cards: DeckCard[]
  /** Ordered, localized lanes to render. */
  readonly sections: DeckSection[]
  /** Bucketed display cards keyed by lane id. */
  readonly sectionCards: Record<string, DeckDisplayCard[]>
  readonly lockedCardIds: Set<string>
  readonly cardDataMap: Map<string, ScryfallCard>
  readonly cardsLoading: boolean

  addCard(card: ScryfallCard): void
  changeQuantity(scryfallId: string, quantity: number): void
  removeCard(scryfallId: string): void
  toggleLock(scryfallId: string): void
  /** Commit a staged chat / re-fill / combo proposal, sections included. */
  applyProposal(proposal: PendingChanges): void

  /**
   * Undo/redo as the container implements it. Storage is deliberately NOT
   * unified: the wizard persists its stacks, the route keeps them in memory.
   */
  readonly history: DeckSurfaceHistory
  readonly name: string
  readonly description: string
  setName(name: string): void
  setDescription(description: string): void
}

// ─── Pure rules both adapters share ──────────────────────────────────────

/**
 * Where a freshly added card should be filed, or `null` when nothing should
 * change: the merge rejected the card (already at four copies, or locked),
 * there is no plan to file into, no lane fits, or the lane already holds it.
 *
 * Returns the lane's whole new id list, not just the added id, because both
 * containers replace a lane's list wholesale — the same trap `mergeSectionFill`
 * exists to close.
 */
export function assignAddedCard(
  assignments: Record<string, string[]>,
  plan: DeckSection[],
  card: ScryfallCard,
  addedIds: string[],
): { sectionId: string; scryfallIds: string[] } | null {
  if (!addedIds.includes(card.id) || plan.length === 0) return null
  const sectionId = pickSectionForCard(card, plan)
  if (!sectionId) return null
  const current = assignments[sectionId] ?? []
  if (current.includes(card.id)) return null
  return { sectionId, scryfallIds: [...current, card.id] }
}

/**
 * Section assignments after an applied proposal: a swap's added card inherits
 * the removed card's lane, removed ids are purged, and remaining adds go to
 * `proposal.targetSection` when the caller named one (a lane re-fill or a
 * "Top up (+N)") or else are routed by role.
 *
 * Returns `assignments` unchanged — the same reference — when there is nothing
 * to inherit. An empty plan matters: `applySectionInheritance` against no lanes
 * would drop every add into unassigned, so the prior filing is the correct
 * no-plan fallback.
 */
export function inheritProposalSections(
  assignments: Record<string, string[]>,
  plan: DeckSection[],
  proposal: PendingChanges,
  resolveCard: (id: string) => ScryfallCard | undefined,
): Record<string, string[]> {
  if (proposal.changes.length === 0 || plan.length === 0) return assignments
  return applySectionInheritance(assignments, proposal.changes, {
    targetSection: proposal.targetSection,
    resolveCard,
    sections: plan,
  })
}

/**
 * The name and description an applied proposal should leave behind, or
 * `undefined` for either the caller must keep as it was.
 *
 * `useDeckChat` stages a delta with empty strings, meaning "leave them alone".
 * Both containers preserve on a nullish value and neither preserves on `''` —
 * the wizard reducer's `action.name ?? state.deckName` used to blank the deck
 * name on every delta apply because of it. Normalising here is what stops the
 * two adapters disagreeing again.
 */
function proposalMetadata(proposal: PendingChanges): {
  name: string | undefined
  description: string | undefined
} {
  return {
    name: proposal.deckName || undefined,
    description: proposal.description || undefined,
  }
}

// ─── Wizard adapter ──────────────────────────────────────────────────────

export interface WizardDeckSurfaceInput {
  state: WizardState
  dispatch: (action: WizardAction) => void
  history: WritableHistory
  /** Locked-projected deck rows — what the editor renders. */
  cards: DeckCard[]
  lockedCardIds: Set<string>
  /** The real section plan: what routing and inheritance file cards into. */
  plan: DeckSection[]
  /**
   * What the editor renders, when it differs from the plan — the wizard
   * prepends a synthetic `core` lane. Cards are never filed into it.
   * Defaults to `plan`.
   */
  sections?: DeckSection[]
  sectionCards: Record<string, DeckDisplayCard[]>
  cardDataMap: Map<string, ScryfallCard>
  cardsLoading: boolean
  onCardData: (card: ScryfallCard) => void
}

/** Adapt live `WizardState` + `dispatch` into a DeckSurface. */
export function deckSurfaceFromWizard(input: WizardDeckSurfaceInput): DeckSurface {
  const { state, dispatch, history, plan, lockedCardIds, cardDataMap } = input

  /** Dispatch only the lanes an inheritance pass actually moved. */
  const assignChanged = (next: Record<string, string[]>) => {
    for (const [sectionId, ids] of Object.entries(next)) {
      const before = state.sectionAssignments[sectionId] ?? []
      if (before.length === ids.length && before.every((id, i) => ids[i] === id)) continue
      dispatch({ type: 'ASSIGN_SECTION', sectionId, scryfallIds: ids })
    }
  }

  return {
    cards: input.cards,
    sections: input.sections ?? plan,
    sectionCards: input.sectionCards,
    lockedCardIds,
    cardDataMap,
    cardsLoading: input.cardsLoading,
    history,
    name: state.deckName,
    description: state.deckDescription,

    setName: (name) => dispatch({ type: 'SET_DECK_METADATA', name }),
    setDescription: (description) => dispatch({ type: 'SET_DECK_METADATA', description }),

    addCard(card) {
      history.snapshot()
      input.onCardData(card)
      const { merged, addedIds } = mergeCardsIntoDeck(
        projectLocked(state.deckCards, lockedCardIds),
        [{ scryfallId: card.id, quantity: 1 }],
        isBasicLandId,
      )
      dispatch({ type: 'SET_DECK', cards: merged })
      const assignment = assignAddedCard(state.sectionAssignments, plan, card, addedIds)
      if (assignment) {
        dispatch({ type: 'ASSIGN_SECTION', sectionId: assignment.sectionId, scryfallIds: assignment.scryfallIds })
      }
    },

    changeQuantity(scryfallId, quantity) {
      history.snapshot()
      dispatch({
        type: 'SET_DECK',
        cards: state.deckCards.map((c) => (c.scryfallId === scryfallId ? { ...c, quantity } : c)),
      })
    },

    removeCard(scryfallId) {
      history.snapshot()
      dispatch({ type: 'SET_DECK', cards: state.deckCards.filter((c) => c.scryfallId !== scryfallId) })
      // The wizard keeps lock state in its own id array rather than on the deck
      // row, so dropping the row is not enough: the stale id made a re-added
      // card come back locked (issue #26). The deck route gets this for free.
      if (state.lockedCardIds.includes(scryfallId)) {
        dispatch({ type: 'TOGGLE_LOCK', scryfallId })
      }
    },

    toggleLock(scryfallId) {
      // No snapshot: the wizard's lock lives outside deckCards, so an undo
      // could not restore it. Making wizard locks undoable changes what a
      // snapshot means and is its own decision (issue #26).
      dispatch({ type: 'TOGGLE_LOCK', scryfallId })
    },

    applyProposal(proposal) {
      history.snapshot()
      // Reads state.sectionAssignments from this render's closure, which the
      // route deliberately does not do. Safe here and only here: the wizard has
      // no second writer racing this one, and each ASSIGN_SECTION carries a
      // whole lane list rather than a delta, so the dispatches below commute.
      assignChanged(
        inheritProposalSections(state.sectionAssignments, plan, proposal, (id) => cardDataMap.get(id)),
      )
      const { name, description } = proposalMetadata(proposal)
      dispatch({
        type: 'SET_DECK',
        cards: projectLocked(proposal.resolvedCards, lockedCardIds),
        name,
        description,
      })
    },
  }
}

// ─── Local-deck adapter ──────────────────────────────────────────────────

export interface LocalDeckSurfaceInput {
  /** Null while the deck is still loading; every mutator then no-ops. */
  deck: LocalDeck | null
  setDeck: (updater: (prev: LocalDeck | null) => LocalDeck | null) => void
  history: WritableHistory
  lockedCardIds: Set<string>
  /** Localized lanes to render — a staged plan when one is staged. */
  sections: DeckSection[]
  sectionCards: Record<string, DeckDisplayCard[]>
  cardDataMap: Map<string, ScryfallCard>
  cardsLoading: boolean
  onCardData: (card: ScryfallCard) => void
  name: string
  description: string
  /** Mirrors for the masthead inputs, which hold their own React state. */
  onNameChange: (name: string) => void
  onDescriptionChange: (description: string) => void
}

/**
 * Adapt a persisted `LocalDeck` + `setDeck` into a DeckSurface.
 *
 * Every mutator writes functionally and reads `prev` for the deck, its plan and
 * its assignments. `useStagedRederive` is the other writer of `sectionPlan` /
 * `sectionAssignments` and it also writes functionally, so a mutator that read
 * either from a closure could silently undo an accepted plan.
 */
export function deckSurfaceFromLocalDeck(input: LocalDeckSurfaceInput): DeckSurface {
  const { deck, setDeck, history, cardDataMap } = input

  const touch = (prev: LocalDeck, next: Partial<LocalDeck>): LocalDeck => ({
    ...prev,
    ...next,
    updatedAt: Date.now(),
  })

  return {
    cards: deck?.cards ?? [],
    sections: input.sections,
    sectionCards: input.sectionCards,
    lockedCardIds: input.lockedCardIds,
    cardDataMap,
    cardsLoading: input.cardsLoading,
    history,
    name: input.name,
    description: input.description,

    setName(name) {
      input.onNameChange(name)
      setDeck((prev) => (prev ? touch(prev, { name }) : prev))
    },

    setDescription(description) {
      input.onDescriptionChange(description)
      setDeck((prev) => (prev ? touch(prev, { description }) : prev))
    },

    addCard(card) {
      history.snapshot()
      input.onCardData(card)
      setDeck((prev) => {
        if (!prev) return prev
        const { merged, addedIds } = mergeCardsIntoDeck(
          prev.cards,
          [{ scryfallId: card.id, quantity: 1 }],
          isBasicLandId,
        )
        const assignment = assignAddedCard(
          prev.sectionAssignments ?? {},
          prev.sectionPlan ?? [],
          card,
          addedIds,
        )
        const sectionAssignments = assignment
          ? { ...prev.sectionAssignments, [assignment.sectionId]: assignment.scryfallIds }
          : prev.sectionAssignments
        return touch(prev, { cards: merged, sectionAssignments })
      })
    },

    changeQuantity(scryfallId, quantity) {
      history.snapshot()
      setDeck((prev) => {
        if (!prev) return prev
        return touch(prev, {
          cards: prev.cards.map((c) => (c.scryfallId === scryfallId ? { ...c, quantity } : c)),
        })
      })
    },

    removeCard(scryfallId) {
      history.snapshot()
      setDeck((prev) => {
        if (!prev) return prev
        return touch(prev, { cards: prev.cards.filter((c) => c.scryfallId !== scryfallId) })
      })
    },

    toggleLock(scryfallId) {
      history.snapshot()
      setDeck((prev) => {
        if (!prev) return prev
        return touch(prev, {
          cards: prev.cards.map((c) => (c.scryfallId === scryfallId ? { ...c, locked: !c.locked } : c)),
        })
      })
    },

    applyProposal(proposal) {
      // The route took no snapshot here, so an applied chat proposal was the
      // one edit the user could not undo (issue #26).
      history.snapshot()
      const { name, description } = proposalMetadata(proposal)
      setDeck((prev) => {
        if (!prev) return prev
        return touch(prev, {
          cards: proposal.resolvedCards,
          sectionAssignments: inheritProposalSections(
            prev.sectionAssignments ?? {},
            prev.sectionPlan ?? [],
            proposal,
            (id) => cardDataMap.get(id),
          ),
          name: name ?? prev.name,
          description: description ?? prev.description,
        })
      })
      if (name) input.onNameChange(name)
      if (description) input.onDescriptionChange(description)
    },
  }
}
