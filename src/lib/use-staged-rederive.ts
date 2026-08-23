import { useCallback, useMemo, useRef, useState } from 'react'
import { deriveSectionPlan, pickSectionForCard, type DeckSection } from './section-plan'
import {
  bucketSectionCards,
  type DeckDisplayCard,
} from './deck-utils'
import { committedColors, type DeckIntent } from './deck-intent'
import { structuralKey } from './deck-pending'
import { useSkipFirst } from './use-skip-first'
import type { LocalDeck } from './deck-storage'
import type { ScryfallCard } from './scryfall/types'

type Translate = (key: string, params?: Record<string, string | number>) => string

/** A planned section augmented with the cards bucketed into it and its deficit. */
export interface StagedSection extends DeckSection {
  /** scryfallIds bucketed into this lane. */
  bucketedCards: string[]
  /** max(0, targetCount - bucketedCards.length). */
  deficit: number
}

export interface StagedPlan {
  sections: StagedSection[]
  /** scryfallIds that fit no named lane (misfits). */
  unassigned: string[]
  /** ids of lanes whose target or bucketed count changed vs the previous plan. */
  staleLaneIds: string[]
}

/**
 * The structural slice of a DeckIntent that `deriveStagedPlan` needs: the
 * committed colors and the selected archetypes. Accepts either a full
 * DeckIntent (colors as a committed/unselected map) or the already-resolved
 * `{ archetypes, colors: string[] }` shape.
 */
type StagedIntent =
  | DeckIntent
  | { archetypes: string[]; colors: string[] }

function resolveColors(intent: StagedIntent): string[] {
  if (Array.isArray(intent.colors)) return intent.colors
  return committedColors(intent as DeckIntent)
}

/**
 * How many cards a stale lane's re-fill should ask for: its deficit — the
 * staged plan's new targetCount minus the re-bucketed cards (decision 5) — or
 * `null` when the lane is already at or over that target and there is nothing
 * to fill.
 *
 * A lane can be stale WITHOUT having a deficit: `computeStaleLanes` also flags
 * a SHRINKING targetCount, which leaves the lane over-filled at deficit 0. The
 * caller must treat `null` as "don't send, don't offer the prompt" — falling
 * back to `targetCount` there requests a whole lane's worth of extra cards and
 * pushes the deck past 60.
 */
export function refillCountFor(deficit: number): number | null {
  return deficit > 0 ? deficit : null
}

/**
 * Extract the stale lane diff: a lane is stale when its targetCount changed vs
 * the previous plan, or when its bucketed count dropped (newly under-filled).
 * The 'core' / 'lands' rebalance with the plan but are never user-refillable
 * lanes, so only named sections qualify.
 */
export function computeStaleLanes(
  sections: StagedSection[],
  previousPlan: StagedPlan,
): string[] {
  const staleLaneIds: string[] = []
  const prevById = new Map(previousPlan.sections.map((s) => [s.id, s]))
  for (const section of sections) {
    const prev = prevById.get(section.id)
    if (!prev) continue
    const targetChanged = prev.targetCount !== section.targetCount
    const bucketDropped = section.bucketedCards.length < prev.bucketedCards.length
    if (targetChanged || bucketDropped) staleLaneIds.push(section.id)
  }
  return staleLaneIds
}

/**
 * Re-bucket prior sectionAssignments against a new plan by role: each
 * previously-assigned id is re-routed via pickSectionForCard; ids whose role no
 * longer maps to a lane are dropped. Duplicate ids across old buckets de-dupe
 * (first wins). When `nextPlan` is empty, returns `prevAssignments` unchanged.
 */
export function rebucketAssignments(
  prevAssignments: Record<string, string[]>,
  nextPlan: DeckSection[],
  resolveCard: (id: string) => ScryfallCard | undefined,
): Record<string, string[]> {
  if (nextPlan.length === 0) return prevAssignments
  const next: Record<string, string[]> = {}
  const seen = new Set<string>()
  for (const ids of Object.values(prevAssignments)) {
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const card = resolveCard(id)
      if (!card) continue
      const sectionId = pickSectionForCard(card, nextPlan)
      if (!sectionId) continue
      ;(next[sectionId] ??= []).push(id)
    }
  }
  return next
}

/**
 * Pure re-derive of the section plan against the deck's current display cards.
 *
 * The proposed plan is derived from the committed intent's archetypes + colors,
 * with `coreCardCount` measured as the LOCKED QUANTITY (sum of `quantity` over
 * locked cards) — deriveSectionPlan treats coreCardCount as a 60-slot
 * subtrahend, so the copy count is the correct basis (a distinct count
 * under-counts and overflows past 60).
 *
 * Cards are bucketed against the proposed plan via the shared
 * `bucketSectionCards`, passing the locked-id set as `lockedSource` so locked
 * cards land in the 'core' bucket — NOT a role lane. This keeps the render path
 * (useSectionCards with lockedSource: lockedCardIds) consistent: both the
 * bucketed count and the deficit are computed from NON-core (role-lane) cards
 * only. `deficit = max(0, target - non-core-bucketed)`.
 */
