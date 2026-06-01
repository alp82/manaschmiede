/**
 * Tests for the addCard composition used in src/routes/deck/$id.tsx.
 *
 * The route's addCard callback is not exported, so we reproduce its pure logic
 * here against the real exported primitives — mergeCardsIntoDeck and
 * pickSectionForCard — to pin the contract of how they compose:
 *
 *   1. mergeCardsIntoDeck produces { merged, addedIds }
 *   2. If addedIds.includes(card.id) AND plan.length > 0:
 *        sectionId = pickSectionForCard(card, plan)
 *        if sectionId and card.id not already in that section:
 *          sectionAssignments[sectionId] gains card.id
 *   3. Otherwise sectionAssignments is left untouched.
 *
 * A regression in either primitive's contract (e.g. addedIds no longer
 * populated when qty rises, or pickSectionForCard returns wrong id) will
 * surface here.
 */
import { describe, it, expect } from 'vitest'
import { mergeCardsIntoDeck, type DeckCard } from '../deck-utils'
import { pickSectionForCard, type DeckSection } from '../section-plan'
import type { ScryfallCard } from '../scryfall/types'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeCard(
  id: string,
  type_line: string,
  oracle_text: string = '',
): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line,
    oracle_text,
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function makeDeckCard(
  scryfallId: string,
  quantity: number,
  locked?: boolean,
): DeckCard {
  const c: DeckCard = { scryfallId, quantity, zone: 'main' }
  if (locked !== undefined) c.locked = locked
  return c
}

/** Full plan used in tests that need an assignment to land somewhere. */
function fullPlan(): DeckSection[] {
  const roles: DeckSection['role'][] = ['creatures', 'spells', 'support', 'interaction', 'lands']
  return roles.map((role, i) => ({
    id: `section-${i}`,
    label: role,
    description: '',
    targetCount: 8,
    role,
    scryfallHints: [],
  }))
}

/** The pure composition mirroring the route's addCard state-updater. */
function applyAddCard(
  existingCards: DeckCard[],
  card: ScryfallCard,
  sectionPlan: DeckSection[],
  sectionAssignments: Record<string, string[]>,
  isBasicLandId: (id: string) => boolean = () => false,
): {
  merged: DeckCard[]
  sectionAssignments: Record<string, string[]>
  addedIds: string[]
} {
  const { merged, addedIds } = mergeCardsIntoDeck(
    existingCards,
    [{ scryfallId: card.id, quantity: 1 }],
    isBasicLandId,
  )

  let nextAssignments = sectionAssignments
  if (addedIds.includes(card.id) && sectionPlan.length > 0) {
    const sectionId = pickSectionForCard(card, sectionPlan)
    if (sectionId) {
      const current = nextAssignments[sectionId] ?? []
      if (!current.includes(card.id)) {
        nextAssignments = { ...nextAssignments, [sectionId]: [...current, card.id] }
      }
    }
  }

  return { merged, sectionAssignments: nextAssignments, addedIds }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('addCard composition — mergeCardsIntoDeck + pickSectionForCard', () => {
  it('card already at 4 copies: addedIds is empty → sectionAssignments is NOT mutated', () => {
    const plan = fullPlan()
    const card = makeCard('bolt', 'Instant', 'Deal 3 damage to any target.')
    const existingCards = [makeDeckCard('bolt', 4)]
    const assignments: Record<string, string[]> = {}

    const { addedIds, sectionAssignments } = applyAddCard(
      existingCards,
      card,
      plan,
      assignments,
    )

    // The 4-copy cap means the card was NOT added.
    expect(addedIds).not.toContain('bolt')
    // sectionAssignments must remain the same object / same shape — no phantom entry.
    expect(sectionAssignments).toEqual({})
  })

  it('new card added: addedIds includes it → correct section gains the card id', () => {
    const plan = fullPlan()
    // A creature card should map to the "creatures" role section (section-0 in fullPlan).
    const card = makeCard('elf', 'Creature — Elf')
    const existingCards: DeckCard[] = []
    const assignments: Record<string, string[]> = {}

    const { addedIds, sectionAssignments, merged } = applyAddCard(
      existingCards,
      card,
      plan,
      assignments,
    )

    expect(addedIds).toContain('elf')
    expect(merged).toHaveLength(1)

    // pickSectionForCard maps Creature → role "creatures" → section-0
    const creaturesSection = plan.find((s) => s.role === 'creatures')!
    expect(sectionAssignments[creaturesSection.id]).toContain('elf')
  })

  it('locked card: mergeCardsIntoDeck does not increase qty → addedIds empty → sectionAssignments unchanged', () => {
    const plan = fullPlan()
    const card = makeCard('bolt', 'Instant', 'Deal 3 damage.')
    // Existing entry is locked at 2 copies.
    const existingCards = [makeDeckCard('bolt', 2, true)]
    const assignments: Record<string, string[]> = { 'section-3': ['bolt'] }

    const { addedIds, merged, sectionAssignments } = applyAddCard(
      existingCards,
      card,
      plan,
      assignments,
    )

    // Locked entry must not be modified.
    expect(merged[0].quantity).toBe(2)
    expect(addedIds).not.toContain('bolt')
    // Assignments must remain exactly as passed in — no new entries, no removals.
    expect(sectionAssignments).toEqual({ 'section-3': ['bolt'] })
  })

  it('card added but no section plan (empty sections): pickSectionForCard returns null → no assignment written, no crash', () => {
    const card = makeCard('elf', 'Creature — Elf')
    const existingCards: DeckCard[] = []
    const assignments: Record<string, string[]> = {}

    // Empty plan — pickSectionForCard will return null for every card.
    const { addedIds, sectionAssignments, merged } = applyAddCard(
      existingCards,
      card,
      [],
      assignments,
    )

    // Card was genuinely added.
    expect(addedIds).toContain('elf')
    expect(merged).toHaveLength(1)
    // No assignment should have been written since plan is empty.
    expect(sectionAssignments).toEqual({})
  })
})
