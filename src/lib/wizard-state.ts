import { MANA_COLORS, type ManaColor } from './mana-colors'
import { readJson, storageBackend, writeJson } from './storage/backend'
import { RARITIES } from './rarity'
import type { DeckCard } from './deck-utils'
import type { ScryfallCard } from './scryfall/types'
import type { DeckSection } from './section-plan'

export type ManaColorState = 'selected' | 'unselected' | 'maybe'

export interface CoreCombo {
  name: string
  cards: Array<{ name: string; scryfallId?: string; scryfallCard?: ScryfallCard }>
  explanation: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface WizardState {
  step: 1 | 2 | 3 | 4
  maxStepReached: 1 | 2 | 3 | 4
  /**
   * Optional card that seeds the whole wizard — visible in the stepper,
   * auto-selects its cost colors in step 2, and becomes a hard
   * MUST-INCLUDE constraint in step 3 combo generation. Stored as the
   * full ScryfallCard so the seed lightbox (opened by clicking the
   * anchor) has everything it needs without a re-fetch.
   */
  seedCard: ScryfallCard | null
  // Step 1: Traits & Strategy
  colors: Record<ManaColor, ManaColorState>
  // Step 2: Colors
  selectedArchetypes: string[]
  selectedTraits: string[]
  customStrategy: string
  budgetMin: number | null
  budgetMax: number | null
  rarityFilter: string[]
  // Step 3: Core Cards
  coreCombos: CoreCombo[]
  selectedComboIndex: number | null
  // Step 4: Deck
  deckCards: DeckCard[]
  lockedCardIds: string[]
  deckName: string
  deckDescription: string
  chatMessages: ChatMessage[]
  sectionPlan: DeckSection[]
  sectionAssignments: Record<string, string[]>  // sectionId → scryfallId[]
}

export type WizardAction =
  | { type: 'SET_SEED_CARD'; card: ScryfallCard; costColors: ManaColor[] }
  | { type: 'CLEAR_SEED_CARD' }
  | { type: 'SET_COLOR'; color: ManaColor; state: ManaColorState }
  | { type: 'CLEAR_COLORS' }
  | { type: 'TOGGLE_ARCHETYPE'; traitId: string }
  | { type: 'TOGGLE_TRAIT'; traitId: string }
  | { type: 'SET_CUSTOM_STRATEGY'; text: string }
  | { type: 'SET_BUDGET'; min: number | null; max: number | null }
  | { type: 'SET_RARITY_FILTER'; rarities: string[] }
  | { type: 'SET_CORE_COMBOS'; combos: CoreCombo[] }
  | { type: 'SELECT_COMBO'; index: number }
  | { type: 'SKIP_COMBO' }
  | { type: 'SET_DECK'; cards: DeckCard[]; name?: string; description?: string }
  | { type: 'SET_DECK_METADATA'; name?: string; description?: string }
  | { type: 'TOGGLE_LOCK'; scryfallId: string }
  | { type: 'SET_CHAT_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_SECTION_PLAN'; sections: DeckSection[] }
  | { type: 'ASSIGN_SECTION'; sectionId: string; scryfallIds: string[] }
  | { type: 'CLEAR_SECTION_ASSIGNMENTS' }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: 1 | 2 | 3 | 4 }
  | { type: 'RESET' }

const STORAGE_KEY = 'manaschmiede-wizard'

