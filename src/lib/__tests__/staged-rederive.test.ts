/**
 * RED tests — deriveStagedPlan and structuralFieldsChanged do NOT exist yet.
 * Both must be exported from src/lib/use-staged-rederive.ts (M2 implementer).
 *
 * Asserted signatures:
 *
 *   interface StagedSection extends DeckSection {
 *     bucketedCards: string[]   // scryfallIds bucketed into this lane
 *     deficit: number           // max(0, targetCount - bucketedCards.length)
 *   }
 *
 *   interface StagedPlan {
 *     sections: StagedSection[]
 *     unassigned: string[]      // scryfallIds that fit no named lane
 *     staleLaneIds: string[]    // ids of lanes whose target or bucket changed
 *   }
 *
 *   deriveStagedPlan(
 *     deckCards: DeckDisplayCard[],
 *     intent: { archetypes: string[]; colors: string[] },
 *     t: Translate,
 *     previousPlan?: StagedPlan,
 *   ): StagedPlan
 *
 *   structuralFieldsChanged(before: DeckIntent, after: DeckIntent): boolean
 *
 * NOTE — M2 UI behaviors are MANUAL/visual and verified in the final review,
 * not in this file:
 *   - single-surface render (deck sections + staged plan on one screen)
 *   - collapsible strip UI
 *   - staged Accept/Discard layer
 *   - stale-lane dimming
 *   - re-derive fires only on structural intent changes
 *
 * This file covers the pure computational cores only.
 *
 * Fixture ground truth:
 *   Aggro template sections (from section-plan.ts TEMPLATES.aggro):
 *     'aggressive-creatures' (role: creatures, weight 16)
 *     'burn-tricks'          (role: spells,    weight 6)
 *     'removal'              (role: interaction, weight 4)
 *   landCount: 22
 *   With coreCardCount=12, mono-color (['R']):
 *     availableSlots = max(60-12-22, 3*2) = 26
 *     totalWeight = 16+6+4 = 26
 *     aggressive-creatures targetCount = round(16/26*26) = 16
 *     burn-tricks          targetCount = round(6/26*26)  = 6
 *     removal              targetCount = 26-16-6         = 4  (last, absorbs remainder)
 *     lands actualLandCount = max(60-(12+26), 18) = 22
 *     total: 12+16+6+4+22 = 60 ✓
 *   With coreCardCount=3 (wrong: distinct-count bug):
 *     availableSlots = max(60-3-22, 6) = 35
 *     aggressive-creatures = round(16/26*35) = 22  ← DIFFERS from 16 → discriminates the bug
 */

import { describe, it, expect } from 'vitest'
import {
  deriveStagedPlan,
  bucketPlanAgainstCards,
  rebucketAssignments,
  structuralFieldsChanged,
  plansEqual,
  computeStaleLanes,
  refillCountFor,
} from '../use-staged-rederive'
import type { StagedPlan, StagedSection } from '../use-staged-rederive'
import type { DeckDisplayCard } from '../deck-utils'
import type { DeckIntent } from '../deck-intent'
import type { ScryfallCard } from '../scryfall/types'

// ─── Fixtures & helpers ──────────────────────────────────────────────────────

/** Identity translate — returns the key unchanged, satisfying the Translate signature. */
function stubT(key: string): string {
  return key
}

/**
 * Build a DeckDisplayCard with the minimal ScryfallCard stub needed for
 * type-based bucketing (bucketSectionCards reads d.card.type_line).
 * Mirrors the fixture style from bucket-section-cards.test.ts.
 */