export function deriveStagedPlan(
  deckCards: DeckDisplayCard[],
  intent: StagedIntent,
  t: Translate,
  previousPlan?: StagedPlan,
): StagedPlan {
  const colors = resolveColors(intent)
  const lockedCards = deckCards.filter((c) => c.locked)
  const coreCardCount = lockedCards.reduce((sum, c) => sum + c.quantity, 0)

  const plan = deriveSectionPlan(intent.archetypes, [], coreCardCount, colors, t)
  return bucketPlanAgainstCards(deckCards, plan, previousPlan)
}

/**
 * Bucket an EXPLICIT section plan against the deck's display cards into a
 * StagedPlan (bucketed cards + per-lane deficit + stale-lane diff). The shared
 * core of `deriveStagedPlan` (which builds the plan from intent) and the
 * persistence-rehydration path (which restores a previously-staged plan from
 * the per-deck pending slot, where the plan is already known).
 */
export function bucketPlanAgainstCards(
  deckCards: DeckDisplayCard[],
  plan: DeckSection[],
  previousPlan?: StagedPlan,
): StagedPlan {
  const lockedCards = deckCards.filter((c) => c.locked)
  const lockedIds = new Set(lockedCards.map((c) => c.scryfallId))

  // Route each non-land card into a lane by its role (pickSectionForCard), then
  // bucket against the proposed plan with the locked-id set as lockedSource.
  // Locked cards land in the 'core' bucket (highest precedence in
  // bucketSectionCards), so role lanes only count non-locked cards.
  // deficit = max(0, target - non-core-bucketed) — exactly as the render path.
  const proposedAssignments: Record<string, string[]> = {}
  for (const d of deckCards) {
    if (d.card.type_line.toLowerCase().includes('land')) continue
    const sectionId = pickSectionForCard(d.card, plan)
    if (!sectionId) continue
    ;(proposedAssignments[sectionId] ??= []).push(d.scryfallId)
  }
  const buckets = bucketSectionCards({
    deckDisplay: deckCards,
    sections: plan,
    sectionAssignments: proposedAssignments,
    lockedSource: lockedIds,
    fallbackByType: false,
  })

  const sections: StagedSection[] = plan.map((section) => {
    const bucketedCards = (buckets[section.id] ?? []).map((d) => d.scryfallId)
    const deficit = Math.max(0, section.targetCount - bucketedCards.length)
    return { ...section, bucketedCards, deficit }
  })

  const unassigned = (buckets['unassigned'] ?? []).map((d) => d.scryfallId)

  // A lane is stale when its target changed vs the previous plan OR its bucketed
  // count dropped (newly under-filled).
  const staleLaneIds = previousPlan ? computeStaleLanes(sections, previousPlan) : []

  return { sections, unassigned, staleLaneIds }
}

/**
 * Whether the STRUCTURAL fields (committed colors + archetypes) differ between
 * two intents. Soft fields (strategy / budget / rarity / traits) are ignored —
 * only structural changes warrant a plan re-derive.
 */
export function structuralFieldsChanged(before: DeckIntent, after: DeckIntent): boolean {
  return structuralKey(before) !== structuralKey(after)
}

/**
 * Returns true when `a` and `b` are structurally identical for the purposes of
 * "did the re-derive produce a different plan?": same set of section ids AND
 * same targetCount per id. Used to suppress the Accept/Discard banner when an
 * intent edit computes to the exact same plan already committed.
 */
export function plansEqual(a: DeckSection[], b: DeckSection[]): boolean {
  if (a.length !== b.length) return false
  const bById = new Map(b.map((s) => [s.id, s.targetCount]))
  for (const s of a) {
    if (!bById.has(s.id)) return false
    if (bById.get(s.id) !== s.targetCount) return false
  }
  return true
}

interface UseStagedRederiveArgs {
  displayCards: DeckDisplayCard[]
  t: Translate
  setDeck: (updater: (prev: LocalDeck | null) => LocalDeck | null) => void
  resolveCard: (id: string) => ScryfallCard | undefined
  /**
   * A previously-staged plan (from the per-deck pending slot) to rehydrate on
   * mount — re-bucketed against the current cards so the review affordances
   * (deficits, stale lanes) resume. Absent / null means nothing was staged.
   */
  initialPlan?: DeckSection[] | null
  /**
   * Fired whenever the staged plan changes (staged, accepted, or discarded), so
   * the route can persist it to / clear it from the pending slot. Receives the
   * stripped DeckSection[] (or null when nothing is staged).
   */
  onStagedChange?: (plan: DeckSection[] | null) => void
  /**
   * The deck's currently committed section plan. When a re-derive produces a
   * plan structurally identical to this (same ids + same targetCounts, no stale
   * lanes), the stage() call is a no-op so we don't show an Accept/Discard
   * banner that does nothing visible.
   */
  committedPlan?: DeckSection[]
}

