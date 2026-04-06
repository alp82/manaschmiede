import type { ManaColor } from '../components/ManaSymbol'
import type { DeckCard, DeckFormat } from './deck-utils'
import type { ScryfallCard } from './scryfall/types'

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
  // Step 1: Traits & Strategy
  colors: Record<ManaColor, ManaColorState>
  format: DeckFormat
  // Step 2: Colors
  selectedArchetypes: string[]
  selectedTraits: string[]
  customStrategy: string
  budgetLimit: number | null
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
}

export type WizardAction =
  | { type: 'SET_COLOR'; color: ManaColor; state: ManaColorState }
  | { type: 'CLEAR_COLORS' }
  | { type: 'SET_FORMAT'; format: DeckFormat }
  | { type: 'TOGGLE_ARCHETYPE'; traitId: string }
  | { type: 'TOGGLE_TRAIT'; traitId: string }
  | { type: 'SET_CUSTOM_STRATEGY'; text: string }
  | { type: 'SET_BUDGET'; limit: number | null }
  | { type: 'SET_RARITY_FILTER'; rarities: string[] }
  | { type: 'SET_CORE_COMBOS'; combos: CoreCombo[] }
  | { type: 'SELECT_COMBO'; index: number }
  | { type: 'SET_DECK'; cards: DeckCard[]; name?: string; description?: string }
  | { type: 'TOGGLE_LOCK'; scryfallId: string }
  | { type: 'SET_CHAT_MESSAGES'; messages: ChatMessage[] }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: 1 | 2 | 3 | 4 }
  | { type: 'RESET' }

const STORAGE_KEY = 'manaschmiede-wizard'

function defaultState(): WizardState {
  return {
    step: 1,
    maxStepReached: 1,
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    format: 'casual',
    selectedArchetypes: [],
    selectedTraits: [],
    customStrategy: '',
    budgetLimit: null,
    rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
    coreCombos: [],
    selectedComboIndex: null,
    deckCards: [],
    lockedCardIds: [],
    deckName: '',
    deckDescription: '',
    chatMessages: [],
  }
}

export function initialWizardState(): WizardState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
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
}

export function getSelectedColors(colors: Record<ManaColor, ManaColorState>): ManaColor[] {
  return (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, state]) => state === 'selected')
    .map(([color]) => color)
}

export function getActiveColors(colors: Record<ManaColor, ManaColorState>): ManaColor[] {
  return (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, state]) => state !== 'unselected')
    .map(([color]) => color)
}

function withMaxStep(state: WizardState): WizardState {
  if (state.step > state.maxStepReached) {
    return { ...state, maxStepReached: state.step }
  }
  return state
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
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
      if (state.selectedArchetypes.length >= 2) return state
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
      return { ...state, budgetLimit: action.limit }

    case 'SET_RARITY_FILTER':
      return { ...state, rarityFilter: action.rarities }

    case 'SET_CORE_COMBOS':
      return { ...state, coreCombos: action.combos, selectedComboIndex: null }

    case 'SELECT_COMBO':
      return { ...state, selectedComboIndex: action.index }

    case 'SET_DECK':
      return {
        ...state,
        deckCards: action.cards,
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
