/**
 * Pure helpers for the saved-deck reopen-combo path (zero React, zero network).
 *
 * The reopen-combo picker lets a saved deck pull a fresh core combo without the
 * wizard's destructive SELECT_COMBO reducer. By decision 4 it is ADDITIVE ONLY:
 * a chosen combo can only stage adds, never removals — the deck's locked cards
 * are never referenced. These functions are the pure core the picker stages
 * through the existing change ledger.
 */
import type { CoreCombo } from './wizard-state'
import type { DeckCard } from './deck-utils'
import type { CardChange } from './deck-chat-types'
import { getCardName } from './scryfall/types'
import type { SectionFillIntent } from './section-fill-intent'
import type { GenerateCombosOptions } from './combo-generation'

const ADD_QUANTITY = 4

/**
 * Turn a chosen combo into the additive-only change set for a saved deck.
 *
 * For each combo card that is RESOLVED (has both scryfallId and scryfallCard)
 * and is NOT already in the deck (by scryfallId), emit a canonical `added`
 * CardChange at 4 copies — matching the shape computeDeckDiff produces for adds.
 *
 * Adds-only by construction (decision-4 invariant): combo cards already present
 * emit nothing (no quantity bump), unresolved cards are skipped, and the deck's
 * locked cards are never read — so no `removed` or `changed` entry can be
 * produced no matter the input.
 */
export function comboToAdditions(combo: CoreCombo, existingCards: DeckCard[]): CardChange[] {
  const existing = new Set(existingCards.map((c) => c.scryfallId))
  const changes: CardChange[] = []

  for (const card of combo.cards) {
    if (!card.scryfallId || !card.scryfallCard) continue
    if (existing.has(card.scryfallId)) continue
    changes.push({
      name: getCardName(card.scryfallCard),
      scryfallId: card.scryfallId,
      scryfallCard: card.scryfallCard,
      type: 'added',
      oldQuantity: 0,
      newQuantity: ADD_QUANTITY,
    })
  }

  return changes
}

/**
 * Assemble the generateCombos options for the saved-deck reopen path.
 *
 * The reopen path is driven purely by the deck's committed colors: NO maybe-
 * coverage loop (`maybeColors: []`) and NO seed (`pinnedCard: undefined`). The
 * committed colors resolved by `intent.getFillColors()` are conveyed as both
 * the suggest-model identity (`selectedColors`) and the candidate-pool /
 * validation identity (`activeColors`).
 */
export function buildReopenComboOpts(intent: SectionFillIntent): GenerateCombosOptions {
  const fill = intent.getFillColors()
  const colors = fill.ready && fill.colors ? fill.colors : []
  return {
    activeColors: colors,
    selectedColors: colors,
    maybeColors: [],
    pinnedCard: undefined,
  }
}