function defaultState(): WizardState {
  return {
    step: 1,
    maxStepReached: 1,
    seedCard: null,
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    selectedArchetypes: [],
    selectedTraits: [],
    customStrategy: '',
    budgetMin: null,
    budgetMax: null,
    rarityFilter: [...RARITIES],
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

type StoredWizardState = Partial<WizardState> & {
  budgetLimit?: number | null
  /** Retired by the 60-card-casual-only decision; evicted on hydrate. */
  format?: string
}

/** Coerce an arbitrary stored value into a renderable step. */
function clampStep(value: unknown): 1 | 2 | 3 | 4 {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  const n = Math.trunc(value)
  if (n <= 1) return 1
  return (n >= 4 ? 4 : n) as 1 | 2 | 3 | 4
}

/**
 * Pure core of `initialWizardState`: turn an already-parsed storage blob into a
 * WizardState the reducer's own invariants would accept.
 *
 * A plain `{ ...defaultState(), ...parsed }` is not enough, because storage
 * holds whatever an older build (or a hand-edited devtools session) wrote:
 *
 * - `colors` is a fixed five-key record. A stored PARTIAL record replaced it
 *   wholesale, leaving `colors.G` undefined — a hole `getSelectedColors` and
 *   StepColors both read straight through. It is merged over the default now,
 *   as is `sectionAssignments`, whose `null` would crash every consumer.
 * - `format` is a retired key (the app is 60-card casual only). Like
 *   `budgetLimit` it is evicted rather than spread back into WizardState, or
 *   the persist effect would rewrite it on every change forever.
 * - The legacy `budgetLimit` key only migrated when `budgetMax` was ABSENT, so
 *   a state carrying both spread the legacy key into WizardState, where the
 *   persist effect wrote it back on every change — forever. It is now always
 *   evicted; `budgetMax` wins when present.
 * - `step` is typed `1 | 2 | 3 | 4` but nothing enforced it, and a stored 7
 *   renders no step content at all. Both step fields are clamped.
 * - `maxStepReached` below `step` is reconciled up, or the stepper would refuse
 *   to navigate back to the step the user is standing on.
 *
 * Extracted so it can be tested without going through the storage backend.
 */
export function hydrateWizardState(parsed: unknown): WizardState {
  const base = defaultState()
  if (!parsed || typeof parsed !== 'object') return base

  const { budgetLimit, format: _retiredFormat, colors, sectionAssignments, step, maxStepReached, ...rest } =
    parsed as StoredWizardState
  const merged: WizardState = {
    ...base,
    ...rest,
    colors: { ...base.colors, ...(colors ?? {}) },
    sectionAssignments: { ...base.sectionAssignments, ...(sectionAssignments ?? {}) },
    step: clampStep(step),
    maxStepReached: clampStep(maxStepReached),
  }
  // The legacy key fills budgetMax only when the modern one never made it in.
  // `'budgetMax' in parsed` (not `!== undefined`) so an explicit null counts as
  // a real value and doesn't get overwritten by the legacy one.
  if (budgetLimit !== undefined && !('budgetMax' in (parsed as object))) {
    merged.budgetMax = budgetLimit
  }
  if (merged.maxStepReached < merged.step) merged.maxStepReached = merged.step
  // `-1` here is the retired skip sentinel, and nothing guarantees any other
  // persisted index still points at a live combo. Everything out of range
  // collapses, leaving exactly one shape for "no combo chosen" in play — which
  // is what StepCoreCards' `== null` NEXT guard reads.
  const comboIndex = merged.selectedComboIndex
  if (comboIndex != null && (comboIndex < 0 || comboIndex >= merged.coreCombos.length)) {
    merged.selectedComboIndex = null
  }
  return merged
}

export function initialWizardState(): WizardState {
  return hydrateWizardState(readJson<unknown>(storageBackend(), STORAGE_KEY, null))
}

export function persistWizardState(state: WizardState): void {
  writeJson(storageBackend(), STORAGE_KEY, state)
}

export function clearWizardState(): void {
  storageBackend().delete(STORAGE_KEY)
  storageBackend().delete(AUX_STORAGE_KEY)
}

/**
 * Start the wizard over. `RESET` is a pure reducer case and structurally cannot
 * reach storage, so a `RESET` on its own leaves the aux slot behind and
 * resurrects the previous session's combo history and 30-deep undo stack. The
 * two belong together; this is the only pairing that guarantees it.
 */
export function resetWizard(dispatch: (action: WizardAction) => void): void {
  dispatch({ type: 'RESET' })
  clearWizardAux()
}

// ─── Auxiliary wizard state (combo history, undo/redo, fingerprints) ───

const AUX_STORAGE_KEY = 'manaschmiede-wizard-aux'

export interface WizardAuxState {
  comboFingerprint: string
  comboHistory: CoreCombo[][]
  historyIndex: number
  comboBuffer: CoreCombo[]
  previouslyRejected: Array<{ name: string; reason: string }>
  deckHistoryPast: DeckCard[][]
  deckHistoryFuture: DeckCard[][]
}

const defaultAux: WizardAuxState = {
  comboFingerprint: '',
  comboHistory: [],
  historyIndex: 0,
  comboBuffer: [],
  previouslyRejected: [],
  deckHistoryPast: [],
  deckHistoryFuture: [],
}

export function loadWizardAux(): WizardAuxState {
  const stored = readJson<Partial<WizardAuxState>>(storageBackend(), AUX_STORAGE_KEY, {})
  return { ...defaultAux, ...stored }
}

export function persistWizardAux(aux: Partial<WizardAuxState>): void {
  writeJson(storageBackend(), AUX_STORAGE_KEY, { ...loadWizardAux(), ...aux })
}

export function clearWizardAux(): void {
  storageBackend().delete(AUX_STORAGE_KEY)
}

export function getSelectedColors(colors: Record<ManaColor, ManaColorState>): ManaColor[] {
  return (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, state]) => state === 'selected')
    .map(([color]) => color)
}

