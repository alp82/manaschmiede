import type { CardChange } from './deck-chat-types'
import type { DeckCard } from './deck-utils'
import { mergeCardsIntoDeck } from './deck-utils'
import type { DeckSection } from './section-plan'
import { pickSectionForCard } from './section-plan'
import type { ScryfallCard } from './scryfall/types'

interface ApplySectionInheritanceOptions {
  /**
   * Section that unpaired adds top up. Explicit caller intent — a lane re-fill
   * or a "Top up (+N)" — so it outranks role inference. A paired add still
   * inherits the removed card's section.
   */
  targetSection?: string
  resolveCard: (id: string) => ScryfallCard | undefined
  sections: DeckSection[]
}

/**
 * Inherit section assignments for an applied AI change set. Pure: returns a new
 * assignments map without mutating the input.
 *
 * A swap's added card takes the removed card's section, removed ids are purged
 * from every section, and remaining adds go to `targetSection` when the caller
 * named one, otherwise are routed by role via pickSectionForCard.
 *
 * The swap fires only for an unambiguous single removal. A CardChange[] is a
 * diff, not a pairing: when the AI removes two spells and adds two creatures,
 * pairing by index would file both creatures under spells (issue #17).
 */
export function applySectionInheritance(
  assignments: Record<string, string[]>,
  changes: CardChange[],
  opts: ApplySectionInheritanceOptions,
): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(assignments)) next[k] = [...v]

  if (changes.length === 0) return next

  const removedIds = changes.filter((c) => c.type === 'removed').map((c) => c.scryfallId)
  const addedChanges = changes.filter((c) => c.type === 'added')
  const addedIds = addedChanges.map((c) => c.scryfallId)
  const placed = new Set<string>()

  if (removedIds.length === 1 && addedIds.length > 0) {
    const removedId = removedIds[0]
    const addedId = addedIds[0]
    // A card assigned to two sections is a data error; the last one wins, so
    // the replacement lands in exactly one section.
    let inheritedId: string | undefined
    for (const [sectionId, ids] of Object.entries(next)) {
      if (ids.includes(removedId)) inheritedId = sectionId
    }
    if (inheritedId) {
      next[inheritedId] = next[inheritedId].filter((id) => id !== removedId).concat(addedId)
      placed.add(addedId)
    }
  }

  // Drop any removed ids still lingering in assignments.
  for (const rid of removedIds) {
    for (const sectionId of Object.keys(next)) {
      next[sectionId] = next[sectionId].filter((id) => id !== rid)
    }
  }

  // Remaining additions: the caller's target section first, then auto-pick.
  for (const change of addedChanges) {
    const aid = change.scryfallId
    if (placed.has(aid)) continue

    if (opts.targetSection) {
      next[opts.targetSection] = [...(next[opts.targetSection] ?? []), aid]
      placed.add(aid)
      continue
    }

    const card = change.scryfallCard ?? opts.resolveCard(aid)
    if (!card) continue

    const pickedId = pickSectionForCard(card, opts.sections)
    if (pickedId) {
      next[pickedId] = [...(next[pickedId] ?? []), aid]
      placed.add(aid)
    }
  }

  return next
}

/**
 * Reverse lookup: scryfallId -> section label, for the deck snapshot sent to
 * the AI. Without it every card reads as unsectioned, so a targeted "add N
 * more cards to <lane>" request describes a section the model can't see
 * (issue #16).
 *
 * `labels` is optional. Section ids are semantic slugs ("removal",
 * "card-draw"), so a caller without a localized plan in scope still gives the
 * model a usable label. When a card sits in two sections, the last one wins.
 */
export function buildCardSectionLabels(
  assignments: Record<string, string[]> | undefined,
  labels?: Record<string, string>,
): Map<string, string> {
  const byCard = new Map<string, string>()
  if (!assignments) return byCard
  for (const [sectionId, ids] of Object.entries(assignments)) {
    const label = labels?.[sectionId] ?? sectionId
    for (const id of ids) byCard.set(id, label)
  }
  return byCard
}

/**
 * Collect a localized section plan into the section-id-to-label record
 * useDeckChat labels the AI deck snapshot with. Both chat callers (the wizard
 * fill step and the deck route) build it off the plan they already render, so
 * the label in a targeted "add N more cards to <lane>" request matches the
 * label on the cards the model is handed.
 */
export function buildSectionLabelMap(sections: DeckSection[]): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const section of sections) labels[section.id] = section.label
  return labels
}

interface MergeSectionFillInput {
  deckCards: DeckCard[]
  additions: Array<{ scryfallId: string; quantity: number }>
  /** Current assignments map. Only `sectionId`'s entry is read. */
  assignments: Record<string, string[]>
  sectionId: string
  isBasicLandId: (id: string) => boolean
}

/**
 * Merge a batch of fill additions into a deck and compute the target section's
 * new assignment list in one step. Pure: neither input is mutated.
 *
 * `assignedIds` is the union of what the section already held and the ids the
 * merge actually accepted — never the added ids alone. The consumer replaces
 * the section's list wholesale (`ASSIGN_SECTION` in wizard-state.ts overwrites
 * the key: no concat, no union, no dedupe), so sending only the new ids erases
 * every card already filed under that section. Returning `merged` and
 * `assignedIds` together makes that mistake impossible — a caller cannot get
 * the merged deck without also getting the union it has to send (issue #18).
 *
 * Ids the merge rejected (a card already at four copies, a locked card, a
 * zero-quantity row) are not assigned, so a dropped addition leaves no phantom
 * entry behind.
 */
export function mergeSectionFill(input: MergeSectionFillInput): {
  merged: DeckCard[]
  assignedIds: string[]
} {
  const { deckCards, additions, assignments, sectionId, isBasicLandId } = input
  const { merged, addedIds } = mergeCardsIntoDeck(deckCards, additions, isBasicLandId)
  const prior = assignments[sectionId] ?? []
  return { merged, assignedIds: Array.from(new Set([...prior, ...addedIds])) }
}
