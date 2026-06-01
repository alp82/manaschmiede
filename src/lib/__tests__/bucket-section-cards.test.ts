/**
 * RED tests — bucketSectionCards does not exist yet.
 * It must be exported from src/lib/deck-utils.ts (or a new src/lib/bucket-section-cards.ts
 * that deck-utils re-exports).
 *
 * Asserted signature:
 *
 *   interface BucketSectionCardsInput {
 *     deckDisplay: DeckDisplayCard[]          // DeckCard & { card: ScryfallCard }
 *     sections: DeckSection[]                 // from section-plan.ts
 *     sectionAssignments: Record<string, string[]>  // sectionId -> scryfallId[]
 *     lockedSource: Set<string>               // ids of locked (core) cards
 *     fallbackByType: boolean                 // when true, unassigned cards split by type
 *   }
 *
 *   bucketSectionCards(input: BucketSectionCardsInput): Record<string, DeckDisplayCard[]>
 *
 * The output always has at minimum:
 *   - 'core': cards whose scryfallId is in lockedSource
 *   - 'lands': land cards (by type_line) + explicitly assigned land cards
 *   - 'unassigned': everything not placed elsewhere (or split sub-buckets when fallbackByType)
 *   - one key per non-land section id present in `sections`
 *
 * DeckDisplayCard is defined here as a local type alias for tests.
 */
import { describe, it, expect } from 'vitest'
import { bucketSectionCards } from '../deck-utils'
import type { DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import type { DeckSection } from '../section-plan'

type DeckDisplayCard = DeckCard & { card: ScryfallCard }

function makeDisplay(
  scryfallId: string,
  type_line: string,
  oracle_text: string = '',
): DeckDisplayCard {
  return {
    scryfallId,
    quantity: 2,
    zone: 'main' as const,
    card: {
      id: scryfallId,
      name: scryfallId,
      lang: 'en',
      layout: 'normal',
      cmc: 2,
      type_line,
      oracle_text,
      color_identity: [],
      set: 'tst',
      set_name: 'Test',
      rarity: 'common',
      collector_number: '1',
      legalities: {},
    },
  }
}

function makeSection(id: string, role: DeckSection['role']): DeckSection {
  return { id, label: id, description: '', targetCount: 8, role, scryfallHints: [] }
}

describe('bucketSectionCards', () => {
  it('card in lockedSource -> "core" bucket regardless of section assignments', () => {
    const bolt = makeDisplay('bolt', 'Instant')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [bolt],
      sections: [makeSection('spells', 'spells')],
      sectionAssignments: { spells: ['bolt'] },
      lockedSource: new Set(['bolt']),
      fallbackByType: false,
    })
    expect(result['core']).toHaveLength(1)
    expect(result['core'][0].scryfallId).toBe('bolt')
    // Should NOT appear in spells bucket
    expect((result['spells'] ?? []).find((c) => c.scryfallId === 'bolt')).toBeUndefined()
  })

  it('card assigned via sectionAssignments -> placed in that section, NOT in "unassigned"', () => {
    const bolt = makeDisplay('bolt', 'Instant')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [bolt],
      sections: [makeSection('spells', 'spells')],
      sectionAssignments: { spells: ['bolt'] },
      lockedSource: new Set(),
      fallbackByType: false,
    })
    expect(result['spells']).toHaveLength(1)
    expect(result['spells'][0].scryfallId).toBe('bolt')
    expect((result['unassigned'] ?? []).find((c) => c.scryfallId === 'bolt')).toBeUndefined()
  })

  it('land (type_line includes "land") -> "lands" even without explicit assignment', () => {
    const forest = makeDisplay('forest', 'Basic Land — Forest')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [forest],
      sections: [],
      sectionAssignments: {},
      lockedSource: new Set(),
      fallbackByType: false,
    })
    expect(result['lands']).toHaveLength(1)
    expect(result['lands'][0].scryfallId).toBe('forest')
  })

  it('fallbackByType:true + empty plan -> creatures/spells/support split', () => {
    const elf = makeDisplay('elf', 'Creature — Elf')
    const bolt = makeDisplay('bolt', 'Instant')
    const armor = makeDisplay('armor', 'Artifact — Equipment')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [elf, bolt, armor],
      sections: [],
      sectionAssignments: {},
      lockedSource: new Set(),
      fallbackByType: true,
    })
    // Each card should end up in a typed bucket, NOT in a single 'unassigned' bucket
    const creatureBucket = result['creatures'] ?? result['fallback-creatures'] ?? []
    const spellBucket = result['spells'] ?? result['fallback-spells'] ?? []
    const supportBucket = result['support'] ?? result['fallback-support'] ?? []
    expect(creatureBucket.some((c) => c.scryfallId === 'elf')).toBe(true)
    expect(spellBucket.some((c) => c.scryfallId === 'bolt')).toBe(true)
    expect(supportBucket.some((c) => c.scryfallId === 'armor')).toBe(true)
  })

  it('fallbackByType:false + empty plan -> single "unassigned" bucket', () => {
    const elf = makeDisplay('elf', 'Creature — Elf')
    const bolt = makeDisplay('bolt', 'Instant')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [elf, bolt],
      sections: [],
      sectionAssignments: {},
      lockedSource: new Set(),
      fallbackByType: false,
    })
    expect(result['unassigned']).toHaveLength(2)
  })

  it('a card never appears in two buckets (assigned-set dedup)', () => {
    // Same scryfallId is in two sections' assignment lists AND in lockedSource
    const bolt = makeDisplay('bolt', 'Instant')
    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [bolt],
      sections: [makeSection('spells', 'spells'), makeSection('interaction', 'interaction')],
      sectionAssignments: { spells: ['bolt'], interaction: ['bolt'] },
      lockedSource: new Set(['bolt']),
      fallbackByType: false,
    })
    // Count total appearances across ALL buckets
    const total = Object.values(result).flat().filter((c) => c.scryfallId === 'bolt').length
    expect(total).toBe(1)
  })

  it('mixed scenario: core, assigned, land, and unassigned are all correctly separated', () => {
    const lockCard = makeDisplay('lockedCreature', 'Creature — Dragon')
    const assignedSpell = makeDisplay('assignedBolt', 'Instant')
    const landCard = makeDisplay('island', 'Basic Land — Island')
    const floater = makeDisplay('floater', 'Sorcery')

    const result: Record<string, DeckDisplayCard[]> = bucketSectionCards({
      deckDisplay: [lockCard, assignedSpell, landCard, floater],
      sections: [makeSection('spells', 'spells')],
      sectionAssignments: { spells: ['assignedBolt'] },
      lockedSource: new Set(['lockedCreature']),
      fallbackByType: false,
    })

    expect(result['core'].map((c) => c.scryfallId)).toContain('lockedCreature')
    expect(result['spells'].map((c) => c.scryfallId)).toContain('assignedBolt')
    expect(result['lands'].map((c) => c.scryfallId)).toContain('island')
    expect(result['unassigned'].map((c) => c.scryfallId)).toContain('floater')
  })
})
