import type { ManaColor } from '../components/ManaSymbol'
import type { DeckCard, DeckFormat } from './deck-utils'
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
  format: DeckFormat
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
  | { type: 'SET_FORMAT'; format: DeckFormat }
  | { type: 'TOGGLE_ARCHETYPE'; traitId: string }
  | { type: 'TOGGLE_TRAIT'; traitId: string }
  | { type: 'SET_CUSTOM_STRATEGY'; text: string }
  | { type: 'SET_BUDGET'; min: number | null; max: number | null }
  | { type: 'SET_RARITY_FILTER'; rarities: string[] }
  | { type: 'SET_CORE_COMBOS'; combos: CoreCombo[] }
  | { type: 'SELECT_COMBO'; index: number }
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

export function initialWizardState(): WizardState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<WizardState> & {
        budgetLimit?: number | null
      }
      // Migrate legacy single-value budgetLimit → budgetMax
      if (parsed.budgetLimit !== undefined && parsed.budgetMax === undefined) {
        parsed.budgetMax = parsed.budgetLimit
        delete parsed.budgetLimit
      }
      return { ...defaultState(), ...parsed }
    }
  } catch {
    // Corrupted storage, start fresh
  }
  return defaultState()
}

export function persistWizardState(state: WizardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable
  }
}

export function clearWizardState(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(AUX_STORAGE_KEY)
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
  try {
    const stored = localStorage.getItem(AUX_STORAGE_KEY)
    if (stored) return { ...defaultAux, ...JSON.parse(stored) }
  } catch { /* corrupted */ }
  return { ...defaultAux }
}

export function persistWizardAux(aux: Partial<WizardAuxState>): void {
  try {
    const current = loadWizardAux()
    localStorage.setItem(AUX_STORAGE_KEY, JSON.stringify({ ...current, ...aux }))
  } catch { /* storage full */ }
}

export function clearWizardAux(): void {
  localStorage.removeItem(AUX_STORAGE_KEY)
}

const MANA_COLOR_ORDER: ManaColor[] = ['W', 'U', 'B', 'R', 'G']

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
 *   - Without a chosen combo (null, -1/skip, or index out of range),
 *     maybes drop entirely and only selected colors remain.
 *   - If the chosen combo contains any card whose Scryfall data hasn't
 *     resolved yet, returns `{ ready: false }` so the caller can block
 *     the fill and retry — we can't compute color identity without it.
 */
export function getFillColors(state: WizardState): FillColorsResult {
  const selected = getSelectedColors(state.colors)
  const index = state.selectedComboIndex
  const combo =
    index != null && index >= 0 ? state.coreCombos[index] : undefined

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
  return { ready: true, colors: MANA_COLOR_ORDER.filter((c) => union.has(c)) }
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

    case 'SET_FORMAT':
      return { ...state, format: action.format }

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
      const changed = state.selectedComboIndex !== action.index
      if (!changed) return { ...state, selectedComboIndex: action.index }
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
  if (state.format !== 'casual') return true
  // Any color touched counts.
  for (const v of Object.values(state.colors)) {
    if (v !== 'unselected') return true
  }
  if (state.coreCombos.length > 0) return true
  if (state.deckCards.length > 0) return true
  return false
}
