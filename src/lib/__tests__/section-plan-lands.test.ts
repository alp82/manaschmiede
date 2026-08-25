import { describe, expect, it } from 'vitest'
import { deriveSectionPlan } from '../section-plan'
import {
  ARCHETYPE_LAND_COUNT,
  LAND_COUNT_RANGE,
  TARGET_DECK_SIZE,
  landCountForArchetype,
} from '../../../convex/lib/deckRules'
import { getTraitsByCategory } from '../trait-mappings'
import type { TFn } from '../i18n/types'

/**
 * The section plan is where the land count is actually decided — it is the one
 * of the three curve sources that ever changed an outcome (issue #45). These
 * tests pin the plan to `convex/lib/deckRules.ts`: whatever the plan allocates,
 * every land in it counts toward the archetype's target and the total stays
 * inside LAND_COUNT_RANGE.
 */

const t: TFn = (key) => key

const ARCHETYPES = Object.keys(ARCHETYPE_LAND_COUNT)
const COLOR_SETS: string[][] = [['G'], ['U', 'B'], ['W', 'U', 'B'], ['W', 'U', 'B', 'R', 'G']]

/** Every land the plan allocates, fixing sections included. */
function planLandCount(archetype: string, colors: string[], coreCardCount = 0): number {
  return deriveSectionPlan([archetype], [], coreCardCount, colors, t)
    .filter((section) => section.role === 'lands')
    .reduce((sum, section) => sum + section.targetCount, 0)
}

function planTotal(archetype: string, colors: string[], coreCardCount = 0): number {
  return (
    coreCardCount +
    deriveSectionPlan([archetype], [], coreCardCount, colors, t).reduce(
      (sum, section) => sum + section.targetCount,
      0,
    )
  )
}

describe('the archetype land table', () => {
  it('covers every archetype the wizard offers, and nothing else', () => {
    const selectable = getTraitsByCategory('archetype').map((trait) => trait.id)
    expect([...ARCHETYPES].sort()).toEqual([...selectable].sort())
  })
})

describe('section plan land budget', () => {
  it('keeps every archetype inside the shared land band', () => {
    for (const archetype of ARCHETYPES) {
      for (const colors of COLOR_SETS) {
        const lands = planLandCount(archetype, colors)
        expect(
          lands,
          `${archetype} / ${colors.length}C allocated ${lands} lands`,
        ).toBeGreaterThanOrEqual(LAND_COUNT_RANGE.min)
        expect(lands, `${archetype} / ${colors.length}C allocated ${lands} lands`).toBeLessThanOrEqual(
          LAND_COUNT_RANGE.max,
        )
      }
    }
  })

  it('hits the archetype target whatever the color count', () => {
    for (const archetype of ARCHETYPES) {
      for (const colors of COLOR_SETS) {
        expect(planLandCount(archetype, colors), `${archetype} / ${colors.length}C`).toBe(
          landCountForArchetype(archetype),
        )
      }
    }
  })

  it('counts fixing lands toward the target rather than adding to it', () => {
    // goodstuff ships its own fixing-lands section; every other archetype gets
    // the generic one. Both come out of the land budget, so more colors means
    // more fixing and fewer basics, not more lands.
    for (const archetype of ['goodstuff', 'midrange']) {
      const twoColor = deriveSectionPlan([archetype], [], 0, ['U', 'B'], t)
      const fiveColor = deriveSectionPlan([archetype], [], 0, ['W', 'U', 'B', 'R', 'G'], t)

      const fixingOf = (plan: typeof twoColor) =>
        plan.find((s) => s.id === 'mana-fixing-lands')?.targetCount ?? 0
      const basicsOf = (plan: typeof twoColor) =>
        plan.find((s) => s.id === 'lands')?.targetCount ?? 0

      expect(fixingOf(fiveColor), archetype).toBeGreaterThan(fixingOf(twoColor))
      expect(basicsOf(fiveColor), archetype).toBeLessThan(basicsOf(twoColor))
    }
  })

  it('gives a mono-color deck no fixing-lands section', () => {
    const plan = deriveSectionPlan(['goodstuff'], [], 0, ['G'], t)
    expect(plan.some((section) => section.id === 'mana-fixing-lands')).toBe(false)
  })

  it('plans exactly a full deck at every core size a deck can have', () => {
    // The plan is 60 cards before it is anything else. This runs the whole
    // range rather than a sample: the land section absorbs the mismatch, and a
    // floor that overrode it used to plan 62- and 68-card decks once the core
    // crowded the spell sections.
    for (const archetype of ARCHETYPES) {
      for (let coreCardCount = 0; coreCardCount <= 40; coreCardCount++) {
        expect(
          planTotal(archetype, ['U', 'B'], coreCardCount),
          `${archetype} / core ${coreCardCount}`,
        ).toBe(TARGET_DECK_SIZE)
      }
    }
  })

  it('lets the lands dip below the band rather than plan more than 60', () => {
    // A core this crowded leaves less room than the band wants. The deck stays
    // 60 cards and the land count gives way — see ADR-0005.
    expect(planTotal('aggro', ['U', 'B'], 40)).toBe(TARGET_DECK_SIZE)
    expect(planLandCount('aggro', ['U', 'B'], 40)).toBeLessThan(LAND_COUNT_RANGE.min)
  })

  it('holds the band for any core that leaves room for it', () => {
    for (const archetype of ARCHETYPES) {
      for (let coreCardCount = 0; coreCardCount <= 20; coreCardCount++) {
        expect(
          planLandCount(archetype, ['U', 'B'], coreCardCount),
          `${archetype} / core ${coreCardCount}`,
        ).toBeGreaterThanOrEqual(LAND_COUNT_RANGE.min)
      }
    }
  })
})
