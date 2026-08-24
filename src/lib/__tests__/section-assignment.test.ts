/**
 * RED tests — applySectionInheritance does not exist yet.
 * It must be exported from src/lib/section-assignment.ts.
 *
 * Asserted signature:
 *   applySectionInheritance(
 *     assignments: Record<string, string[]>,
 *     changes: CardChange[],
 *     opts: {
 *       strictSingleSwap: boolean
 *       targetSection?: string
 *       resolveCard: (id: string) => ScryfallCard | undefined
 *       sections: DeckSection[]
 *     }
 *   ): Record<string, string[]>
 *
 * Two branches:
 *   strictSingleSwap:false — wizard/StepDeckFill branch:
 *     All removals pair with adds by index (min-pair loop). Unpaired adds
 *     fall to targetSection or pickSectionForCard. Misfit adds (no pair,
 *     no targetSection, no matching role) are silently dropped.
 *   strictSingleSwap:true — deck editor/$id branch:
 *     Only fires the single-swap shortcut when removedIds.length === 1.
 *     For multi-card swaps (removedIds.length > 1) the swap does NOT fire
 *     and all adds fall through to pickSectionForCard.
 *
 * NOT unit-testable (noted here, not written):
 *   - dispatch side-effect (React dispatch, not unit-tested)
 *   - diff-only dispatch optimization (relies on React state, not unit-tested)
 */
import { describe, it, expect } from 'vitest'
import { applySectionInheritance, buildCardSectionLabels, buildSectionLabelMap } from '../section-assignment'
import type { CardChange } from '../deck-chat-types'
import type { DeckSection } from '../section-plan'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeScryfallCard(id: string, type_line: string): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line,
    oracle_text: '',
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function makeSection(id: string, role: DeckSection['role']): DeckSection {
  return { id, label: id, description: '', targetCount: 8, role, scryfallHints: [] }
}

function makeChange(
  type: CardChange['type'],
  scryfallId: string,
  scryfallCard?: ScryfallCard,
): CardChange {
  return {
    name: scryfallId,
    scryfallId,
    scryfallCard,
    type,
    oldQuantity: type === 'added' ? 0 : 1,
    newQuantity: type === 'removed' ? 0 : 1,
  }
}

function makeAssignments(obj: Record<string, string[]>): Record<string, string[]> {
  // Deep-copy so tests don't share references
  const result: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj)) result[k] = [...v]
  return result
}

// ─── applySectionInheritance — strictSingleSwap:false (wizard/StepDeckFill branch) ──