export function getMaybeColors(colors: Record<ManaColor, ManaColorState>): ManaColor[] {
  return (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, state]) => state === 'maybe')
    .map(([color]) => color)
}

export function getActiveColors(colors: Record<ManaColor, ManaColorState>): ManaColor[] {
  return (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, state]) => state !== 'unselected')
    .map(([color]) => color)
}

/**
 * The combo the user picked, or null. One reading of `selectedComboIndex` for
 * everyone: the index is a bare `number | null` and nothing guarantees it still
 * points at a live combo, so every consumer has to range-check. Four call sites
 * had drifted into four spellings of that check.
 */
export function getSelectedCombo(state: WizardState): CoreCombo | null {
  const index = state.selectedComboIndex
  if (index == null) return null
  return state.coreCombos[index] ?? null
}

export interface FillColorsResult {
  /** Ready = every source of truth is resolved; fill can proceed. */
  ready: boolean
  /** Final hard color identity for fill. Undefined when !ready. */
  colors?: ManaColor[]
}

/**
 * Compute the hard color-identity constraint for the deck-fill phase.
 *
 * Rules:
 *   - Selected colors are always included (user-committed floor).
 *   - Maybe colors are included only if the chosen combo's cards actually
 *     use them — unused maybes drop out.
 *   - Without a chosen combo (null, or an index out of range),
 *     maybes drop entirely and only selected colors remain.
 *   - If the chosen combo contains any card whose Scryfall data hasn't
 *     resolved yet, returns `{ ready: false }` so the caller can block
 *     the fill and retry — we can't compute color identity without it.
 */
export function getFillColors(state: WizardState): FillColorsResult {
  const selected = getSelectedColors(state.colors)
  const combo = getSelectedCombo(state)

  if (!combo) {
    return { ready: true, colors: selected }
  }

  // Every card must be resolved — its color_identity is the source of truth.
  for (const card of combo.cards) {
    if (!card.scryfallCard) return { ready: false }
  }

  const union = new Set<ManaColor>(selected)
  for (const card of combo.cards) {
    for (const c of card.scryfallCard!.color_identity) {
      union.add(c as ManaColor)
    }
  }
  return { ready: true, colors: MANA_COLORS.filter((c) => union.has(c)) }
}

