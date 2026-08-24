/**
 * applySectionInheritance — one set of semantics for both surfaces
 * (wizard fill step and deck route). Issue #17 collapsed the former
 * `strictSingleSwap` flag, which coupled two unrelated decisions:
 *
 *   1. when the index-pairing swap fires;
 *   2. whether an explicit `targetSection` is honoured at all.
 *
 * Asserted signature:
 *   applySectionInheritance(
 *     assignments: Record<string, string[]>,
 *     changes: CardChange[],
 *     opts: {
 *       targetSection?: string
 *       resolveCard: (id: string) => ScryfallCard | undefined
 *       sections: DeckSection[]
 *     }
 *   ): Record<string, string[]>
 *
 * Semantics:
 *   - The swap shortcut fires only for an unambiguous single removal
 *     (`removedIds.length === 1`). A CardChange[] is a diff, not a pairing,
 *     so a multi-card swap must not pair the i-th removal with the i-th add.
 *   - `targetSection` is caller intent and outranks role inference, on every
 *     surface. A paired add still inherits the removed card's section.
 *   - Adds with no pair, no targetSection, and no matching role are dropped.
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

// ─── applySectionInheritance — swap pairing ────────────────────────────────

describe('applySectionInheritance - swap pairing', () => {
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
      resolveCard: () => undefined,
      sections,
    })
    expect(result['spells']).toContain('new-spell')
    expect(result['spells']).not.toContain('old-spell')
  })

  it('2-removal/2-add -> swap does NOT fire (the diff carries no pairing); adds placed via pickSectionForCard', () => {
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
      resolveCard: () => undefined,
      sections,
    })
    expect(result['spells']).not.toContain('old-spell')
    expect(result['spells']).toContain('keeper-spell')
    expect(result['creatures']).toContain('keeper-creature')
  })
})

// ─── applySectionInheritance — targetSection ───────────────────────────────

describe('applySectionInheritance - targetSection', () => {
  it("routes an unpaired add to that section (no removals, targetSection 'spells' -> 'new-a' in spells)", () => {
    const assignments = makeAssignments({ spells: [] })
    const changes: CardChange[] = [
      makeChange('added', 'new-a', makeScryfallCard('new-a', 'Instant')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      targetSection: 'spells',
      resolveCard: () => undefined,
      sections,
    })
    expect(result['spells']).toContain('new-a')
  })

  it('outranks role inference: a lane top-up of creatures into the removal lane lands in removal, not creatures', () => {
    const assignments = makeAssignments({ creatures: [], removal: [] })
    const changes: CardChange[] = [
      makeChange('added', 'new-c-1', makeScryfallCard('new-c-1', 'Creature — Elf')),
      makeChange('added', 'new-c-2', makeScryfallCard('new-c-2', 'Creature — Human')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('removal', 'interaction')]
    const result = applySectionInheritance(assignments, changes, {
      targetSection: 'removal',
      resolveCard: (id) => makeScryfallCard(id, 'Creature — Elf'),
      sections,
    })
    expect(result['removal']).toEqual(['new-c-1', 'new-c-2'])
    expect(result['creatures']).toEqual([])
  })

  it('outranks role inference for a multi-removal re-fill, where the swap does not fire', () => {
    const assignments = makeAssignments({
      creatures: ['old-1', 'old-2'],
      removal: [],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-1'),
      makeChange('removed', 'old-2'),
      makeChange('added', 'new-c-1', makeScryfallCard('new-c-1', 'Creature — Elf')),
      makeChange('added', 'new-c-2', makeScryfallCard('new-c-2', 'Creature — Human')),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('removal', 'interaction')]
    const result = applySectionInheritance(assignments, changes, {
      targetSection: 'removal',
      resolveCard: (id) => makeScryfallCard(id, 'Creature — Elf'),
      sections,
    })
    expect(result['removal']).toEqual(['new-c-1', 'new-c-2'])
    expect(result['creatures']).toEqual([])
  })

  it('does not outrank a paired inherit: removed(old-c in creatures) + added(new-spell) pairs to creatures; added(new-extra) unpaired -> targetSection spells', () => {
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
      targetSection: 'spells',
      resolveCard: () => undefined,
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
      resolveCard: () => undefined,
      sections,
    })
    const allIds = Object.values(result).flat()
    expect(allIds).not.toContain('misfit-pw')
  })
})

// ─── applySectionInheritance — invariants ──────────────────────────────────

describe('applySectionInheritance - invariants', () => {
  it('removed ids purged from EVERY section (same id in two sections -> gone from both)', () => {
    const assignments = makeAssignments({
      creatures: ['dup-card', 'keeper-a'],
      spells: ['dup-card', 'keeper-b'],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'dup-card'),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      resolveCard: () => undefined,
      sections,
    })
    expect(result['creatures']).not.toContain('dup-card')
    expect(result['spells']).not.toContain('dup-card')
  })

  it('a card never appears in two buckets in the result', () => {
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

  it('cards already assigned but not in changes are preserved', () => {
    const assignments = makeAssignments({
      creatures: ['unchanged-1', 'unchanged-2'],
      spells: ['old-spell'],
    })
    const changes: CardChange[] = [
      makeChange('removed', 'old-spell'),
    ]
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, changes, {
      resolveCard: () => undefined,
      sections,
    })
    expect(result['creatures']).toContain('unchanged-1')
    expect(result['creatures']).toContain('unchanged-2')
  })

  it('empty changes -> result deep-equals assignments', () => {
    const assignments = makeAssignments({
      creatures: ['card-1', 'card-2'],
      spells: ['card-3'],
    })
    const sections = [makeSection('creatures', 'creatures'), makeSection('spells', 'spells')]
    const result = applySectionInheritance(assignments, [], {
      resolveCard: () => undefined,
      sections,
    })
    expect(result).toEqual(assignments)
  })

  it('result is a new reference (!== input assignments), immutability', () => {
    const assignments = makeAssignments({
      creatures: ['card-1'],
    })
    const sections = [makeSection('creatures', 'creatures')]
    const result = applySectionInheritance(assignments, [], {
      resolveCard: () => undefined,
      sections,
    })
    expect(result).not.toBe(assignments)
  })
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
 * buildSectionLabelMap (issue #16).
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