function makeDeckDisplayCard(
  scryfallId: string,
  quantity: number,
  type_line: string,
  oracle_text: string = '',
  locked: boolean = false,
): DeckDisplayCard {
  return {
    scryfallId,
    quantity,
    zone: 'main' as const,
    ...(locked ? { locked: true } : {}),
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

/**
 * Three locked core cards, each quantity:4 → 12 locked copies.
 * Mono-R aggro archetype; no combo so no mana-fixing section.
 * type_line: Creature (any type is fine for core — they are locked, not type-routed)
 */
function makeMonoRAggroCore(): DeckDisplayCard[] {
  return [
    makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
    makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
    makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
  ]
}

const MONO_R_AGGRO_INTENT = {
  archetypes: ['aggro'] as string[],
  colors: ['R'] as string[],
}

// ─── deriveStagedPlan — coreCardCount basis (BLOCKER 1 guard) ───────────────

describe('deriveStagedPlan - coreCardCount basis (BLOCKER 1 guard)', () => {
  it('TC-1: 3 distinct locked cards qty:4 (=12 copies) → aggressive-creatures targetCount 16 (not 22 from wrong core=3)', () => {
    const deckCards = makeMonoRAggroCore()
    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)

    const aggroSection = plan.sections.find((s) => s.id === 'aggressive-creatures')
    expect(aggroSection).toBeDefined()
    // coreCardCount=12 (4+4+4) → availableSlots=26 → aggressive-creatures=round(16/26*26)=16
    // coreCardCount=3 (distinct count — the bug) → availableSlots=35 → aggressive-creatures=round(16/26*35)=22
    // So 16 ONLY passes when coreCardCount was correctly summed as 12, not the buggy 3.
    expect(aggroSection!.targetCount).toBe(16)
  })
})

// ─── deriveStagedPlan — 60-card invariant (scoped fixture only) ──────────────

describe('deriveStagedPlan - 60-card invariant (scoped fixture only)', () => {
  /**
   * TC-2a: for the specific mono-R aggro 3-core(qty4) fixture, all sections
   * (including lands) plus the core count must sum to exactly 60.
   * This directly catches the BLOCKER-1 under-count bug (core=3 → overflow).
   *
   * NOTE (TC-2b, MANUAL): multi-archetype or floor-binding plans can exceed 60
   * in pathological combinations — that case is out of scope for this file.
   */
  it('TC-2a: 12 locked copies + all non-land targetCounts + land targetCount === 60 (BLOCKER-1 catch)', () => {
    const deckCards = makeMonoRAggroCore()
    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)

    const coreCardCount = deckCards.reduce((sum, c) => sum + c.quantity, 0) // 12
    const sectionTotal = plan.sections.reduce((sum, s) => sum + s.targetCount, 0)

    expect(coreCardCount + sectionTotal).toBe(60)
  })
})

// ─── deriveStagedPlan — non-destructive bucketing (decision 3) ───────────────

describe('deriveStagedPlan - non-destructive bucketing (decision 3)', () => {
  /**
   * TC-3: every non-locked card ends up somewhere — no non-locked card is dropped.
   *   3 locked core cards           (type_line: Creature — locked, go to 'core' bucket, NOT role lanes)
   *   4 section creatures           (type_line: Creature — routed to aggressive-creatures)
   *   2 section instants            (type_line: Instant  — routed to burn-tricks or removal)
   *   1 role-mismatch misfit        (type_line: Planeswalker — has no role in the aggro plan → unassigned)
   * Total distinct: 10 (3 locked + 7 non-locked)
   * Locked cards go to the 'core' bucket inside bucketSectionCards — they are NOT
   * in plan.sections[*].bucketedCards (render-consistent: deficit is non-core only).
   * The 7 non-locked ids must appear exactly once across sections + unassigned.
   * The misfit must land in unassigned, not a named lane.
   * No id may appear in two buckets.
   */
  it('TC-3: all 7 non-locked scryfallIds appear exactly once across sections + unassigned; locked cards excluded from role lanes', () => {
    const deckCards: DeckDisplayCard[] = [
      // 3 locked core cards — go to 'core' bucket, NOT role lanes
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
      // 4 creatures → aggressive-creatures lane (role: creatures)
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-3', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-4', 2, 'Creature — Goblin'),
      // 2 instants → burn-tricks or removal lane (role: spells / interaction)
      makeDeckDisplayCard('instant-1', 2, 'Instant'),
      makeDeckDisplayCard('instant-2', 2, 'Instant'),
      // 1 misfit → unassigned (Planeswalker type has no role in pickSectionForCard → preferredRoles=[] → null → unassigned)
      makeDeckDisplayCard('misfit-1', 1, 'Planeswalker — Chandra', '+1: Deal 1 damage.'),
    ]

    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)

    // Collect every id from every section bucket + unassigned (role lanes + unassigned only)
    const allBucketedIds: string[] = []
    for (const section of plan.sections) {
      allBucketedIds.push(...section.bucketedCards)
    }
    allBucketedIds.push(...plan.unassigned)

    // Locked core cards must NOT appear in role lanes or unassigned (they're in the core bucket)
    expect(allBucketedIds).not.toContain('core-1')
    expect(allBucketedIds).not.toContain('core-2')
    expect(allBucketedIds).not.toContain('core-3')

    // Every NON-locked, non-land scryfallId + misfit must appear exactly once
    const nonLockedIds = deckCards.filter((c) => !c.locked).map((c) => c.scryfallId)
    for (const id of nonLockedIds) {
      const count = allBucketedIds.filter((b) => b === id).length
      expect(count).toBe(1)
    }
    expect(allBucketedIds.length).toBe(7)

    // misfit must be in unassigned
    expect(plan.unassigned).toContain('misfit-1')
  })
})

