import type { ScryfallCard } from './scryfall/types'
import { getFilterRejectionReason, type DeckFilters } from './card-validation'
import { analyzeComposition, findSynergyIssue } from './synergy-validation'

/** A resolved chat proposal: Scryfall ID → the card and how many copies. */
export type ResolvedCardMap = Map<string, { card: ScryfallCard; quantity: number }>

export interface ProposalRejection {
  name: string
  reason: string
}

export interface ValidateProposedCardsOptions {
  /** The full proposed deck. Always the composition the synergy check sees. */
  resolvedMap: ResolvedCardMap
  /** Color/budget/rarity intent. Omit to run only the synergy check. */
  intentFilters?: DeckFilters | null
  /** Cards the user pinned. They bypass both gates. */
  lockedCardIds?: ReadonlySet<string>
  /**
   * Scopes WHICH cards are judged - the composition is always the full deck.
   * The change path judges everything it proposed; the delta path passes only
   * the cards it added, so an off-intent card already sitting in the deck
   * doesn't trigger a spurious retry that could alter the targeted edit.
   */
  judgeIds?: ReadonlySet<string>
}

/**
 * Vet a proposed deck against the user's intent and its own composition.
 *
 * Two gates run in order, both against the composition of the whole proposal:
 *
 *   1. Intent (color, budget, rarity) - no amount of synergy can
 *      legalize an off-intent card, so this runs first. Basic lands are exempt
 *      from budget and rarity; see getFilterRejectionReason.
 *   2. Synergy (tribal payoffs, triggered abilities, keyword gates) - catches
 *      cards that are dead in the deck the AI actually built.
 *
 * Each rejected card is reported once, with the first reason that fired. A
 * non-empty result is what drives the single retry round trip in useDeckChat,
 * so anything reported here costs the user a second LLM call.
 */
export function validateProposedCards({
  resolvedMap,
  intentFilters,
  lockedCardIds,
  judgeIds,
}: ValidateProposedCardsOptions): ProposalRejection[] {
  const proposedEntries: Array<{ card: ScryfallCard; quantity: number }> = []
  for (const [, { card, quantity }] of resolvedMap) {
    proposedEntries.push({ card, quantity })
  }
  const proposedComposition = analyzeComposition(proposedEntries)

  const rejected: ProposalRejection[] = []
  for (const [sid, { card }] of resolvedMap) {
    if (judgeIds && !judgeIds.has(sid)) continue
    // Locked cards stay regardless - the user pinned them - and they skip the
    // synergy check too, so the bypass lives here rather than in the gate.
    if (lockedCardIds?.has(card.id)) continue

    if (intentFilters) {
      const filterIssue = getFilterRejectionReason(card, intentFilters)
      if (filterIssue) {
        rejected.push({ name: card.name, reason: filterIssue })
        continue
      }
    }

    const issue = findSynergyIssue(card, proposedComposition)
    if (issue) rejected.push({ name: card.name, reason: issue.reason })
  }
  return rejected
}
