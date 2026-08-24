import type { ManaColor } from './mana-colors'
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
  /**
   * Cards already filed under each section, keyed by section id. Section fill
   * needs it to size each section's deficit and to preserve prior assignments
   * when it writes new ones — both adapters must supply a real map, never a
   * placeholder, or every section reads as empty (issue #18).
   */
  sectionAssignments: Record<string, string[]>
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
 * casual-only, so `format` is the constant `'casual'`. Section assignments live
 * on the stored deck rather than on DeckIntent, so they come in separately;
 * callers that only need color readiness can omit them. Color identity comes
 * from the committed intent colors, falling back to the deck's card-derived
 * union; fill is blocked only when both are empty.
 */
export function sectionFillIntentFromDeck(
  intent: DeckIntent,
  fallbackColors: ManaColor[],
  sectionAssignments: Record<string, string[]> = {},
): SectionFillIntent {
  return {
    selectedArchetypes: intent.archetypes,
    selectedTraits: intent.traits,
    customStrategy: intent.customStrategy,
    format: 'casual',
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarityFilter: intent.rarityFilter,
    sectionAssignments,
    getFillColors: () => {
      const committed = committedColors(intent)
      if (committed.length === 0 && fallbackColors.length === 0) {
        return { ready: false }
      }
      return { ready: true, colors: committed.length > 0 ? committed : fallbackColors }
    },
  }
}