// ─── deriveStagedPlan — deficit math (decision 8) ────────────────────────────

describe('deriveStagedPlan - deficit math (decision 8)', () => {
  /**
   * TC-4: a lane with targetCount 16 and 5 bucketed non-locked cards → deficit 11.
   * coreCardCount=12 (3 locked × qty4) → aggressive-creatures targetCount=16.
   * 5 non-locked creatures bucketed → deficit = 16 - 5 = 11.
   * The 3 locked core creatures share the same creature role but must NOT count
   * toward the role-lane bucketed count (render-consistency: locked cards are in
   * the core bucket, not the role lane). deficit=11, NOT 8 (8 = 16 - 5 - 3 is wrong).
   *
   * Regression: before the fix, lockedSource=new Set() let locked cards fall into
   * the role lane → bucketedCards.length=8 → deficit=8 (wrong, too low).
   */
  it('TC-4: mono-R aggro, 3 locked core creatures + 5 non-locked creatures → deficit 11 (locked excluded from lane)', () => {
    const deckCards: DeckDisplayCard[] = [
      // 3 locked core creatures — same role as aggressive-creatures, but locked → core bucket
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
      // 5 non-locked creatures → aggressive-creatures lane
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-3', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-4', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-5', 2, 'Creature — Goblin'),
    ]
    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)
    const lane = plan.sections.find((s) => s.id === 'aggressive-creatures')
    expect(lane).toBeDefined()
    // targetCount must be 16 (coreCardCount=12 → correct)
    expect(lane!.targetCount).toBe(16)
    // Only the 5 non-locked creatures are in the lane (locked go to core bucket)
    expect(lane!.bucketedCards).toHaveLength(5)
    // deficit = 16 - 5 = 11 (NOT 8 which would be wrong: 16 - 5 - 3 locked)
    expect(lane!.deficit).toBe(11)
  })

  /**
   * TC-4b: lane targetCount exactly equal to bucketed count → deficit 0.
   */
  it('TC-4b: exactly-filled lane → deficit 0', () => {
    // Fill aggressive-creatures exactly to its targetCount (16 for core=12 aggro).
    // Use 16 creature cards (each qty:1 so they are distinct, each scryfallId unique).
    const deckCards: DeckDisplayCard[] = [
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
    ]
    for (let i = 0; i < 16; i++) {
      deckCards.push(makeDeckDisplayCard(`creature-fill-${i}`, 1, 'Creature — Goblin'))
    }
    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)
    const lane = plan.sections.find((s) => s.id === 'aggressive-creatures')
    expect(lane).toBeDefined()
    expect(lane!.deficit).toBe(0)
  })

  /**
   * TC-4c: over-filled lane (more bucketed than target) → deficit floors at 0,
   * never negative. This documents the floor-at-0 intent.
   * Use burn-tricks lane (targetCount=6 for core=12). Over-fill with 8 instants.
   */
  it('TC-4c: over-filled lane (8 instants bucketed, targetCount 6 → deficit 0, not negative)', () => {
    const deckCards: DeckDisplayCard[] = [
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
    ]
    // 8 instants so burn-tricks (targetCount=6) has more bucketed than target
    for (let i = 0; i < 8; i++) {
      deckCards.push(makeDeckDisplayCard(`instant-over-${i}`, 1, 'Instant'))
    }
    const plan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)
    const lane = plan.sections.find((s) => s.id === 'burn-tricks')
    expect(lane).toBeDefined()
    // deficit must be >= 0, never negative
    expect(lane!.deficit).toBeGreaterThanOrEqual(0)
  })
})