function withMaxStep(state: WizardState): WizardState {
  if (state.step > state.maxStepReached) {
    return { ...state, maxStepReached: state.step }
  }
  return state
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_SEED_CARD': {
      // Auto-select every color in the seed card's cost. Existing
      // selections are preserved — we only *upgrade* unselected/maybe
      // colors to 'selected', never demote. Colorless seed cards
      // (empty costColors) leave the color picker untouched.
      const nextColors = { ...state.colors }
      for (const c of action.costColors) {
        if (nextColors[c] !== 'selected') nextColors[c] = 'selected'
      }
      return { ...state, seedCard: action.card, colors: nextColors }
    }

    case 'CLEAR_SEED_CARD':
      // Only drop the seed itself — whatever colors the user ended up
      // with stay as-is. They may have adjusted them after seeding.
      return { ...state, seedCard: null }

    case 'SET_COLOR':
      return { ...state, colors: { ...state.colors, [action.color]: action.state } }

    case 'CLEAR_COLORS':
      return {
        ...state,
        colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
      }

    case 'TOGGLE_ARCHETYPE': {
      const has = state.selectedArchetypes.includes(action.traitId)
      if (has) {
        return { ...state, selectedArchetypes: state.selectedArchetypes.filter((id) => id !== action.traitId) }
      }
      if (state.selectedArchetypes.length >= 3) return state
      return { ...state, selectedArchetypes: [...state.selectedArchetypes, action.traitId] }
    }

    case 'TOGGLE_TRAIT': {
      const has = state.selectedTraits.includes(action.traitId)
      return {
        ...state,
        selectedTraits: has
          ? state.selectedTraits.filter((id) => id !== action.traitId)
          : [...state.selectedTraits, action.traitId],
      }
    }

    case 'SET_CUSTOM_STRATEGY':
      return { ...state, customStrategy: action.text }

    case 'SET_BUDGET':
      return { ...state, budgetMin: action.min, budgetMax: action.max }

    case 'SET_RARITY_FILTER':
      return { ...state, rarityFilter: action.rarities }

    case 'SET_CORE_COMBOS':
      return { ...state, coreCombos: action.combos, selectedComboIndex: null }

    case 'SELECT_COMBO': {
      // Range guard first. Without it an index with no combo behind it fell
      // through to `combo?.name ?? ''`, wiping a deckName the user had typed —
      // and, with a populated deck, the deck itself. There is nothing sensible
      // to select at an index that holds no combo, so the action is a no-op.
      if (action.index < 0 || action.index >= state.coreCombos.length) return state

      // When switching to a different combo while a deck is already
      // populated (e.g. navigating back from step 4 to re-pick), clear
      // downstream deck state so step 4 re-seeds from the new combo's
      // core cards instead of leaving stale cards behind.
      //
      // We also seed deckName/deckDescription from the combo so the save
      // path has real values instead of the archetype-based fallback.
      // Picking a different combo always overrides metadata — the user
      // is making a new strategy choice, so treating metadata as downstream
      // state is consistent with how deckCards are reset.
      // Re-clicking the current combo changes nothing — return the same object
      // rather than a fresh one, as SKIP_COMBO does, so no `state`-dep memo
      // downstream re-runs for a no-op.
      if (state.selectedComboIndex === action.index) return state
      const combo = state.coreCombos[action.index]
      const withMeta = {
        ...state,
        selectedComboIndex: action.index,
        deckName: combo?.name ?? '',
        deckDescription: combo?.explanation ?? '',
      }
      if (state.deckCards.length > 0) {
        return {
          ...withMeta,
          deckCards: [],
          sectionAssignments: {},
          sectionPlan: [],
          lockedCardIds: [],
        }
      }
      return withMeta
    }

    case 'SKIP_COMBO':
      // Skipping is the ABSENCE of a strategy choice, not a new one — so unlike
      // SELECT_COMBO it must never touch deckName / deckDescription / deckCards
      // / sectionPlan / sectionAssignments / lockedCardIds. It replaced a
      // `SELECT_COMBO` with a `-1` sentinel, which carried no information every
      // consumer didn't already read off `null`, and which fell through
      // SELECT_COMBO's downstream clear.
      return state.selectedComboIndex === null ? state : { ...state, selectedComboIndex: null }

    case 'SET_DECK':
      return {
        ...state,
        deckCards: action.cards,
        deckName: action.name ?? state.deckName,
        deckDescription: action.description ?? state.deckDescription,
      }

    case 'SET_DECK_METADATA':
      return {
        ...state,
        deckName: action.name ?? state.deckName,
        deckDescription: action.description ?? state.deckDescription,
      }

    case 'TOGGLE_LOCK': {
      const has = state.lockedCardIds.includes(action.scryfallId)
      return {
        ...state,
        lockedCardIds: has
          ? state.lockedCardIds.filter((id) => id !== action.scryfallId)
          : [...state.lockedCardIds, action.scryfallId],
      }
    }

    case 'SET_CHAT_MESSAGES':
      return { ...state, chatMessages: action.messages }

    case 'SET_SECTION_PLAN':
      return { ...state, sectionPlan: action.sections }

    case 'ASSIGN_SECTION': {
      return {
        ...state,
        sectionAssignments: {
          ...state.sectionAssignments,
          [action.sectionId]: action.scryfallIds,
        },
      }
    }

    case 'CLEAR_SECTION_ASSIGNMENTS':
      return { ...state, sectionAssignments: {} }

    case 'NEXT_STEP': {
      if (state.step >= 4) return state
      const next = { ...state, step: (state.step + 1) as 1 | 2 | 3 | 4 }
      return withMaxStep(next)
    }

    case 'PREV_STEP':
      return state.step > 1 ? { ...state, step: (state.step - 1) as 1 | 2 | 3 | 4 } : state

    case 'GO_TO_STEP': {
      // Allow navigating to any step up to maxStepReached
      if (action.step > state.maxStepReached) return state
      return { ...state, step: action.step }
    }

    case 'RESET':
      return defaultState()
  }
}

/**
 * Has the user made *any* meaningful choice that would be lost if the
 * wizard were reset right now? Used to decide whether seeding via a URL
 * param should silently overwrite state or show a confirmation modal.
 *
 * `maxStepReached`, `step`, and `seedCard` itself are intentionally
 * ignored — they're navigation/routing state, not user work.
 */
export function isWizardStateDirty(state: WizardState): boolean {
  if (state.selectedArchetypes.length > 0) return true
  if (state.selectedTraits.length > 0) return true
  if (state.customStrategy.trim() !== '') return true
  if (state.budgetMin != null || state.budgetMax != null) return true
  // Any color touched counts.
  for (const v of Object.values(state.colors)) {
    if (v !== 'unselected') return true
  }
  if (state.coreCombos.length > 0) return true
  if (state.deckCards.length > 0) return true
  return false
}