export interface UseStagedRederiveResult {
  /** The staged (proposed) section plan, or null when nothing is staged. */
  stagedPlan: DeckSection[] | null
  staleLaneIds: string[]
  deficitFor: (laneId: string) => number
  /**
   * True when the current staged plan was rehydrated from the persisted slot on
   * mount (not freshly staged this session). Lets the UI show "Resumed from your
   * last session" copy instead of the present-tense "Intent changed" copy.
   */
  resumed: boolean
  /** Stage a fresh plan derived from `nextIntent` against the current cards. */
  stage: (nextIntent: DeckIntent) => void
  /** Commit the staged plan into the deck's sectionPlan + re-bucket assignments. */
  acceptPlan: () => void
  /** Drop the staged layer without touching the deck. */
  discardPlan: () => void
}

/**
 * Hook wrapping the pure re-derive core. The staged plan lives in this hook's
 * OWN state — it is NOT routed through useDeckChat.pending (the re-derived plan
 * is its own staging layer; only card-level proposals share the single pending
 * slot). `acceptPlan` writes the staged plan into the deck's persisted
 * `sectionPlan` and re-buckets `sectionAssignments` (misfits → unassigned),
 * then clears the staged layer. `discardPlan` clears it without touching the
 * deck. The staged plan is backed by the per-deck pending slot (via
 * `initialPlan` for rehydration + `onStagedChange` for persistence), so a
 * mid-review reload resumes the proposed plan.
 */
export function useStagedRederive({
  displayCards,
  t,
  setDeck,
  resolveCard,
  initialPlan,
  onStagedChange,
  committedPlan,
}: UseStagedRederiveArgs): UseStagedRederiveResult {
  // Rehydrate a persisted plan once on mount by re-bucketing it against the
  // current cards; absent / empty means nothing was staged.
  const wasRehydrated = initialPlan != null && initialPlan.length > 0
  const [staged, setStaged] = useState<StagedPlan | null>(() =>
    wasRehydrated
      ? bucketPlanAgainstCards(displayCards, initialPlan!)
      : null,
  )
  // Track whether the CURRENT staged plan originated from rehydration (true) or
  // a fresh stage() call this session (false). Flips to false on stage().
  const [resumed, setResumed] = useState(wasRehydrated)

  // Mirror staged-plan changes into the pending slot. Skips the very first
  // commit so rehydration doesn't immediately re-persist what it just loaded.
  const onStagedChangeRef = useRef(onStagedChange)
  onStagedChangeRef.current = onStagedChange
  useSkipFirst(() => {
    onStagedChangeRef.current?.(
      staged
        ? staged.sections.map(({ bucketedCards: _b, deficit: _d, ...section }) => section)
        : null,
    )
  }, [staged])

  const committedPlanRef = useRef(committedPlan)
  committedPlanRef.current = committedPlan

  const stage = useCallback(
    (nextIntent: DeckIntent) => {
      const proposed = deriveStagedPlan(displayCards, nextIntent, t)
      // No-op when the re-derive produces a plan structurally identical to the
      // committed plan (same ids, same targetCounts, no stale lanes): suppress
      // the Accept/Discard banner because accepting would do nothing visible.
      const current = committedPlanRef.current ?? []
      const proposedSections = proposed.sections.map(({ bucketedCards: _b, deficit: _d, ...s }) => s)
      if (proposed.staleLaneIds.length === 0 && plansEqual(proposedSections, current)) return
      setStaged(proposed)
      setResumed(false)
    },
    [displayCards, t],
  )

  const discardPlan = useCallback(() => setStaged(null), [])

  const acceptPlan = useCallback(() => {
    if (!staged) return
    // Strip the staged-only augmentation back down to a clean DeckSection plan.
    const nextPlan: DeckSection[] = staged.sections.map(
      ({ bucketedCards: _b, deficit: _d, ...section }) => section,
    )
    setDeck((prev) => {
      if (!prev) return prev
      // Re-bucket the existing assignments against the new plan by role: each
      // previously-assigned id is re-routed via pickSectionForCard; ids whose
      // role no longer maps to a lane are dropped from assignments (they surface
      // in the unassigned bucket at render time). An empty plan keeps the prior
      // assignments untouched.
      const prevAssignments = prev.sectionAssignments ?? {}
      const rebucketed = rebucketAssignments(prevAssignments, nextPlan, resolveCard)
      return {
        ...prev,
        sectionPlan: nextPlan,
        sectionAssignments: rebucketed,
        updatedAt: Date.now(),
      }
    })
    setStaged(null)
  }, [staged, setDeck, resolveCard])

  const deficitFor = useCallback(
    (laneId: string): number => {
      if (!staged) return 0
      const section = staged.sections.find((s) => s.id === laneId)
      return section ? section.deficit : 0
    },
    [staged],
  )

  const stagedPlan = useMemo<DeckSection[] | null>(() => {
    if (!staged) return null
    return staged.sections.map(({ bucketedCards: _b, deficit: _d, ...section }) => section)
  }, [staged])

  return {
    stagedPlan,
    staleLaneIds: staged?.staleLaneIds ?? [],
    deficitFor,
    resumed,
    stage,
    acceptPlan,
    discardPlan,
  }
}