// ─── deriveStagedPlan — staleLaneIds ─────────────────────────────────────────

describe('deriveStagedPlan - staleLaneIds', () => {
  /**
   * TC-5a: a lane whose targetCount changed (re-derived with different coreCardCount)
   * appears in staleLaneIds.
   */
  it('TC-5a: lane with changed targetCount appears in staleLaneIds', () => {
    const deckCardsFirst = makeMonoRAggroCore() // coreCardCount=12 → aggro-creatures target=16
    const firstPlan = deriveStagedPlan(deckCardsFirst, MONO_R_AGGRO_INTENT, stubT)

    // Add 4 more locked cards (total distinct=4 locked × qty4 = 16 core copies)
    const deckCardsSecond: DeckDisplayCard[] = [
      ...makeMonoRAggroCore(),
      makeDeckDisplayCard('core-4', 4, 'Creature — Goblin', '', true),
    ]
    // coreCardCount=16 → availableSlots=max(60-16-22,6)=22
    // aggressive-creatures = round(16/26*22) = round(13.5) = 14 (changed from 16)
    const secondPlan = deriveStagedPlan(deckCardsSecond, MONO_R_AGGRO_INTENT, stubT, firstPlan)

    expect(secondPlan.staleLaneIds).toContain('aggressive-creatures')
  })

  /**
   * TC-5b: a lane with unchanged targetCount AND unchanged bucketed cards
   * does NOT appear in staleLaneIds.
   */
  it('TC-5b: unchanged lane (same target, same bucket) does not appear in staleLaneIds', () => {
    const deckCards = makeMonoRAggroCore()
    const firstPlan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT)
    // Re-derive with identical input → nothing changed
    const secondPlan = deriveStagedPlan(deckCards, MONO_R_AGGRO_INTENT, stubT, firstPlan)

    // No lane should be stale if nothing changed
    expect(secondPlan.staleLaneIds).toHaveLength(0)
  })

  /**
   * TC-5c: a lane that becomes newly under-filled (same target, fewer cards re-bucket)
   * appears in staleLaneIds.
   */
  it('TC-5c: lane newly under-filled (fewer bucketed cards) appears in staleLaneIds', () => {
    // First plan: 4 creature cards in aggressive-creatures
    const deckCardsFirst: DeckDisplayCard[] = [
      ...makeMonoRAggroCore(),
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-3', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-4', 2, 'Creature — Goblin'),
    ]
    const firstPlan = deriveStagedPlan(deckCardsFirst, MONO_R_AGGRO_INTENT, stubT)

    // Second plan: only 2 creature cards (2 removed)
    const deckCardsSecond: DeckDisplayCard[] = [
      ...makeMonoRAggroCore(),
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
    ]
    const secondPlan = deriveStagedPlan(deckCardsSecond, MONO_R_AGGRO_INTENT, stubT, firstPlan)

    expect(secondPlan.staleLaneIds).toContain('aggressive-creatures')
  })
})

// ─── rebucketAssignments (extracted pure core) ───────────────────────────────

