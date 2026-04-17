import { useState, useCallback, useRef } from 'react'
import { getCardByName, getLocalizedCardData } from './scryfall/client'
import { useI18n } from './i18n'
import type { ScryfallCard } from './scryfall/types'
import { getCardName } from './scryfall/types'
import type { DeckCard } from './deck-utils'
import { mergeCardsIntoDeck } from './deck-utils'
import { BASIC_LAND_IDS, BASIC_LAND_ID_SET } from './basic-lands'
import type { DeckSection } from './section-plan'
import type { WizardState } from './wizard-state'
import { getFillColors } from './wizard-state'
import { getTraitById } from './trait-mappings'
import {
  analyzeComposition,
  findSynergyIssue,
  summarizeComposition,
} from './synergy-validation'
import { getCardRejectionReason, getFilterRejectionReason, type DeckFilters } from './card-validation'

interface PreviewCard {
  name: string
  scryfallId: string
  quantity: number
  scryfallCard?: ScryfallCard
}

export interface SectionFillState {
  status: 'idle' | 'loading' | 'preview' | 'applied' | 'error'
  previewCards?: PreviewCard[]
  explanation?: string
  error?: string
}

interface FillProgress {
  current: number
  total: number
  currentSection: string
}

interface UseSectionFillOptions {
  sections: DeckSection[]
  deckCards: DeckCard[]
  cardDataMap: Map<string, ScryfallCard>
  wizardState: WizardState
  onDeckUpdate: (cards: DeckCard[]) => void
  onCardDataUpdate: (card: ScryfallCard) => void
  onSectionAssign: (sectionId: string, scryfallIds: string[]) => void
}


interface FillCallOptions {
  deckComposition?: string
  rejectedCards?: Array<{ name: string; reason: string }>
}

/** Call the fillSection Convex action and resolve results via Scryfall */
async function callFillSection(
  section: DeckSection,
  currentCards: Array<{ name: string; quantity: number }>,
  wizardState: WizardState,
  fillColors: string[],
  onCardDataUpdate: (card: ScryfallCard) => void,
  scryfallLang: string,
  options: FillCallOptions = {},
): Promise<PreviewCard[]> {
  const archetypeLabels = wizardState.selectedArchetypes.map((id) => getTraitById(id)?.label || id)
  const traitLabels = wizardState.selectedTraits.map((id) => getTraitById(id)?.label || id)

  const { ConvexHttpClient } = await import('convex/browser')
  const { api } = await import('../../convex/_generated/api')
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string
  const client = new ConvexHttpClient(convexUrl)

  const result = await client.action(api.generateDeck.fillSection, {
    sectionName: section.label,
    sectionDescription: section.description,
    targetCount: section.targetCount,
    scryfallHints: section.scryfallHints,
    currentCards: currentCards.length > 0 ? currentCards : undefined,
    colors: fillColors,
    archetypes: archetypeLabels,
    traits: traitLabels,
    customStrategy: wizardState.customStrategy || undefined,
    format: wizardState.format !== 'casual' ? wizardState.format : undefined,
    budgetLimit: wizardState.budgetMax ?? undefined,
    deckComposition: options.deckComposition,
    rejectedCards: options.rejectedCards && options.rejectedCards.length > 0
      ? options.rejectedCards
      : undefined,
  })

  const previewCards: PreviewCard[] = []
  for (const card of result.cards) {
    try {
      const scryfallCard = await getCardByName(card.name, scryfallLang)
      onCardDataUpdate(scryfallCard)
      previewCards.push({
        name: getCardName(scryfallCard),
        scryfallId: scryfallCard.id,
        quantity: card.quantity,
        scryfallCard,
      })
    } catch {
      // Skip unresolvable cards
    }
  }

  return previewCards
}

/**
 * Build a composition snapshot from the current deck state plus an optional
 * batch of pending additions. Used to (a) tell the AI what's in the deck and
 * (b) validate suggestions against that state.
 */
function buildCompositionFromDeck(
  deckCards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
  pendingAdditions: PreviewCard[] = [],
) {
  const entries: Array<{ card: ScryfallCard; quantity: number }> = []
  for (const dc of deckCards) {
    if (dc.zone !== 'main') continue
    const data = cardDataMap.get(dc.scryfallId)
    if (data) entries.push({ card: data, quantity: dc.quantity })
  }
  for (const p of pendingAdditions) {
    if (p.scryfallCard) entries.push({ card: p.scryfallCard, quantity: p.quantity })
  }
  return analyzeComposition(entries)
}

