/**
 * RED tests — mergeSectionFill does not exist yet.
 * It must be exported from src/lib/section-assignment.ts.
 *
 * Asserted signature:
 *
 *   interface MergeSectionFillInput {
 *     deckCards: DeckCard[]
 *     additions: Array<{ scryfallId: string; quantity: number }>
 *     assignments: Record<string, string[]>   // sectionId -> scryfallId[]
 *     sectionId: string
 *     isBasicLandId: (id: string) => boolean
 *   }
 *
 *   mergeSectionFill(input: MergeSectionFillInput): {
 *     merged: DeckCard[]
 *     assignedIds: string[]
 *   }
 *
 * Why this function exists (issue #18):
 *
 * The consumer of `assignedIds` REPLACES the section's id list wholesale —
 * `ASSIGN_SECTION` in wizard-state.ts overwrites the key, no concat, no union,
 * no dedupe. Two of the three useSectionFill call sites sent only the newly
 * added ids, which erases every card already filed under that section.
 *
 * Returning `merged` and `assignedIds` from one call makes that mistake
 * impossible: a caller cannot obtain the merged deck without also obtaining
 * the union it must send.
 */
import { describe, it, expect } from 'vitest'
import { mergeSectionFill } from '../section-assignment'
import type { DeckCard } from '../deck-utils'

const noBasics = (_id: string) => false
const isForest = (id: string) => id === 'forest'

function main(scryfallId: string, quantity: number, locked?: boolean): DeckCard {
  return locked
    ? { scryfallId, quantity, zone: 'main', locked: true }
    : { scryfallId, quantity, zone: 'main' }
}

// ─── The bug: prior assignments must survive ──────────────────────────────

describe('mergeSectionFill - union with prior assignments', () => {
  it('a section that already holds ids keeps them alongside the new ones', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [main('bolt', 4), main('shock', 2)],
      additions: [{ scryfallId: 'opt', quantity: 2 }],
      assignments: { spells: ['bolt', 'shock'] },
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['bolt', 'shock', 'opt'])
  })

  it('prior order is preserved and new ids append', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [],
      additions: [
        { scryfallId: 'c', quantity: 1 },
        { scryfallId: 'd', quantity: 1 },
      ],
      assignments: { creatures: ['a', 'b'] },
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a section with no prior entry starts from an empty list', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [],
      additions: [{ scryfallId: 'elf', quantity: 4 }],
      assignments: { spells: ['bolt'] },
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['elf'])
  })

  it('re-adding an id already filed under the section does not duplicate it', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [main('elf', 2)],
      additions: [{ scryfallId: 'elf', quantity: 1 }],
      assignments: { creatures: ['elf'] },
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['elf'])
  })

  it('a repeated id within one addition batch appears once', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [],
      additions: [
        { scryfallId: 'elf', quantity: 1 },
        { scryfallId: 'elf', quantity: 1 },
      ],
      assignments: {},
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['elf'])
  })
})

// ─── Only ids that actually landed get assigned ───────────────────────────

describe('mergeSectionFill - assigns only what the merge accepted', () => {
  it('an addition rejected by the 4-copy cap leaves the assignment untouched', () => {
    const { assignedIds, merged } = mergeSectionFill({
      deckCards: [main('bolt', 4)],
      additions: [{ scryfallId: 'bolt', quantity: 2 }],
      assignments: { spells: ['bolt'] },
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['bolt'])
    expect(merged.find((c) => c.scryfallId === 'bolt')?.quantity).toBe(4)
  })

  it('a capped addition of an unassigned card produces no phantom entry', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [main('bolt', 4)],
      additions: [{ scryfallId: 'bolt', quantity: 1 }],
      assignments: { spells: ['shock'] },
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['shock'])
  })

  it('a locked card is not topped up and is not assigned', () => {
    const { assignedIds, merged } = mergeSectionFill({
      deckCards: [main('bolt', 2, true)],
      additions: [{ scryfallId: 'bolt', quantity: 2 }],
      assignments: {},
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual([])
    expect(merged.find((c) => c.scryfallId === 'bolt')?.quantity).toBe(2)
  })

  it('a zero-quantity addition is ignored', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [],
      additions: [{ scryfallId: 'elf', quantity: 0 }],
      assignments: { creatures: ['bear'] },
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).toEqual(['bear'])
  })

  it('basic lands bypass the 4-copy cap and are assigned', () => {
    const { assignedIds, merged } = mergeSectionFill({
      deckCards: [main('forest', 10)],
      additions: [{ scryfallId: 'forest', quantity: 14 }],
      assignments: { lands: ['forest'] },
      sectionId: 'lands',
      isBasicLandId: isForest,
    })
    expect(assignedIds).toEqual(['forest'])
    expect(merged.find((c) => c.scryfallId === 'forest')?.quantity).toBe(24)
  })
})

// ─── The merged deck ──────────────────────────────────────────────────────

describe('mergeSectionFill - merged deck', () => {
  it('a new card is appended to the main zone', () => {
    const { merged } = mergeSectionFill({
      deckCards: [main('bolt', 4)],
      additions: [{ scryfallId: 'elf', quantity: 3 }],
      assignments: {},
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(merged).toContainEqual({ scryfallId: 'elf', quantity: 3, zone: 'main' })
  })

  it('an existing card is topped up in place, not duplicated', () => {
    const { merged } = mergeSectionFill({
      deckCards: [main('elf', 1)],
      additions: [{ scryfallId: 'elf', quantity: 2 }],
      assignments: {},
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(merged.filter((c) => c.scryfallId === 'elf')).toHaveLength(1)
    expect(merged[0].quantity).toBe(3)
  })
})

// ─── Purity ───────────────────────────────────────────────────────────────

describe('mergeSectionFill - purity', () => {
  it('does not mutate the assignments map or its lists', () => {
    const assignments = { spells: ['bolt'], creatures: ['elf'] }
    mergeSectionFill({
      deckCards: [],
      additions: [{ scryfallId: 'opt', quantity: 1 }],
      assignments,
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignments).toEqual({ spells: ['bolt'], creatures: ['elf'] })
  })

  it('does not mutate the input deck', () => {
    const deckCards = [main('elf', 1)]
    mergeSectionFill({
      deckCards,
      additions: [{ scryfallId: 'elf', quantity: 2 }],
      assignments: {},
      sectionId: 'creatures',
      isBasicLandId: noBasics,
    })
    expect(deckCards).toEqual([{ scryfallId: 'elf', quantity: 1, zone: 'main' }])
  })

  it('reads only the target section, leaving other sections out of the result', () => {
    const { assignedIds } = mergeSectionFill({
      deckCards: [],
      additions: [{ scryfallId: 'opt', quantity: 1 }],
      assignments: { spells: ['bolt'], creatures: ['elf'] },
      sectionId: 'spells',
      isBasicLandId: noBasics,
    })
    expect(assignedIds).not.toContain('elf')
    expect(assignedIds).toEqual(['bolt', 'opt'])
  })
})