describe('rebucketAssignments', () => {
  /**
   * Minimal ScryfallCard stub factory for rebucketAssignments tests.
   * pickSectionForCard only reads `type_line` and `oracle_text`.
   */
  function makeCard(id: string, type_line: string, oracle_text = ''): ScryfallCard {
    return {
      id,
      name: id,
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
    }
  }

  /** Aggro plan sections for rebucket tests (matches TC fixtures). */
  const AGGRO_PLAN = [
    { id: 'aggressive-creatures', role: 'creatures' as const, label: 'Creatures', description: '', targetCount: 16, weight: 16, scryfallHints: [] },
    { id: 'burn-tricks', role: 'spells' as const, label: 'Burn', description: '', targetCount: 6, weight: 6, scryfallHints: [] },
    { id: 'removal', role: 'interaction' as const, label: 'Removal', description: '', targetCount: 4, weight: 4, scryfallHints: [] },
    { id: 'lands', role: 'lands' as const, label: 'Lands', description: '', targetCount: 22, weight: 0, scryfallHints: [] },
  ]

  /**
   * TC-R1: a card whose role maps to a new-plan lane lands in that lane.
   */
  it('TC-R1: creature card maps to aggressive-creatures lane', () => {
    const creatureCard = makeCard('creature-a', 'Creature — Goblin')
    const resolveCard = (id: string) => id === 'creature-a' ? creatureCard : undefined
    const prevAssignments = { 'old-creatures': ['creature-a'] }
    const result = rebucketAssignments(prevAssignments, AGGRO_PLAN, resolveCard)
    expect(result['aggressive-creatures']).toContain('creature-a')
  })

  /**
   * TC-R2: a card whose role has NO lane in the new plan is dropped.
   * Planeswalker type → preferredRoles=[] → pickSectionForCard returns null → dropped.
   */
  it('TC-R2: card with no matching role in the new plan is dropped', () => {
    const planeswalkerCard = makeCard('misfit-a', 'Planeswalker — Chandra', '+1: Deal 1 damage.')
    const resolveCard = (id: string) => id === 'misfit-a' ? planeswalkerCard : undefined
    const prevAssignments = { 'old-section': ['misfit-a'] }
    const result = rebucketAssignments(prevAssignments, AGGRO_PLAN, resolveCard)
    // The card should not appear in any bucket
    for (const ids of Object.values(result)) {
      expect(ids).not.toContain('misfit-a')
    }
  })

  /**
   * TC-R3: duplicate ids across old buckets de-dupe (first wins).
   */
  it('TC-R3: duplicate ids across old buckets are de-duped (first wins)', () => {
    const creatureCard = makeCard('creature-dup', 'Creature — Goblin')
    const resolveCard = (id: string) => id === 'creature-dup' ? creatureCard : undefined
    // Same id appears in two old buckets
    const prevAssignments = {
      'old-a': ['creature-dup'],
      'old-b': ['creature-dup'],
    }
    const result = rebucketAssignments(prevAssignments, AGGRO_PLAN, resolveCard)
    // Must appear exactly once in the result
    const allIds = Object.values(result).flat()
    const count = allIds.filter((id) => id === 'creature-dup').length
    expect(count).toBe(1)
  })

  /**
   * TC-R4: nextPlan.length === 0 → returns prevAssignments unchanged (the guard).
   */
  it('TC-R4: empty nextPlan → returns prevAssignments unchanged', () => {
    const prevAssignments = { 'some-section': ['card-a', 'card-b'] }
    const resolveCard = (_id: string) => undefined
    const result = rebucketAssignments(prevAssignments, [], resolveCard)
    expect(result).toBe(prevAssignments) // same reference, not a copy
  })
})

// ─── structuralFieldsChanged (pure structural-vs-soft detector) ──────────────

describe('structuralFieldsChanged (pure structural-vs-soft detector)', () => {
  function makeIntent(overrides: Partial<DeckIntent> = {}): DeckIntent {
    return {
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'unselected' },
      archetypes: ['aggro'],
      traits: [],
      customStrategy: '',
      budgetMin: null,
      budgetMax: null,
      rarityFilter: ['common', 'uncommon', 'rare', 'mythic'],
      ...overrides,
    }
  }

  /**
   * TC-6a: a committed-color change (R → R+G) is structural → true.
   * This guards decision 2: structural-only triggers a re-derive.
   */
  it('TC-6a: committed-color change (R → R+G) → true', () => {
    const before = makeIntent()
    const after = makeIntent({
      colors: { W: 'unselected', U: 'unselected', B: 'unselected', R: 'selected', G: 'selected' },
    })
    expect(structuralFieldsChanged(before, after)).toBe(true)
  })

  /**
   * TC-6b: an archetype change (['aggro'] → ['midrange']) is structural → true.
   */
  it("TC-6b: archetype change (['aggro'] → ['midrange']) → true", () => {
    const before = makeIntent()
    const after = makeIntent({ archetypes: ['midrange'] })
    expect(structuralFieldsChanged(before, after)).toBe(true)
  })

  /**
   * TC-6c: soft-only change (customStrategy / budgetMax / rarityFilter / traits)
   * with identical committed colors and archetypes → false.
   * Soft changes must NOT trigger a re-derive.
   */
  it('TC-6c: soft-only changes (customStrategy, budgetMax, rarityFilter, traits) → false', () => {
    const before = makeIntent()
    const after = makeIntent({
      // Structural fields (colors, archetypes) are unchanged.
      // Only soft fields change:
      customStrategy: 'Play fast and wide',
      budgetMax: 5.0,
      rarityFilter: ['common', 'uncommon'],
      traits: ['tribal'],
    })
    expect(structuralFieldsChanged(before, after)).toBe(false)
  })
})

