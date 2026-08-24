import { useMemo } from 'react'
import {
  deriveSectionPlan,
  localizeDeckSection,
  type DeckSection,
} from './section-plan'
import {
  bucketSectionCards,
  type BucketSectionCardsInput,
  type DeckCard,
  type DeckDisplayCard,
} from './deck-utils'
import type { ScryfallCard } from './scryfall/types'
import type { SectionLaneDescriptor } from '../components/deck/SectionLane'
import type { TFn } from './i18n/types'

interface DeriveArgs {
  archetypes: string[]
  traits: string[]
  coreCardCount: number
  colors: string[]
}

interface UseSectionsArgs {
  sectionPlan: DeckSection[]
  t: TFn
  /**
   * When the persisted plan is empty, derive one from these inputs (the
   * wizard's first render). Omit on the deck view, which always has a
   * persisted plan and should render an empty list when it doesn't.
   */
  deriveArgs?: DeriveArgs
  /**
   * A transient staged (re-derived) plan that takes precedence over the
   * persisted plan when present — the deck view renders the proposed lanes
   * while the user decides to accept or discard. Returned re-localized.
   */
  stagedPlan?: DeckSection[]
}

/**
 * Resolve the ordered, localized section plan. A staged plan (when present)
 * wins; otherwise a persisted plan is re-localized against the active locale so
 * labels follow language switches; an empty plan is derived from `deriveArgs`
 * when provided.
 */
export function useSections({ sectionPlan, t, deriveArgs, stagedPlan }: UseSectionsArgs): DeckSection[] {
  return useMemo(() => {
    if (stagedPlan && stagedPlan.length > 0) {
      return stagedPlan.map((s) => localizeDeckSection(s, t))
    }
    if (sectionPlan.length > 0) {
      return sectionPlan.map((s) => localizeDeckSection(s, t))
    }
    if (deriveArgs) {
      return deriveSectionPlan(
        deriveArgs.archetypes,
        deriveArgs.traits,
        deriveArgs.coreCardCount,
        deriveArgs.colors,
        t,
      )
    }
    return []
  }, [stagedPlan, sectionPlan, deriveArgs, t])
}

export interface BuildLaneDescriptorsOpts {
  /**
   * When true (wizard fill mode), include empty sections so fill buttons
   * render for unfilled lanes. When false (view/edit mode), skip lanes with
   * no cards.
   */
  includeEmptySections?: boolean
  /**
   * When true (view mode), fall back to type-based lane labels (Creatures /
   * Spells / Support) when the section plan is empty. When false (fill mode
   * with plan), unsectioned cards just go to the unassigned bucket.
   */
  fallbackByType?: boolean
}

/**
 * Pure helper that builds the ordered lane descriptor list from a section
 * plan and bucketed card map. Single source of truth for lane lettering and
 * ordering (A core, B.. sections, U unassigned, L lands). Consumed by both
 * DeckEditor (fill/edit mode) and the deck route view mode.
 */
export function buildLaneDescriptors(
  sections: DeckSection[],
  sectionCards: Record<string, DeckDisplayCard[]>,
  t: TFn,
  opts: BuildLaneDescriptorsOpts = {},
): SectionLaneDescriptor[] {
  const { includeEmptySections = false, fallbackByType = false } = opts
  const list: SectionLaneDescriptor[] = []
  let nextLetter = 0

  // Core lane (A)
  if (sectionCards['core']?.length) {
    const coreSection = sections.find((s) => s.id === 'core')
    list.push({
      id: 'core',
      label: coreSection?.label ?? t('fill.laneCore'),
      sectionLetter: 'A',
      targetCount: coreSection?.targetCount,
      isCore: true,
    })
    nextLetter = 1
  }

  // Plan sections (B, C, ...)
  if (sections.length > 0) {
    for (const s of sections) {
      if (s.id === 'core' || s.id === 'lands') continue
      if (!sectionCards[s.id]?.length && !includeEmptySections) continue
      list.push({
        id: s.id,
        label: s.label,
        sectionLetter: String.fromCharCode(66 + nextLetter),
        targetCount: s.targetCount,
        description: s.description,
      })
      nextLetter++
    }
  } else if (fallbackByType) {
    // Type-split fallback when no plan is present (view mode on older decks)
    if (sectionCards['creatures']?.length) { list.push({ id: 'creatures', label: t('fill.laneCreatures'), sectionLetter: String.fromCharCode(66 + nextLetter) }); nextLetter++ }
    if (sectionCards['spells']?.length) { list.push({ id: 'spells', label: t('fill.laneSpells'), sectionLetter: String.fromCharCode(66 + nextLetter) }); nextLetter++ }
    if (sectionCards['support']?.length) { list.push({ id: 'support', label: t('fill.laneSupport'), sectionLetter: String.fromCharCode(66 + nextLetter) }); nextLetter++ }
  }

  // Unassigned (U)
  if (sectionCards['unassigned']?.length) {
    list.push({ id: 'unassigned', label: t('fill.unassigned'), sectionLetter: 'U' })
  }

  // Lands (L)
  const landsSection = sections.find((s) => s.id === 'lands')
  if (sectionCards['lands']?.length || (includeEmptySections && landsSection)) {
    list.push({
      id: 'lands',
      label: landsSection?.label ?? t('fill.laneLands'),
      sectionLetter: 'L',
      targetCount: landsSection?.targetCount,
      isLands: true,
    })
  }

  return list
}

/**
 * Memoized helper that resolves the main-zone DeckDisplayCard array from
 * the raw card list and the resolved card data map. Shared derivation used
 * by DeckEditor, StepDeckFill, and the deck route.
 */
export function useDeckDisplay(
  cards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
): DeckDisplayCard[] {
  return useMemo(
    () =>
      cards
        .filter((c) => c.zone === 'main')
        .flatMap((dc) => {
          const card = cardDataMap.get(dc.scryfallId)
          if (!card) return []
          return [{ ...dc, card }]
        }),
    [cards, cardDataMap],
  )
}

/**
 * Memoized wrapper over `bucketSectionCards` — buckets the deck's display
 * cards into core / section / lands / leftover lanes.
 */
export function useSectionCards(
  args: BucketSectionCardsInput,
): Record<string, DeckDisplayCard[]> {
  const { deckDisplay, sections, sectionAssignments, lockedSource, fallbackByType } = args
  return useMemo(
    () =>
      bucketSectionCards({
        deckDisplay,
        sections,
        sectionAssignments,
        lockedSource,
        fallbackByType,
      }),
    [deckDisplay, sections, sectionAssignments, lockedSource, fallbackByType],
  )
}