/**
 * Validate AI suggestions against the resulting deck state. Returns the cards
 * that should be kept and the rejection reasons for the rest.
 *
 * Three checks run in order:
 *   1. Hard filter (stickers, Un-sets, oversized, digital-only, etc.) — a
 *      non-playable card is rejected before anything else, because no
 *      user preference can legalize a card the app refuses to ship.
 *   2. Filter compliance (color identity, format, budget, rarity) — an
 *      off-color card is rejected before any synergy reasoning, because
 *      no amount of synergy can legalize a color violation.
 *   3. Synergy (tribal payoffs, triggered abilities, keyword gates).
 */
function validateSection(
  previewCards: PreviewCard[],
  currentDeck: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
  filters: DeckFilters,
): { kept: PreviewCard[]; rejected: Array<{ name: string; reason: string }> } {
  // Composition includes the existing deck AND every preview card, so a
  // tribal payoff is fine if the same batch also adds enough creatures.
  const composition = buildCompositionFromDeck(currentDeck, cardDataMap, previewCards)
  const kept: PreviewCard[] = []
  const rejected: Array<{ name: string; reason: string }> = []
  for (const p of previewCards) {
    if (!p.scryfallCard) {
      kept.push(p)
      continue
    }
    const hardIssue = getCardRejectionReason(p.scryfallCard)
    if (hardIssue) {
      rejected.push({ name: p.name, reason: hardIssue })
      continue
    }
    const filterIssue = getFilterRejectionReason(p.scryfallCard, filters)
    if (filterIssue) {
      rejected.push({ name: p.name, reason: filterIssue })
      continue
    }
    const issue = findSynergyIssue(p.scryfallCard, composition)
    if (issue) {
      rejected.push({ name: p.name, reason: issue.reason })
    } else {
      kept.push(p)
    }
  }
  return { kept, rejected }
}