// ─── plansEqual (no-op re-derive guard) ──────────────────────────────────────

describe('plansEqual (no-op re-derive guard)', () => {
  const PLAN_A = [
    { id: 'creatures', role: 'creatures' as const, label: 'Creatures', description: '', targetCount: 16, weight: 16, scryfallHints: [] },
    { id: 'spells',   role: 'spells' as const,    label: 'Spells',    description: '', targetCount: 6,  weight: 6,  scryfallHints: [] },
    { id: 'lands',    role: 'lands' as const,     label: 'Lands',     description: '', targetCount: 22, weight: 0,  scryfallHints: [] },
  ]

  it('TC-PE1: identical plans → true', () => {
    const planB = PLAN_A.map((s) => ({ ...s }))
    expect(plansEqual(PLAN_A, planB)).toBe(true)
  })

  it('TC-PE2: different targetCount on one section → false', () => {
    const planB = PLAN_A.map((s) => s.id === 'creatures' ? { ...s, targetCount: 14 } : { ...s })
    expect(plansEqual(PLAN_A, planB)).toBe(false)
  })

  it('TC-PE3: different number of sections → false', () => {
    const planB = PLAN_A.slice(0, 2)
    expect(plansEqual(PLAN_A, planB)).toBe(false)
  })

  it('TC-PE4: same counts but different section ids → false', () => {
    const planB = PLAN_A.map((s, i) => ({ ...s, id: `section-${i}` }))
    expect(plansEqual(PLAN_A, planB)).toBe(false)
  })

  it('TC-PE5: both empty → true', () => {
    expect(plansEqual([], [])).toBe(true)
  })
})

// ─── bucketPlanAgainstCards — rehydration path (G2) ──────────────────────────

describe('bucketPlanAgainstCards - rehydration path (G2: persisted plan, not freshly derived)', () => {
  /**
   * An explicit persisted plan (DeckSection[] as stored in the pending slot) is
   * passed directly to `bucketPlanAgainstCards`, bypassing `deriveStagedPlan`.
   * This is the persistence-rehydration path: the plan is already known; we only
   * need to re-bucket the current display cards against it.
   *
   * Asserted:
   * - Locked cards are excluded from role-lane bucketed counts (M2 double-count fix)
   *   → they land in the 'core' bucket, NOT in `sections[*].bucketedCards`.
   * - Deficits are computed from non-core (non-locked) bucketed cards only.
   * - Misfits (no role lane) land in `unassigned`.
   */
  const PERSISTED_PLAN = [
    { id: 'aggressive-creatures', role: 'creatures' as const, label: 'Creatures', description: '', targetCount: 16, scryfallHints: [] },
    { id: 'burn-tricks', role: 'spells' as const, label: 'Burn', description: '', targetCount: 6, scryfallHints: [] },
    { id: 'removal', role: 'interaction' as const, label: 'Removal', description: '', targetCount: 4, scryfallHints: [] },
    { id: 'lands', role: 'lands' as const, label: 'Lands', description: '', targetCount: 22, scryfallHints: [] },
  ]

  it('G2-a: locked cards are excluded from role-lane bucketedCards (M2 double-count fix)', () => {
    const deckCards: DeckDisplayCard[] = [
      // 3 locked core creatures — same role as aggressive-creatures, must go to core bucket
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
      // 5 non-locked creatures
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-3', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-4', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-5', 2, 'Creature — Goblin'),
    ]
    const result = bucketPlanAgainstCards(deckCards, PERSISTED_PLAN)
    const lane = result.sections.find((s) => s.id === 'aggressive-creatures')
    expect(lane).toBeDefined()
    // Locked cards must NOT be in the role lane
    expect(lane!.bucketedCards).not.toContain('core-1')
    expect(lane!.bucketedCards).not.toContain('core-2')
    expect(lane!.bucketedCards).not.toContain('core-3')
    // Only the 5 non-locked creatures are bucketed
    expect(lane!.bucketedCards).toHaveLength(5)
  })

  it('G2-b: deficit computed from non-core (non-locked) bucketed cards only', () => {
    const deckCards: DeckDisplayCard[] = [
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-2', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('core-3', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('creature-1', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-2', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-3', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-4', 2, 'Creature — Goblin'),
      makeDeckDisplayCard('creature-5', 2, 'Creature — Goblin'),
    ]
    const result = bucketPlanAgainstCards(deckCards, PERSISTED_PLAN)
    const lane = result.sections.find((s) => s.id === 'aggressive-creatures')
    expect(lane).toBeDefined()
    // targetCount=16, 5 non-locked bucketed → deficit=11 (NOT 8 if locked incorrectly counted)
    expect(lane!.deficit).toBe(11)
  })

  it('G2-c: misfits (Planeswalker) land in unassigned', () => {
    const deckCards: DeckDisplayCard[] = [
      makeDeckDisplayCard('core-1', 4, 'Creature — Goblin', '', true),
      makeDeckDisplayCard('misfit-1', 1, 'Planeswalker — Chandra', '+1: Deal 1 damage.'),
    ]
    const result = bucketPlanAgainstCards(deckCards, PERSISTED_PLAN)
    expect(result.unassigned).toContain('misfit-1')
    for (const section of result.sections) {
      expect(section.bucketedCards).not.toContain('misfit-1')
    }
  })

  it('G2-d: staleLaneIds empty when no previousPlan provided', () => {
    const deckCards = makeMonoRAggroCore()
    const result = bucketPlanAgainstCards(deckCards, PERSISTED_PLAN)
    expect(result.staleLaneIds).toHaveLength(0)
  })
})

