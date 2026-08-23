import type { ManaColor } from '../components/ManaSymbol'
import type { DeckFormat } from './deck-utils'
import type { WizardState } from './wizard-state'
import { getFillColors } from './wizard-state'
import type { DeckIntent } from './deck-intent'
import { committedColors } from './deck-intent'

/**
 * The strategy/identity inputs section-fill needs, decoupled from where they
 * come from. The wizard reads them off live WizardState; the deck editor reads
 * them off a persisted DeckIntent. `format` is RAW — the `!== 'casual'` strip
 * lives in callFillSection, not here.
 */
export interface SectionFillIntent {
  selectedArchetypes: string[]
  selectedTraits: string[]
  customStrategy: string
  format: DeckFormat
  budgetMin: number | null
  budgetMax: number | null
  rarityFilter: string[]
  sectionAssignments: Record<string, string[]> | undefined
  /**
   * Resolve the fill-phase color identity. `ready: false` means a source of
   * truth hasn't resolved yet (combo card data still loading, or the deck's
   * card data hasn't arrived) — callers must block fill in that case.
   */
  getFillColors(): { ready: boolean; colors?: ManaColor[] }
}

/** Adapt live WizardState into a SectionFillIntent. */
export function sectionFillIntentFromWizard(state: WizardState): SectionFillIntent {
  return {
    selectedArchetypes: state.selectedArchetypes,
    selectedTraits: state.selectedTraits,
    customStrategy: state.customStrategy,
    format: state.format,
    budgetMin: state.budgetMin,
    budgetMax: state.budgetMax,
    rarityFilter: state.rarityFilter,
    sectionAssignments: state.sectionAssignments,
    getFillColors: () => getFillColors(state),
  }
}

/**
 * Adapt a persisted DeckIntent into a SectionFillIntent. The app is 60-card
 * casual-only, so `format` is the constant `'casual'`; DeckIntent carries no
 * section assignments. Color identity comes from the committed intent colors,
 * falling back to the deck's card-derived union; fill is blocked only when both
 * are empty.
 */
export function sectionFillIntentFromDeck(
  intent: DeckIntent,
  fallbackColors: ManaColor[],
): SectionFillIntent {
  return {
    selectedArchetypes: intent.archetypes,
    selectedTraits: intent.traits,
    customStrategy: intent.customStrategy,
    format: 'casual',
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarityFilter: intent.rarityFilter,
    sectionAssignments: undefined,
    getFillColors: () => {
      const committed = committedColors(intent)
      if (committed.length === 0 && fallbackColors.length === 0) {
        return { ready: false }
      }
      return { ready: true, colors: committed.length > 0 ? committed : fallbackColors }
    },
  }
}
