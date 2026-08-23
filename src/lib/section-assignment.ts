import type { CardChange } from './deck-chat-types'
import type { DeckSection } from './section-plan'
import { pickSectionForCard } from './section-plan'
import type { ScryfallCard } from './scryfall/types'

interface ApplySectionInheritanceOptions {
  /**
   * When true (deck editor branch), the swap-pair shortcut fires only for an
   * unambiguous single removal (`removedIds.length === 1`); multi-card swaps
   * fall through to pickSectionForCard. When false (wizard branch), every
   * removal pairs with an add by index and a `targetSection` top-up applies.
   */
  strictSingleSwap: boolean
  /** Section that unpaired adds top up (wizard branch only). */
  targetSection?: string
  resolveCard: (id: string) => ScryfallCard | undefined
  sections: DeckSection[]
}

/**
 * Inherit section assignments for an applied AI change set. Pure: returns a new
 * assignments map without mutating the input.
 *
 * Both branches: a swap's added card takes the removed card's section, removed
 * ids are purged from every section, and remaining adds are routed by role via
 * pickSectionForCard. The strict branch fires the swap only for single removals;
 * the wizard branch pairs multi-card swaps and tops up via targetSection.
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

  const swapFires = opts.strictSingleSwap
    ? removedIds.length === 1 && addedIds.length > 0
    : removedIds.length > 0 && addedIds.length > 0

  if (swapFires) {
    const sectionForRemoved = new Map<string, string>()
    for (const rid of removedIds) {
      for (const [sectionId, ids] of Object.entries(next)) {
        if (ids.includes(rid)) sectionForRemoved.set(rid, sectionId)
      }
    }
    const pairCount = Math.min(removedIds.length, addedIds.length)
    for (let i = 0; i < pairCount; i++) {
      const sectionId = sectionForRemoved.get(removedIds[i])
      if (sectionId) {
        next[sectionId] = (next[sectionId] ?? [])
          .filter((id) => id !== removedIds[i])
          .concat(addedIds[i])
        placed.add(addedIds[i])
      }
    }
  }

  // Drop any removed ids still lingering in assignments.
  for (const rid of removedIds) {
    for (const sectionId of Object.keys(next)) {
      next[sectionId] = next[sectionId].filter((id) => id !== rid)
    }
  }

  // Remaining additions: target section first (wizard branch), then auto-pick.
  for (const change of addedChanges) {
    const aid = change.scryfallId
    if (placed.has(aid)) continue

    if (!opts.strictSingleSwap && opts.targetSection) {
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