// ─── refillCountFor — decision 5 deficit math ────────────────────────────────

/**
 * Decision 5: "a stale lane's re-fill targets the STAGED plan's new targetCount
 * minus re-bucketed cards" — i.e. the lane's deficit, and nothing else.
 *
 * Regression: the original `refillLane` read
 *   `const needed = deficit > 0 ? deficit : section.targetCount`
 * so a lane made stale by a SHRINKING target (deficit 0, already over-filled)
 * asked the AI for a WHOLE targetCount MORE cards — the inverse of the
 * specified math, and a direct feed into the over-60 problem the warn decision
 * was meant to bound. `null` means "nothing to re-fill": don't send, don't
 * offer the prompt.
 */
describe('refillCountFor (decision 5 - a stale lane re-fills to its DEFICIT)', () => {
  it('TC-RF1: deficit 11 → requests exactly 11', () => {
    expect(refillCountFor(11)).toBe(11)
  })

  it('TC-RF2: deficit 1 → requests exactly 1', () => {
    expect(refillCountFor(1)).toBe(1)
  })

  it('TC-RF3: deficit 0 (lane at its new target) → null, nothing to re-fill', () => {
    expect(refillCountFor(0)).toBeNull()
  })

  it('TC-RF4: a lane made stale by a SHRINKING target has deficit 0 → null, never targetCount', () => {
    const lane = (targetCount: number, bucketed: string[]): StagedSection => ({
      id: 'burn-tricks',
      label: 'Burn',
      description: '',
      targetCount,
      role: 'spells',
      scryfallHints: [],
      bucketedCards: bucketed,
      deficit: Math.max(0, targetCount - bucketed.length),
    })
    const bucketed = Array.from({ length: 12 }, (_, i) => `spell-${i}`)
    const previousPlan: StagedPlan = {
      sections: [lane(12, bucketed)],
      unassigned: [],
      staleLaneIds: [],
    }
    const shrunk = lane(8, bucketed)

    // The lane IS stale (its target changed) but has nothing to fill.
    expect(computeStaleLanes([shrunk], previousPlan)).toContain('burn-tricks')
    expect(shrunk.deficit).toBe(0)
    expect(refillCountFor(shrunk.deficit)).toBeNull()
    expect(refillCountFor(shrunk.deficit)).not.toBe(shrunk.targetCount)
  })
})
