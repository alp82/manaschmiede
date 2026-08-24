import { MANA_COLORS, type ManaColor } from './mana-colors'
import type { WizardState } from './wizard-state'
import { getFillColors } from './wizard-state'
import type { DeckFilters } from './card-validation'
import type { IntentContext } from '../../convex/lib/intentContext'
import { getTraitById } from './trait-mappings'
import { RARITIES } from './rarity'

/**
 * Persisted, user-authored deck intent — the single source of truth for AI
 * color/budget/rarity enforcement. It is intentionally INERT: editing it never
 * cascades into the card list. `colors` is a committed/unselected map (no
 * 'maybe' — maybes are resolved at wizard finish via getFillColors). The
 * card-derived LocalDeck.colors stays a display concern and is never the AI
 * constraint.
 */
export interface DeckIntent {
  colors: Record<ManaColor, 'selected' | 'unselected'>
  archetypes: string[]
  traits: string[]
  customStrategy: string
  budgetMin: number | null
  budgetMax: number | null
  rarityFilter: string[]
}

/** A blank intent: nothing committed, every rarity allowed, no budget. */
export function emptyIntent(): DeckIntent {
  return {
    colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'unselected', G: 'unselected' },
    archetypes: [],
    traits: [],
    customStrategy: '',
    budgetMin: null,
    budgetMax: null,
    rarityFilter: [...RARITIES],
  }
}

/**
 * Snapshot a finished wizard into a persisted intent.
 *
 * Committed colors come from getFillColors(state): selected colors plus the
 * 'maybe' colors the chosen combo actually uses (used-maybe promoted, unused
 * maybe dropped). When the combo's card data hasn't resolved (ready:false) we
 * treat committed as empty — decision-1 fallback (the deck's card-derived
 * color union) handles enforcement in that case. All other fields are direct
 * snapshots and never depend on the deck's cards.
 */
export function intentFromWizard(state: WizardState): DeckIntent {
  const fill = getFillColors(state)
  const committed = new Set<ManaColor>(fill.ready && fill.colors ? fill.colors : [])

  const colors = {} as Record<ManaColor, 'selected' | 'unselected'>
  for (const color of MANA_COLORS) {
    colors[color] = committed.has(color) ? 'selected' : 'unselected'
  }

  return {
    colors,
    archetypes: [...state.selectedArchetypes],
    traits: [...state.selectedTraits],
    customStrategy: state.customStrategy,
    budgetMin: state.budgetMin,
    budgetMax: state.budgetMax,
    rarityFilter: [...state.rarityFilter],
  }
}

/**
 * Returns the committed (selected) colors from a DeckIntent in WUBRG order.
 * Convenience over calling deriveIntentFilters when only colors are needed.
 */
export function committedColors(intent: DeckIntent): ManaColor[] {
  return MANA_COLORS.filter((c) => intent.colors[c] === 'selected')
}

/**
 * Resolve a persisted intent into the DeckFilters the gate enforces.
 *
 * Allowed colors = the committed (selected) colors. When committed is empty,
 * fall back to `fallbackColors` (the deck's card-derived union) when provided;
 * an empty/absent fallback means no color constraint. Committed colors always
 * win when non-empty — the fallback never widens a committed set.
 *
 * @param fallbackColors - Card-derived color union used when committed is empty.
 *   An EMPTY fallback (e.g. before card data resolves) yields NO color constraint,
 *   so callers must not treat the gate as always-on during the card-load window.
 */
export function deriveIntentFilters(intent: DeckIntent, fallbackColors?: ManaColor[]): DeckFilters {
  const committed = committedColors(intent)
  const colors = committed.length > 0 ? committed : (fallbackColors ?? [])
  return {
    colors,
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarities: intent.rarityFilter,
  }
}

/**
 * Build a flat IntentContext suitable for passing to the AI (chat or fillSection).
 *
 * Performs the archetype/trait id→label mapping and assembles the object.
 * Deduplicates the inline mapping that was previously repeated in each call site.
 */
export function buildChatIntentContext(
  colors: string[],
  archetypeIds: string[],
  traitIds: string[],
  opts: {
    customStrategy?: string
    budgetMin?: number | null
    budgetMax?: number | null
  },
): IntentContext {
  return {
    colors,
    archetypes: archetypeIds.map((id) => getTraitById(id)?.label ?? id),
    traits: traitIds.map((id) => getTraitById(id)?.label ?? id),
    customStrategy: opts.customStrategy || undefined,
    budgetMin: opts.budgetMin,
    budgetMax: opts.budgetMax,
  }
}
