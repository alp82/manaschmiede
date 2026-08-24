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
import type { TFn } from './i18n/types'

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
 * Extract the stale lane diff: a lane is stale when it is NEW (no counterpart in
 * the previous plan), when its targetCount changed, or when its bucketed count
 * dropped (newly under-filled).
 *
 * New lanes are the flagship case, not an edge one: an archetype swap replaces
 * the whole section set, so every lane is new and skipping them left the feature
 * producing zero affordance exactly when the user had made the biggest change.
 *
 * The 'core' / 'lands' lanes rebalance with the plan but are never
 * user-refillable, so only named sections qualify.
 */
export function computeStaleLanes(
  sections: StagedSection[],
  previousPlan: StagedPlan,
): string[] {
  const staleLaneIds: string[] = []
  const prevById = new Map(previousPlan.sections.map((s) => [s.id, s]))
  for (const section of sections) {
    const prev = prevById.get(section.id)
    if (!prev) {
      staleLaneIds.push(section.id)
      continue
    }
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
  t: TFn,
  previousPlan: StagedPlan | null,
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
 *
 * `previousPlan` is REQUIRED — pass `null` when there is no baseline. It used to
 * be optional, and every production call site simply omitted it, which silently
 * produced `staleLaneIds: []` and left the entire stale-lane feature dark. An
 * argument you have to write `null` for is one you cannot forget.
 */
export function bucketPlanAgainstCards(
  deckCards: DeckDisplayCard[],
  plan: DeckSection[],
  previousPlan: StagedPlan | null,
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

/**
 * A lane's review state, computed from the staged plan alone — no callbacks, no
 * chat. `refillCount` is what a re-fill should ASK FOR: `null` means there is
 * nothing to fill, so the caller must not send and must not offer the prompt.
 */
export interface LaneReviewStatus {
  stale: boolean
  refillDeficit: number
  refillCount: number | null
}

/**
 * The same state dressed for rendering: `refillCount` resolved into a callback
 * that is simply ABSENT when there is nothing to fill, plus which lane is
 * currently waiting on the chat. SectionLane re-exports this so the component
 * tree keeps importing it from where it renders it.
 */
export interface LaneStatus {
  stale: boolean
  /**
   * Omitted when the lane has nothing to re-fill (its target shrank, so it is
   * already at or over the staged count). The lane still dims; the prompt is
   * simply not rendered.
   */
  onRefill?: () => void
  refillDeficit: number
  /** True when a re-fill chat call is in flight for THIS lane. */
  refilling?: boolean
}

/**
 * Pure core of the hook's `laneStatus`. Returns `undefined` for a lane that is
 * not under review — which is every lane when nothing is staged.
 *
 * This exists so the "is it stale?" and "how many does it need?" questions are
 * answered from ONE place. They used to be answered by a `staleLaneIds` array
 * and a `deficitFor` function the caller had to combine itself, in the right
 * order, in the deck route.
 */
export function laneStatusFor(plan: StagedPlan | null, laneId: string): LaneReviewStatus | undefined {
  if (!plan || !plan.staleLaneIds.includes(laneId)) return undefined
  const section = plan.sections.find((s) => s.id === laneId)
  // A lane whose bucketed count has reached its staged target has answered the
  // re-derive — stop dimming it, even though it is still in the staged plan and
  // therefore still in staleLaneIds until Accept. Over-filled is NOT answered:
  // a shrunk target leaves the lane above its count with nothing to fill.
  if (section && section.bucketedCards.length === section.targetCount) return undefined
  const refillDeficit = section ? section.deficit : 0
  return { stale: true, refillDeficit, refillCount: refillCountFor(refillDeficit) }
}

interface UseStagedRederiveArgs {
  displayCards: DeckDisplayCard[]
  t: TFn
  setDeck: (updater: (prev: LocalDeck | null) => LocalDeck | null) => void
  resolveCard: (id: string) => ScryfallCard | undefined
  /**
   * The deck's currently committed section plan. REQUIRED, because the previous
   * plan every stale-lane diff is measured against is DERIVED from it — see the
   * hook doc comment. Pass `[]` for a legacy deck with no plan; that correctly
   * yields no stale lanes, because there is no baseline to differ from.
   */
  committedPlan: DeckSection[]
  /**
   * A previously-staged plan (from the per-deck pending slot) to rehydrate on
   * mount. Absent / null / empty means nothing was staged.
   */
  initialPlan?: DeckSection[] | null
  /**
   * Fired whenever the staged plan changes (staged, accepted, or discarded), so
   * the route can persist it to / clear it from the pending slot.
   */
  onStagedChange?: (plan: DeckSection[] | null) => void
  /**
   * Fired when the user presses a stale lane's re-fill button, with the count
   * the lane needs. The chat call itself stays in the route — this hook owns
   * plans, not conversations. Must be referentially stable: it is a dependency
   * of `laneStatus`.
   */
  onRefillLane?: (laneId: string, count: number) => void
  /** Which lane has a re-fill in flight, if any. Drives the per-lane spinner. */
  refillingLaneId?: string | null
  /**
   * False while the deck's Scryfall data is still resolving. Deficits are
   * measured against `displayCards`, which drops unresolved ids, so every lane
   * looks empty at mount and every deficit reads as a full targetCount. Lane
   * status is withheld until this is true rather than offering a re-fill that
   * would ask for a whole lane and push the deck past 60.
   */
  cardsReady?: boolean
}

export interface UseStagedRederiveResult {
  /** The staged (proposed) section plan, or null when nothing is staged. */
  stagedPlan: DeckSection[] | null
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
  /**
   * Everything the deck view needs to render one lane's review state, or
   * `undefined` for a lane that is not under review. One call, so a caller
   * cannot combine "is it stale" and "how many does it need" in the wrong order
   * — or forget one of them.
   */
  laneStatus: (laneId: string) => LaneStatus | undefined
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
 *
 * Two things this hook deliberately does NOT do:
 *
 * **It does not remember the previous plan.** The stale-lane diff needs a
 * baseline to measure against, and a remembered one fails twice: it doesn't
 * survive a reload, and it freezes `bucketedCards` against the cards as they
 * were at capture time. The baseline is DERIVED from `committedPlan` — which is
 * the definition of "what the deck looks like now" — bucketed against the same
 * `displayCards` as the proposal, so `bucketDropped` fires only on a genuine
 * lane or role change.
 *
 * **It does not hold a StagedPlan in state.** State holds the bare
 * `DeckSection[]`; the bucketed plan (and therefore every deficit and every
 * stale lane) is derived in a `useMemo`. Held in state it would freeze at mount,
 * when `displayCards` is empty and every deficit reads as a full targetCount.
 * Derived, it self-corrects the moment card data resolves.
 */
export function useStagedRederive({
  displayCards,
  t,
  setDeck,
  resolveCard,
  committedPlan,
  initialPlan,
  onStagedChange,
  onRefillLane,
  refillingLaneId,
  cardsReady = true,
}: UseStagedRederiveArgs): UseStagedRederiveResult {
  // Rehydrate a persisted plan once on mount; absent / empty means nothing was
  // staged. Only the bare sections are held — the bucketing is derived below.
  const wasRehydrated = initialPlan != null && initialPlan.length > 0
  const [stagedSections, setStagedSections] = useState<DeckSection[] | null>(
    () => (wasRehydrated ? initialPlan! : null),
  )
  // Track whether the CURRENT staged plan originated from rehydration (true) or
  // a fresh stage() call this session (false). Flips to false on stage().
  const [resumed, setResumed] = useState(wasRehydrated)

  // The proposal, bucketed against the current cards and diffed against a
  // baseline derived the same way. Nothing is computed while nothing is staged.
  const staged = useMemo(() => {
    if (!stagedSections) return null
    const baseline = bucketPlanAgainstCards(displayCards, committedPlan, null)
    return bucketPlanAgainstCards(displayCards, stagedSections, baseline)
  }, [stagedSections, displayCards, committedPlan])

  // Mirror staged-plan changes into the pending slot. Skips the very first
  // commit so rehydration doesn't immediately re-persist what it just loaded.
  const onStagedChangeRef = useRef(onStagedChange)
  onStagedChangeRef.current = onStagedChange
  useSkipFirst(() => {
    onStagedChangeRef.current?.(stagedSections)
  }, [stagedSections])

  const committedPlanRef = useRef(committedPlan)
  committedPlanRef.current = committedPlan

  const stage = useCallback(
    (nextIntent: DeckIntent) => {
      const baseline = bucketPlanAgainstCards(displayCards, committedPlanRef.current, null)
      const proposed = deriveStagedPlan(displayCards, nextIntent, t, baseline)
      // No-op when the re-derive produces a plan structurally identical to the
      // committed plan (same ids, same targetCounts, no stale lanes): suppress
      // the Accept/Discard banner because accepting would do nothing visible.
      const proposedSections = proposed.sections.map(({ bucketedCards: _b, deficit: _d, ...s }) => s)
      if (proposed.staleLaneIds.length === 0 && plansEqual(proposedSections, committedPlanRef.current)) {
        return
      }
      setStagedSections(proposedSections)
      setResumed(false)
    },
    [displayCards, t],
  )

  const discardPlan = useCallback(() => setStagedSections(null), [])

  const acceptPlan = useCallback(() => {
    if (!stagedSections) return
    setDeck((prev) => {
      if (!prev) return prev
      // Re-bucket the existing assignments against the new plan by role: each
      // previously-assigned id is re-routed via pickSectionForCard; ids whose
      // role no longer maps to a lane are dropped from assignments (they surface
      // in the unassigned bucket at render time). An empty plan keeps the prior
      // assignments untouched.
      const prevAssignments = prev.sectionAssignments ?? {}
      const rebucketed = rebucketAssignments(prevAssignments, stagedSections, resolveCard)
      return {
        ...prev,
        sectionPlan: stagedSections,
        sectionAssignments: rebucketed,
        updatedAt: Date.now(),
      }
    })
    setStagedSections(null)
  }, [stagedSections, setDeck, resolveCard])

  const laneStatus = useCallback(
    (laneId: string): LaneStatus | undefined => {
      if (!cardsReady) return undefined
      const status = laneStatusFor(staged, laneId)
      if (!status) return undefined
      // A lane with nothing to fill (its target shrank, so it is already at or
      // over the staged count) still dims, but offers no re-fill — SectionLane
      // hides the prompt when onRefill is absent.
      const count = status.refillCount
      return {
        stale: true,
        onRefill: count === null ? undefined : () => onRefillLane?.(laneId, count),
        refillDeficit: status.refillDeficit,
        refilling: refillingLaneId === laneId,
      }
    },
    [staged, cardsReady, refillingLaneId, onRefillLane],
  )

  return {
    stagedPlan: stagedSections,
    resumed,
    stage,
    acceptPlan,
    discardPlan,
    laneStatus,
  }
}