export function useSectionFill({
  sections,
  deckCards,
  cardDataMap,
  wizardState,
  onDeckUpdate,
  onCardDataUpdate,
  onSectionAssign,
}: UseSectionFillOptions) {
  const [sectionStates, setSectionStates] = useState<Record<string, SectionFillState>>({})
  const [fillProgress, setFillProgress] = useState<FillProgress | null>(null)
  const abortRef = useRef(false)
  const { scryfallLang } = useI18n()

  // Refs for latest values - needed by fillAllRemaining to avoid stale closures
  const deckCardsRef = useRef(deckCards)
  deckCardsRef.current = deckCards
  const cardDataMapRef = useRef(cardDataMap)
  cardDataMapRef.current = cardDataMap

  const getSectionState = useCallback(
    (sectionId: string): SectionFillState => sectionStates[sectionId] ?? { status: 'idle' },
    [sectionStates],
  )

  const updateSection = useCallback((sectionId: string, update: Partial<SectionFillState>) => {
    setSectionStates((prev) => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] ?? { status: 'idle' }), ...update },
    }))
  }, [])

  /** Build current deck card names from the latest deck state */
  const getCurrentCardNames = useCallback(() => {
    const cards = deckCardsRef.current
    const dataMap = cardDataMapRef.current
    return cards
      .filter((c) => c.zone === 'main')
      .map((c) => {
        const data = dataMap.get(c.scryfallId)
        return { name: data?.name ?? c.scryfallId, quantity: c.quantity }
      })
  }, [])

  /**
   * Resolve the fill-phase hard identity + full DeckFilters snapshot.
   * Returns null when the selected combo hasn't finished resolving its
   * cards from Scryfall — callers must block fill in that case, because
   * we can't compute a correct color-identity constraint without it.
   */
  const buildFilters = useCallback((): DeckFilters | null => {
    const fill = getFillColors(wizardState)
    if (!fill.ready || !fill.colors) return null
    return {
      colors: fill.colors,
      format: wizardState.format,
      budgetMin: wizardState.budgetMin,
      budgetMax: wizardState.budgetMax,
      rarities: wizardState.rarityFilter,
    }
  }, [wizardState])

  /** Fill a single section - shows preview for user to accept */
  const fillSection = useCallback(async (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return

    updateSection(sectionId, { status: 'loading', error: undefined })

    try {
      const filters = buildFilters()
      if (!filters) {
        updateSection(sectionId, {
          status: 'error',
          error: 'Core combo data is still loading — please retry in a moment.',
        })
        return
      }
      const currentCards = getCurrentCardNames()
      const composition = buildCompositionFromDeck(deckCardsRef.current, cardDataMapRef.current)
      const compositionSummary = summarizeComposition(composition)

      // First attempt — give the AI the composition upfront so it avoids dead cards.
      const firstBatch = await callFillSection(
        section,
        currentCards,
        wizardState,
        filters.colors,
        onCardDataUpdate,
        scryfallLang,
        { deckComposition: compositionSummary },
      )
      const firstResult = validateSection(firstBatch, deckCardsRef.current, cardDataMapRef.current, filters)
      let kept = firstResult.kept

      // If the validator caught dead cards, retry once with explicit rejection feedback.
      if (firstResult.rejected.length > 0) {
        const retryBatch = await callFillSection(
          section,
          currentCards,
          wizardState,
          filters.colors,
          onCardDataUpdate,
          scryfallLang,
          { deckComposition: compositionSummary, rejectedCards: firstResult.rejected },
        )
        const retryResult = validateSection(retryBatch, deckCardsRef.current, cardDataMapRef.current, filters)
        // Prefer retry - it knows about rejections. Fall back only if retry
        // produced nothing usable.
        if (retryResult.kept.length > 0) {
          kept = retryResult.kept
        }
      }

      // Cap at target so retry can't overfill. Sum of copies, not card count.
      const capped: PreviewCard[] = []
      let running = 0
      for (const c of kept) {
        if (running >= section.targetCount) break
        const allowed = Math.min(c.quantity, section.targetCount - running)
        if (allowed <= 0) continue
        capped.push({ ...c, quantity: allowed })
        running += allowed
      }

      updateSection(sectionId, {
        status: 'preview',
        previewCards: capped,
        explanation: capped.length > 0 ? undefined : 'No valid cards found',
      })
    } catch (err) {
      updateSection(sectionId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to fill section',
      })
    }
  }, [sections, wizardState, onCardDataUpdate, updateSection, getCurrentCardNames, buildFilters, scryfallLang])

  /** Apply previewed cards from a section into the deck */
  const applySection = useCallback((sectionId: string) => {
    const state = sectionStates[sectionId]
    if (!state?.previewCards) return

    const { merged, addedIds } = mergeCardsIntoDeck(
      deckCardsRef.current,
      state.previewCards.map((c) => ({ scryfallId: c.scryfallId, quantity: c.quantity })),
      (id) => BASIC_LAND_ID_SET.has(id),
    )

    onDeckUpdate(merged)
    // Only assign cards that actually landed in the deck (dedup + cap filter).
    onSectionAssign(sectionId, addedIds)

    updateSection(sectionId, { status: 'applied' })
  }, [sectionStates, onDeckUpdate, onSectionAssign, updateSection])

  const discardSection = useCallback((sectionId: string) => {
    updateSection(sectionId, { status: 'idle', previewCards: undefined, explanation: undefined })
  }, [updateSection])

  /** Auto-fill basic lands based on deck color identity */
  const fillLands = useCallback(async (targetCount: number) => {
    const fill = getFillColors(wizardState)
    const activeColors = fill.colors ?? []
    if (activeColors.length === 0) return

    const landsPerColor = Math.floor(targetCount / activeColors.length)
    const remainder = targetCount % activeColors.length

    const additions: Array<{ scryfallId: string; quantity: number }> = []

    for (let i = 0; i < activeColors.length; i++) {
      const color = activeColors[i]
      const landId = BASIC_LAND_IDS[color]
      if (!landId) continue

      const qty = landsPerColor + (i < remainder ? 1 : 0)
      if (qty <= 0) continue

      additions.push({ scryfallId: landId, quantity: qty })

      const landCard = await getLocalizedCardData(undefined, landId, undefined, undefined, scryfallLang)
      if (landCard) onCardDataUpdate(landCard)
    }

    const { merged, addedIds } = mergeCardsIntoDeck(
      deckCardsRef.current,
      additions,
      (id) => BASIC_LAND_ID_SET.has(id),
    )
    onDeckUpdate(merged)
    onSectionAssign('lands', addedIds)
    updateSection('lands', { status: 'applied' })
  }, [wizardState, onDeckUpdate, onCardDataUpdate, onSectionAssign, updateSection, scryfallLang])

  /**
   * Fill all unfilled sections sequentially, auto-applying each.
   * Uses an accumulator to ensure each fill sees cards from previous fills.
   */
  const fillAllRemaining = useCallback(async () => {
    abortRef.current = false

    // Snapshot which sections need filling - skip sections at capacity.
    // Shallow-clone the assignments map so we can mutate it locally across
    // section iterations without touching wizard state directly.
    const assignments: Record<string, string[]> = {
      ...(wizardState.sectionAssignments ?? {}),
    }
    const deckCards = deckCardsRef.current

    const unfilled = sections.filter((s) => {
      if (s.id === 'lands') return false
      const st = sectionStates[s.id]
      if (st && st.status !== 'idle') return false
      // Check how many cards the section already has
      const assignedIds = new Set(assignments[s.id] ?? [])
      const existing = deckCards
        .filter((c) => c.zone === 'main' && assignedIds.has(c.scryfallId))
        .reduce((sum, c) => sum + c.quantity, 0)
      return existing < s.targetCount
    })

    if (unfilled.length === 0) return

    // Accumulate deck cards across fills to avoid stale context
    let accumulated = [...deckCards]
    const accumulatedNames = () => {
      const dataMap = cardDataMapRef.current
      return accumulated
        .filter((c) => c.zone === 'main')
        .map((c) => ({ name: dataMap.get(c.scryfallId)?.name ?? c.scryfallId, quantity: c.quantity }))
    }

    setFillProgress({ current: 0, total: unfilled.length, currentSection: unfilled[0].label })

    for (let i = 0; i < unfilled.length; i++) {
      if (abortRef.current) break
      const section = unfilled[i]

      // Calculate deficit - only fill what's missing
      const assignedIds = new Set(assignments[section.id] ?? [])
      const existing = accumulated
        .filter((c) => c.zone === 'main' && assignedIds.has(c.scryfallId))
        .reduce((sum, c) => sum + c.quantity, 0)
      const deficit = section.targetCount - existing
      if (deficit <= 0) {
        updateSection(section.id, { status: 'applied' })
        continue
      }

      setFillProgress({ current: i + 1, total: unfilled.length, currentSection: section.label })
      updateSection(section.id, { status: 'loading' })

      try {
        // Composition snapshot includes everything filled so far in this run.
        const composition = buildCompositionFromDeck(accumulated, cardDataMapRef.current)
        const compositionSummary = summarizeComposition(composition)
        const filters = buildFilters()
        if (!filters) {
          updateSection(section.id, {
            status: 'error',
            error: 'Core combo data is still loading — please retry in a moment.',
          })
          continue
        }

        const firstBatch = await callFillSection(
          { ...section, targetCount: deficit },
          accumulatedNames(),
          wizardState,
          filters.colors,
          onCardDataUpdate,
          scryfallLang,
          { deckComposition: compositionSummary },
        )
        const firstResult = validateSection(firstBatch, accumulated, cardDataMapRef.current, filters)
        let previewCards = firstResult.kept

        if (firstResult.rejected.length > 0) {
          const retryBatch = await callFillSection(
            { ...section, targetCount: deficit },
            accumulatedNames(),
            wizardState,
            filters.colors,
            onCardDataUpdate,
            scryfallLang,
            { deckComposition: compositionSummary, rejectedCards: firstResult.rejected },
          )
          const retryResult = validateSection(retryBatch, accumulated, cardDataMapRef.current, filters)
          // Prefer retry's cards - they know about the rejections. Fall back
          // to the first attempt's keepers only if retry produced nothing.
          if (retryResult.kept.length > 0) {
            previewCards = retryResult.kept
          }
        }

        // Cap at the deficit so the retry path can't accidentally overfill
        // the section. Sum of copies, not card count - a 4-of is worth 4.
        let capped: PreviewCard[] = []
        let running = 0
        for (const c of previewCards) {
          if (running >= deficit) break
          const allowed = Math.min(c.quantity, deficit - running)
          if (allowed <= 0) continue
          capped.push({ ...c, quantity: allowed })
          running += allowed
        }
        previewCards = capped

        // Auto-apply: merge into accumulator so duplicate scryfallIds collapse
        // into single entries instead of producing ghost DeckCard rows.
        const { merged, addedIds } = mergeCardsIntoDeck(
          accumulated,
          previewCards.map((c) => ({ scryfallId: c.scryfallId, quantity: c.quantity })),
          (id) => BASIC_LAND_ID_SET.has(id),
        )
        accumulated = merged
        onDeckUpdate(accumulated)
        // Only assign IDs that actually landed (dedup/cap may have dropped some).
        const existingAssigned = assignments[section.id] ?? []
        const dedupedAssigned = Array.from(new Set([...existingAssigned, ...addedIds]))
        onSectionAssign(section.id, dedupedAssigned)
        // Update the local assignments snapshot so subsequent iterations see
        // these IDs and calculate deficit correctly.
        assignments[section.id] = dedupedAssigned
        updateSection(section.id, { status: 'applied', previewCards })
      } catch {
        updateSection(section.id, { status: 'error', error: 'Failed to fill section' })
      }
    }

    setFillProgress(null)
  }, [sections, sectionStates, wizardState, onCardDataUpdate, onDeckUpdate, onSectionAssign, updateSection, buildFilters, scryfallLang])

  const cancelFillAll = useCallback(() => {
    abortRef.current = true
    setFillProgress(null)
  }, [])

  return {
    getSectionState,
    fillSection,
    applySection,
    discardSection,
    fillLands,
    fillAllRemaining,
    fillProgress,
    cancelFillAll,
  }
}