describe('applySectionInheritance - strictSingleSwap:false (wizard/StepDeckFill branch)', () => {
  it('2-removal/2-add -> BOTH adds inherit their paired removed cards sections (min-pair loop); old ids gone', () => {
    const assignments = makeAssignments({
      creatures: ['old-a', 'old-b'],
      spells: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-a'),
      makeChange('removed', 'old-b'),
      makeChange('added', 'new-a', makeScryfallCard('new-a', 'Creature — Elf')),
      makeChange('added', 'new-b', makeScryfallCard('new-b', 'Creature — Human')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: false,
      resolveCard: (id) => undefined,
      sections,
    })
    // Both new cards should be in creatures (inherited from old-a, old-b)
    expect(result['creatures']).toContain('new-a')
    expect(result['creatures']).toContain('new-b')
    // Old ids must be gone
    expect(result['creatures']).not.toContain('old-a')
    expect(result['creatures']).not.toContain('old-b')
  })

  it('3-removal/2-add -> first two adds inherit paired removes; third removal dropped; each add appears exactly once', () => {
    const assignments = makeAssignments({
      creatures: ['old-a', 'old-b', 'old-c'],
      spells: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-a'),
      makeChange('removed', 'old-b'),
      makeChange('removed', 'old-c'),
      makeChange('added', 'new-a', makeScryfallCard('new-a', 'Creature — Elf')),
      makeChange('added', 'new-b', makeScryfallCard('new-b', 'Creature — Human')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: false,
      resolveCard: (id) => undefined,
      sections,
    })
    // new-a and new-b both placed (paired to old-a and old-b respectively)
    expect(result['creatures']).toContain('new-a')
    expect(result['creatures']).toContain('new-b')
    // All old ids gone
    expect(result['creatures']).not.toContain('old-a')
    expect(result['creatures']).not.toContain('old-b')
    expect(result['creatures']).not.toContain('old-c')
    // new-a and new-b each appear exactly once total
    const allIds = Object.values(result).flat()
    expect(allIds.filter((id) => id === 'new-a')).toHaveLength(1)
    expect(allIds.filter((id) => id === 'new-b')).toHaveLength(1)
  })

  it("targetSection routes an unpaired add to that section (no removals, targetSection 'spells' -> 'new-a' in spells)", () => {
    const assignments = makeAssignments({ spells: [] })
    const changes: CardChange[] = [
      makeChange('added', 'new-a', makeScryfallCard('new-a', 'Instant')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: false,
      targetSection: 'spells',
      resolveCard: (id) => undefined,
      sections,
    })
    expect(result['spells']).toContain('new-a')
  })

  it('targetSection used for unpaired add while a paired add inherits: removed(old-c in creatures) + added(new-spell) pairs to creatures; added(new-extra) unpaired -> targetSection spells', () => {
    const assignments = makeAssignments({
      creatures: ['old-c'],
      spells: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-c'),
      makeChange('added', 'new-spell', makeScryfallCard('new-spell', 'Instant')),
      makeChange('added', 'new-extra', makeScryfallCard('new-extra', 'Sorcery')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: false,
      targetSection: 'spells',
      resolveCard: (id) => undefined,
      sections,
    })
    // new-spell pairs with old-c (which was in creatures) -> inherits creatures
    expect(result['creatures']).toContain('new-spell')
    // new-extra is unpaired -> routes to targetSection 'spells'
    expect(result['spells']).toContain('new-extra')
    // old-c gone
    expect(result['creatures']).not.toContain('old-c')
  })

  it('misfit add (no pair, no targetSection, only a creatures section, add is planeswalker) -> not placed in any section', () => {
    const assignments = makeAssignments({ creatures: [] })
    const changes: CardChange[] = [
      // Planeswalker: no matching role in plan (plan has only creatures)
      makeChange('added', 'misfit-pw', makeScryfallCard('misfit-pw', 'Legendary Planeswalker — Jace')),
    ]
    const sections = [makeSection('creatures', 'creatures')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: false,
      resolveCard: (id) => undefined,
      sections,
    })
    const allIds = Object.values(result).flat()
    expect(allIds).not.toContain('misfit-pw')
  })
})

// ─── applySectionInheritance — strictSingleSwap:true (deck editor/$id branch) ──

describe('applySectionInheritance - strictSingleSwap:true (deck editor/$id branch)', () => {
  it('2-removal/2-add -> swap does NOT fire (removedIds.length===1 early-out); adds placed via pickSectionForCard', () => {
    const assignments = makeAssignments({
      spells: ['old-1', 'old-2'],
      creatures: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-1'),
      makeChange('removed', 'old-2'),
      makeChange('added', 'new-1', makeScryfallCard('new-1', 'Creature — Elf')),
      makeChange('added', 'new-2', makeScryfallCard('new-2', 'Creature — Human')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: true,
      resolveCard: (id) => {
        if (id === 'new-1') return makeScryfallCard('new-1', 'Creature — Elf')
        if (id === 'new-2') return makeScryfallCard('new-2', 'Creature — Human')
        return undefined
      },
      sections,
    })
    // Swap didn't fire because removedIds.length > 1; pickSectionForCard routes creatures
    expect(result['creatures']).toContain('new-1')
    expect(result['creatures']).toContain('new-2')
    // Old ids removed
    expect(result['spells']).not.toContain('old-1')
    expect(result['spells']).not.toContain('old-2')
  })

  it('2-removal/2-add with heterogeneous sections (olds in spells, adds are creatures) -> adds go to creatures (pickSectionForCard), NOT spells (swap did not fire)', () => {
    const assignments = makeAssignments({
      spells: ['old-spell-1', 'old-spell-2'],
      creatures: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-spell-1'),
      makeChange('removed', 'old-spell-2'),
      makeChange('added', 'new-c-1', makeScryfallCard('new-c-1', 'Creature — Warrior')),
      makeChange('added', 'new-c-2', makeScryfallCard('new-c-2', 'Creature — Knight')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: true,
      resolveCard: (id) => {
        if (id === 'new-c-1') return makeScryfallCard('new-c-1', 'Creature — Warrior')
        if (id === 'new-c-2') return makeScryfallCard('new-c-2', 'Creature — Knight')
        return undefined
      },
      sections,
    })
    // pickSectionForCard picks creatures (NOT spells - swap didn't fire)
    expect(result['creatures']).toContain('new-c-1')
    expect(result['creatures']).toContain('new-c-2')
    expect((result['spells'] ?? [])).not.toContain('new-c-1')
    expect((result['spells'] ?? [])).not.toContain('new-c-2')
  })

  it('1-removal/1-add -> the single add inherits the removed cards section', () => {
    const assignments = makeAssignments({
      spells: ['old-spell'],
      creatures: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-spell'),
      makeChange('added', 'new-spell', makeScryfallCard('new-spell', 'Instant')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: true,
      resolveCard: (id) => undefined,
      sections,
    })
    expect(result['spells']).toContain('new-spell')
    expect(result['spells']).not.toContain('old-spell')
  })

  it('1-removal/0-add -> removed id dropped, no adds; other ids in section preserved', () => {
    const assignments = makeAssignments({
      spells: ['old-spell', 'keeper-spell'],
      creatures: ['keeper-creature'],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-spell'),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      strictSingleSwap: true,
      resolveCard: (id) => undefined,
      sections,
    })
    expect(result['spells']).not.toContain('old-spell')
    expect(result['spells']).toContain('keeper-spell')
    expect(result['creatures']).toContain('keeper-creature')
  })
})

// ─── applySectionInheritance — shared invariants (both modes) ─────────────

describe('applySectionInheritance - shared invariants (both modes)', () => {
  for (const strict of [false, true] as const) {
    const label = strict ? 'strictSingleSwap:true' : 'strictSingleSwap:false'

    it(`[${label}] removed ids purged from EVERY section (same id in two sections -> gone from both)`, () => {
      const assignments = makeAssignments({
        creatures: ['dup-card', 'keeper-a'],
        spells: ['dup-card', 'keeper-b'],
      })
      const changes: CardChange[] = [
        makeChange('removed', 'dup-card'),
      ]
      const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
      const result = applySectionInheritance(assignments, changes, {
        strictSingleSwap: strict,
        resolveCard: (id) => undefined,
        sections,
      })
      expect(result['creatures']).not.toContain('dup-card')
      expect(result['spells']).not.toContain('dup-card')
    })

    it(`[${label}] a card never appears in two buckets in the result`, () => {
      const assignments = makeAssignments({
        creatures: ['old-a'],
        spells: [],
      })
      const changes: CardChange[] = [
        makeChange('removed', 'old-a'),
        makeChange('added', 'new-a', makeScryfallCard('new-a', 'Creature — Elf')),
      ]
      const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
      const result = applySectionInheritance(assignments, changes, {
        strictSingleSwap: strict,
        resolveCard: (id) => {
          if (id === 'new-a') return makeScryfallCard('new-a', 'Creature — Elf')
          return undefined
        },
        sections,
      })
      const allIds = Object.values(result).flat()
      const newACount = allIds.filter((id) => id === 'new-a').length
      expect(newACount).toBeLessThanOrEqual(1)
    })

    it(`[${label}] cards already assigned but not in changes are preserved`, () => {
      const assignments = makeAssignments({
        creatures: ['unchanged-1', 'unchanged-2'],
        spells: ['old-spell'],
      })
      const changes: CardChange[] = [
        makeChange('removed', 'old-spell'),
      ]
      const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
      const result = applySectionInheritance(assignments, changes, {
        strictSingleSwap: strict,
        resolveCard: (id) => undefined,
        sections,
      })
      expect(result['creatures']).toContain('unchanged-1')
      expect(result['creatures']).toContain('unchanged-2')
    })

    it(`[${label}] empty changes -> result deep-equals assignments`, () => {
      const assignments = makeAssignments({
        creatures: ['card-1', 'card-2'],
        spells: ['card-3'],
      })
      const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
      const result = applySectionInheritance(assignments, [], {
        strictSingleSwap: strict,
        resolveCard: (id) => undefined,
        sections,
      })
      expect(result).toEqual(assignments)
    })

    it(`[${label}] result is a new reference (!== input assignments), immutability`, () => {
      const assignments = makeAssignments({
        creatures: ['card-1'],
      })
      const sections = [makeSection('creatures', 'creatures')]
      const result = applySectionInheritance(assignments, [], {
        strictSingleSwap: strict,
        resolveCard: (id) => undefined,
        sections,
      })
      expect(result).not.toBe(assignments)
    })
  }
})

/**
 * buildCardSectionLabels (issue #16).
 *
 * Asserted signature:
 *   buildCardSectionLabels(
 *     assignments: Record<string, string[]> | undefined,
 *     labels?: Record<string, string>,
 *   ): Map<string, string>
 *
 * The AI deck snapshot labels each card with its section. The labels map is
 * optional: without it every card falls back to its section id, which is a
 * semantic slug ("removal", "card-draw") and still readable to the model.
 */
describe('buildCardSectionLabels', () => {
  it('maps every assigned card to its section label', () => {
    const result = buildCardSectionLabels(
      { removal: ['card-1', 'card-2'], 'card-draw': ['card-3'] },
      { removal: 'Removal', 'card-draw': 'Card Draw' },
    )
    expect(result.get('card-1')).toBe('Removal')
    expect(result.get('card-2')).toBe('Removal')
    expect(result.get('card-3')).toBe('Card Draw')
  })

  it('falls back to the section id when no labels map is passed', () => {
    const result = buildCardSectionLabels({ removal: ['card-1'], 'win-conditions': ['card-2'] })
    expect(result.get('card-1')).toBe('removal')
    expect(result.get('card-2')).toBe('win-conditions')
  })

  it('falls back to the section id for a section missing from the labels map', () => {
    const result = buildCardSectionLabels(
      { removal: ['card-1'], 'card-draw': ['card-2'] },
      { removal: 'Removal' },
    )
    expect(result.get('card-1')).toBe('Removal')
    expect(result.get('card-2')).toBe('card-draw')
  })

  it('returns an empty map when assignments are missing', () => {
    expect(buildCardSectionLabels(undefined).size).toBe(0)
    expect(buildCardSectionLabels(undefined, { removal: 'Removal' }).size).toBe(0)
    expect(buildCardSectionLabels({}).size).toBe(0)
  })

  it('skips empty sections and leaves unassigned cards unlabelled', () => {
    const result = buildCardSectionLabels({ removal: [], 'card-draw': ['card-1'] })
    expect(result.size).toBe(1)
    expect(result.get('card-9')).toBeUndefined()
  })

  it('lets the last section win when a card is assigned twice', () => {
    const result = buildCardSectionLabels(
      { removal: ['card-1'], 'card-draw': ['card-1'] },
      { removal: 'Removal', 'card-draw': 'Card Draw' },
    )
    expect(result.get('card-1')).toBe('Card Draw')
  })
})

/**
 * RED tests — buildSectionLabelMap does not exist yet (issue #16).
 *
 * Asserted signature:
 *   buildSectionLabelMap(sections: DeckSection[]): Record<string, string>
 *
 * Both chat callers (the wizard fill step and the deck route) hand
 * useDeckChat a section-id-to-label record built off the localized plan they
 * already render. One helper keeps the two from drifting.
 */
describe('buildSectionLabelMap', () => {
  it('keys each section label by its section id', () => {
    const sections = [
      { ...makeSection('removal', 'interaction'), label: 'Removal' },
      { ...makeSection('card-draw', 'spells'), label: 'Card Draw' },
    ]
    expect(buildSectionLabelMap(sections)).toEqual({ removal: 'Removal', 'card-draw': 'Card Draw' })
  })

  it('returns an empty record for an empty plan', () => {
    expect(buildSectionLabelMap([])).toEqual({})
  })

  it('round-trips into buildCardSectionLabels', () => {
    const sections = [{ ...makeSection('removal', 'interaction'), label: 'Removal' }]
    const byCard = buildCardSectionLabels({ removal: ['card-1'] }, buildSectionLabelMap(sections))
    expect(byCard.get('card-1')).toBe('Removal')
  })
})
