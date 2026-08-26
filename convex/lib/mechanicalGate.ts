/**
 * The mechanical gate: the first rung of the bench's quality ladder
 * (mechanical gate -> simulation signal -> human blind A/B). Its whole job is
 * to protect the sole reviewer's attention, so a candidate model's raw output
 * is checked here before a human ever sees it. Decided in issue #55.
 *
 * One gate, one **check profile** per output shape. Every profile runs the
 * shared checks - parse rung, schema, truncation, latency, projected build
 * cost - and then its own. A **hard fail** disqualifies the run; everything
 * else is a **score** that ranks the survivors and never disqualifies.
 *
 * The gate measures the model's RAW output, before `enforceDeck` repairs it -
 * otherwise every candidate would pass 60 cards and the 4-copy rule by
 * construction. What the enforcer had to change is the **repair distance**.
 *
 * It restates no rule. Parsing is the site's own parser (`responseShapes.ts`),
 * the 60-card rule is `enforceDeck` through `enforceDeckSize`, the land band
 * and curve are `deckRules.ts`, the hard filter is `cardFilters.ts`,
 * truncation is `isTruncated`. If a threshold here looks like a deck rule, it
 * belongs in `deckRules.ts` instead.
 *
 * Zero runtime imports. Card existence needs Scryfall, so that part is the
 * wrapper in `mechanicalGateCheck.ts`: it asks `gateProbes` what to look up,
 * looks it up, and hands the facts to `checkRun`. The split is the
 * `strategyParse.ts` / `strategyQueries.ts` one.
 */
import { isTruncated } from './anthropic'
import { getHardFilterRejectionReason, type HardFilterCard } from './cardFilters'
import {
  MAX_COPIES,
  TARGET_DECK_SIZE,
  checkLandCount,
  isAverageManaValueTooHigh,
  landCountForArchetype,
  totalCopies,
  type LandCountVerdict,
} from './deckRules'
import { isBasicLandName } from './basicLands'
import { INVALID_FORMAT_MESSAGE } from './parseCardList'
import { UNPARSEABLE_RESPONSE_MESSAGE, type JsonLadderRung } from './jsonLadder'
import {
  enforceDeckSize,
  isBasicLandTypeLine,
  isLandTypeLine,
  parseComboResponse,
  parseDeckResponse,
  parseSectionResponse,
  readComboResponse,
  readDeckResponse,
  readSectionResponse,
  type GeneratedCard,
  type ReadResponse,
} from './responseShapes'
import { MAX_STRATEGY_QUERIES, extractStrategyQueries } from './strategyQueries'

// ── Sites and thresholds (issue #55) ────────────────────────────────────────

/** The `llmUsageLogs.action` labels the gate has a profile for. */
export type GateSite = 'chat.generate' | 'fillSection' | 'suggestCombos' | 'chat.classify' | 'strategyParse'

/** A deck build gets a long leash; a mechanical site does not. */
export type SiteTempo = 'deck' | 'mechanical'

export const SITE_TEMPO: Readonly<Record<GateSite, SiteTempo>> = {
  'chat.generate': 'deck',
  suggestCombos: 'deck',
  fillSection: 'mechanical',
  'chat.classify': 'mechanical',
  strategyParse: 'mechanical',
}

/**
 * Hard-fail latency per tempo: double the product ceilings (60s / 5s) for
 * wiggle room, since the bench measures a gateway round trip, not the app.
 */
export const LATENCY_CEILING_MS: Readonly<Record<SiteTempo, number>> = {
  deck: 120_000,
  mechanical: 10_000,
}

/**
 * How many times a build makes each call, from the call-site inventory
 * (issue #51: one combo pass, six model-filled sections, a strategy parse
 * ahead of the build and one per fill). The projected build cost is the
 * per-call cost times this.
 */
export const CALLS_PER_BUILD: Readonly<Record<GateSite, number>> = {
  'chat.generate': 1,
  suggestCombos: 1,
  fillSection: 6,
  'chat.classify': 1,
  strategyParse: 7,
}

/** The map's cost ceiling: under five cents per completed deck build. */
export const MAX_PROJECTED_BUILD_COST_USD = 0.05

/** Reliability: runs per scenario, and what fraction of them must clear. */
export const RUNS_PER_SCENARIO = 5
export const MIN_HARD_FAIL_FREE_RATE = 0.9
export const MAX_HARD_FAILS_PER_SCENARIO = 1

/** A misrouted intent costs a full deck call, so the classifier is held high. */
export const MIN_CLASSIFY_ACCURACY = 0.95

/** Rung 3 on more than this share of runs is reported prominently. */
export const PROMINENT_RUNG_3_RATE = 0.2

// ── Inputs ──────────────────────────────────────────────────────────────────

/** What the bench knows about a scenario before any model answers it. */
export interface GateScenario {
  /** Deck colours as W/U/B/R/G letters. Cards outside them count as off-color. */
  colors: readonly string[]
  /** Archetype id from `section-plan.ts`; picks the land target. */
  archetype?: string
  /** `chat.classify` only: the label the scenario was written to produce. */
  expectedLabel?: string
  /** `fillSection` only: how many cards the section asked for. */
  requestedCount?: number
}

/** One model response and the measurements the gateway returned with it. */
export interface GateRunInput {
  site: GateSite
  scenario: GateScenario
  /** The raw response text, as the model wrote it. */
  text: string
  /** The provider's stop reason, in the shape `isTruncated` reads. */
  stopReason: string | null
  durationMs: number
  costUsd: number
  /** Reasoning tokens billed on top of the answer, when the gateway reports them. */
  reasoningTokens?: number
}

/**
 * What Scryfall said about one card the model named. The hard-filter fields
 * are the `HardFilterCard` slice so `getHardFilterRejectionReason` can run on
 * it unchanged.
 */
export interface CardFact extends HardFilterCard {
  name: string
  cmc: number
  color_identity: string[]
}

/**
 * The lookups the wrapper performs. A card name that maps to `null` does not
 * exist; a name absent from the map was never looked up and counts the same
 * way, so a wrapper that skips a name cannot pass it by accident. A query
 * maps to its Scryfall result count, or `null` when Scryfall rejected it.
 */
export interface GateFacts {
  cards: ReadonlyMap<string, CardFact | null>
  queries?: ReadonlyMap<string, number | null>
}

// ── Outputs ─────────────────────────────────────────────────────────────────

/**
 * Every score the gate can produce. A profile fills the ones that apply and
 * leaves the rest null, so the bench renders one scoreboard for every site.
 */
export interface GateScores {
  /** Ladder rung that yielded JSON; null when the site is not JSON-shaped or nothing parsed. */
  rung: JsonLadderRung | null
  costUsd: number
  /** `costUsd × CALLS_PER_BUILD[site]`. */
  projectedBuildCostUsd: number
  latencyMs: number
  reasoningTokens: number | null
  /** Distinct card names the model wrote, before any repair. */
  cardsNamed: number | null
  /** Names Scryfall could not find. Always a hard fail; kept here so the bench can list them. */
  nonexistentCards: string[]
  /** Cards the app's hard filter rejects (`getHardFilterRejectionReason`). */
  offPoolCards: string[]
  /** Cards whose colour identity leaves the scenario's colours. */
  offColorCards: string[]
  /** `|raw copies − 60|` for a deck; `|raw copies − requested|` for a fill. */
  countDistance: number | null
  /** Copies beyond the 4-copy rule, summed over non-basic cards. */
  overCopies: number | null
  /** Copies `enforceDeck` changed - clamped, trimmed, or padded - to reach 60. */
  repairDistance: number | null
  landCount: number | null
  landVerdict: LandCountVerdict | null
  /** `|landCount − landCountForArchetype(archetype)|`. */
  landDistance: number | null
  averageManaValue: number | null
  curveTooHigh: boolean | null
  /** `suggestCombos`: combos that survived the parser. */
  combos: number | null
  /** `chat.classify`: the label the model wrote, normalized. */
  label: string | null
  /** `chat.classify`: whether it matched the scenario's expected label. */
  correct: boolean | null
  /** `strategyParse`: clean fragments extracted (0..MAX_STRATEGY_QUERIES). */
  fragments: number | null
  /** `strategyParse`: fragments Scryfall rejected or returned nothing for. */
  missedQueries: string[]
}

/** The gate's verdict on one run. */
export interface GateRun {
  site: GateSite
  /** Null when the run clears every hard check; otherwise the reasons, ` · `-joined. */
  hardFail: string | null
  scores: GateScores
}

// ── Probes: what the wrapper must look up ───────────────────────────────────

/** The Scryfall lookups a run needs before `checkRun` can judge it. */
export interface GateProbes {
  cardNames: string[]
  queries: string[]
}

/**
 * Which card names and queries the response carries. A response that does not
 * parse carries none - the wrapper then makes no request and the run fails
 * on parse alone.
 */
export function gateProbes(site: GateSite, text: string): GateProbes {
  const none: GateProbes = { cardNames: [], queries: [] }
  try {
    switch (site) {
      case 'chat.generate':
        return { cardNames: uniqueNames(parseDeckResponse(text).cards), queries: [] }
      case 'fillSection':
        return { cardNames: uniqueNames(parseSectionResponse(text).cards), queries: [] }
      case 'suggestCombos':
        return {
          cardNames: unique(parseComboResponse(text).combos.flatMap((c) => c.cards)),
          queries: [],
        }
      case 'strategyParse':
        return { cardNames: [], queries: extractStrategyQueries(text) }
      case 'chat.classify':
        return none
    }
  } catch {
    return none
  }
}

function uniqueNames(cards: readonly GeneratedCard[]): string[] {
  return unique(cards.map((c) => c.name))
}

function unique(names: readonly string[]): string[] {
  return Array.from(new Set(names))
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Judge one run. Pure: everything Scryfall knows arrives in `facts`.
 *
 * Order is the shared checks first - a truncated or over-budget response is
 * disqualified whatever it contains - then the site's profile. Hard-fail
 * reasons accumulate rather than short-circuit, so the bench can show that a
 * run was both truncated and over the latency ceiling.
 */
export function checkRun(input: GateRunInput, facts: GateFacts): GateRun {
  const hardFails: string[] = []
  const scores = emptyScores(input)

  if (isTruncated(input)) hardFails.push('truncated')

  const ceiling = LATENCY_CEILING_MS[SITE_TEMPO[input.site]]
  if (input.durationMs > ceiling) hardFails.push(`latency ${formatSeconds(input.durationMs)} > ${formatSeconds(ceiling)}`)

  if (scores.projectedBuildCostUsd > MAX_PROJECTED_BUILD_COST_USD) {
    hardFails.push(`projected build $${scores.projectedBuildCostUsd.toFixed(4)} > $${MAX_PROJECTED_BUILD_COST_USD}`)
  }

  PROFILES[input.site](input, facts, scores, hardFails)

  return { site: input.site, hardFail: hardFails.length === 0 ? null : hardFails.join(' · '), scores }
}

function emptyScores(input: GateRunInput): GateScores {
  return {
    rung: null,
    costUsd: input.costUsd,
    projectedBuildCostUsd: input.costUsd * CALLS_PER_BUILD[input.site],
    latencyMs: input.durationMs,
    reasoningTokens: input.reasoningTokens ?? null,
    cardsNamed: null,
    nonexistentCards: [],
    offPoolCards: [],
    offColorCards: [],
    countDistance: null,
    overCopies: null,
    repairDistance: null,
    landCount: null,
    landVerdict: null,
    landDistance: null,
    averageManaValue: null,
    curveTooHigh: null,
    combos: null,
    label: null,
    correct: null,
    fragments: null,
    missedQueries: [],
  }
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** A check profile: the site-specific checks, writing into the shared score sheet. */
type CheckProfile = (
  input: GateRunInput,
  facts: GateFacts,
  scores: GateScores,
  hardFails: string[],
) => void

/**
 * One profile per output shape, in one record so a new site cannot get a
 * profile without a tempo and a calls-per-build row (the `Record<GateSite>`
 * type makes each omission a compile error).
 */
const PROFILES: Readonly<Record<GateSite, CheckProfile>> = {
  'chat.generate': (input, facts, scores, hardFails) => {
    const parsed = parseOrFail(() => readDeckResponse(input.text), scores, hardFails)
    if (parsed === null) return
    scoreCards(parsed.cards, input.scenario, facts, scores, hardFails)
    scoreDeckShape(parsed.cards, input.scenario, facts, scores)
  },

  fillSection: (input, facts, scores, hardFails) => {
    const parsed = parseOrFail(() => readSectionResponse(input.text), scores, hardFails)
    if (parsed === null) return
    scoreCards(parsed.cards, input.scenario, facts, scores, hardFails)
    const requested = input.scenario.requestedCount
    if (requested !== undefined) scores.countDistance = Math.abs(totalCopies(parsed.cards.map(asEntry)) - requested)
  },

  suggestCombos: (input, facts, scores, hardFails) => {
    const parsed = parseOrFail(() => readComboResponse(input.text), scores, hardFails)
    if (parsed === null) return
    scores.combos = parsed.combos.length
    if (parsed.combos.length === 0) hardFails.push('no combos')
    const named = unique(parsed.combos.flatMap((c) => c.cards)).map((name) => ({ name, quantity: 1 }))
    scoreCards(named, input.scenario, facts, scores, hardFails)
  },

  'chat.classify': (input, _facts, scores, hardFails) => {
    // The site itself reads the label this way: trimmed, lowercased, and
    // anything unrecognized falls through to 'rebuild'. Here an unrecognized
    // label is a shape failure, not a silent default.
    const label = input.text.trim().toLowerCase()
    scores.label = label
    if (!CLASSIFY_LABELS.has(label)) {
      hardFails.push(`label "${truncateForReason(label)}" not one of ${Array.from(CLASSIFY_LABELS).join('/')}`)
      scores.correct = false
      return
    }
    const expected = input.scenario.expectedLabel
    scores.correct = expected === undefined ? null : label === expected
  },

  strategyParse: (input, facts, scores, hardFails) => {
    // Shape only (issue #55): the extractor already caps and cleans, so the
    // one unusable shape is nothing extractable at all. Syntax is scored
    // through Scryfall - a query that errors or matches nothing is a miss.
    const fragments = extractStrategyQueries(input.text)
    scores.fragments = fragments.length
    if (fragments.length === 0) {
      hardFails.push(`no usable fragments (wanted 1-${MAX_STRATEGY_QUERIES})`)
      return
    }
    scores.missedQueries = fragments.filter((q) => {
      const count = facts.queries?.get(q)
      return count === undefined || count === null || count === 0
    })
  },
}

const CLASSIFY_LABELS: ReadonlySet<string> = new Set(['delta', 'rebuild', 'question'])

function truncateForReason(label: string): string {
  return label.length > 24 ? `${label.slice(0, 24)}…` : label
}

/**
 * Run a site parser and translate its two failure messages into the gate's
 * two parse hard fails. Anything else the parser throws is a bug in the
 * parser, not a property of the model, so it propagates.
 */
function parseOrFail<T>(read: () => ReadResponse<T>, scores: GateScores, hardFails: string[]): T | null {
  try {
    const parsed = read()
    scores.rung = parsed.rung
    return parsed.value
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === UNPARSEABLE_RESPONSE_MESSAGE) hardFails.push('no JSON at any rung')
    else if (message === INVALID_FORMAT_MESSAGE) hardFails.push('schema mismatch')
    else throw err
    return null
  }
}

function asEntry(card: GeneratedCard): { key: string; quantity: number } {
  return { key: card.name, quantity: card.quantity }
}

/**
 * The checks every card-naming site shares: existence (hard), the hard filter
 * (scored as off-pool), and colour identity (scored as off-color). A card
 * Scryfall does not know has no facts, so it appears in no other list.
 */
function scoreCards(
  cards: readonly GeneratedCard[],
  scenario: GateScenario,
  facts: GateFacts,
  scores: GateScores,
  hardFails: string[],
): void {
  const names = uniqueNames(cards)
  scores.cardsNamed = names.length
  const colors = new Set(scenario.colors.map((c) => c.toUpperCase()))

  for (const name of names) {
    const fact = facts.cards.get(name)
    if (fact === undefined || fact === null) {
      scores.nonexistentCards.push(name)
      continue
    }
    if (getHardFilterRejectionReason(fact) !== null) scores.offPoolCards.push(name)
    if (fact.color_identity.some((c) => !colors.has(c.toUpperCase()))) scores.offColorCards.push(name)
  }

  if (scores.nonexistentCards.length > 0) {
    hardFails.push(`nonexistent: ${scores.nonexistentCards.join(', ')}`)
  }
}

/**
 * The deck-shaped scores: raw count, over-copies, repair distance, the land
 * band and the curve. All of it from the deck rules; nothing here knows a
 * number of its own.
 */
function scoreDeckShape(
  cards: readonly GeneratedCard[],
  scenario: GateScenario,
  facts: GateFacts,
  scores: GateScores,
): void {
  const raw = mergeByName(cards)
  const rawCopies = totalCopies(raw.map(asEntry))
  scores.countDistance = Math.abs(rawCopies - TARGET_DECK_SIZE)

  const typeLineOf = (name: string) => facts.cards.get(name)?.type_line ?? ''
  const isBasic = (name: string) => isBasicLandName(name) || isBasicLandTypeLine(typeLineOf(name))
  const isLand = (name: string) => isBasic(name) || isLandTypeLine(typeLineOf(name))

  scores.overCopies = raw.reduce((sum, c) => sum + (isBasic(c.name) ? 0 : Math.max(0, c.quantity - MAX_COPIES)), 0)

  // Repair distance: what the production enforcer changes to reach 60. Run on
  // a copy, with the same type-line knowledge the wizard would have had.
  const cardTypes: Record<string, string> = {}
  for (const [name, fact] of facts.cards) if (fact !== null) cardTypes[name] = fact.type_line
  const enforced = enforceDeckSize(
    { name: '', description: '', cards: raw.map((c) => ({ ...c })) },
    undefined,
    { colors: [...scenario.colors], cardTypes },
  )
  const before = new Map(raw.map((c) => [c.name, c.quantity]))
  const after = new Map(enforced.cards.map((c) => [c.name, c.quantity]))
  let distance = 0
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    distance += Math.abs((before.get(name) ?? 0) - (after.get(name) ?? 0))
  }
  scores.repairDistance = distance

  // Land band and curve, on the raw deck - ADR 0005: the land count is planned
  // and repairable, the curve is advice. Both are scores, never hard fails.
  const landCount = raw.reduce((sum, c) => sum + (isLand(c.name) ? c.quantity : 0), 0)
  scores.landCount = landCount
  scores.landVerdict = checkLandCount(landCount)
  scores.landDistance = Math.abs(landCount - landCountForArchetype(scenario.archetype))

  let spellCopies = 0
  let manaValueSum = 0
  for (const c of raw) {
    if (isLand(c.name)) continue
    const fact = facts.cards.get(c.name)
    if (fact === undefined || fact === null) continue
    spellCopies += c.quantity
    manaValueSum += fact.cmc * c.quantity
  }
  if (spellCopies > 0) {
    scores.averageManaValue = manaValueSum / spellCopies
    scores.curveTooHigh = isAverageManaValueTooHigh(scores.averageManaValue)
  }
}

/** Merge duplicate names the way `enforceDeck` will, so the raw counts agree with it. */
function mergeByName(cards: readonly GeneratedCard[]): GeneratedCard[] {
  const merged = new Map<string, number>()
  for (const c of cards) merged.set(c.name, (merged.get(c.name) ?? 0) + c.quantity)
  return Array.from(merged, ([name, quantity]) => ({ name, quantity }))
}

// ── Clearing the gate: the aggregate over runs ──────────────────────────────

/** A judged run tagged with the scenario it answered. */
export interface ScenarioRun {
  scenarioId: string
  run: GateRun
}

export interface GateVerdict {
  /** True when every reliability rule holds. */
  clears: boolean
  /** Why not, one line per failed rule; empty when it clears. */
  reasons: string[]
  runs: number
  hardFails: number
  hardFailFreeRate: number
  /** Scenario id -> hard fails in it, for the scenarios over the per-scenario limit. */
  failingScenarios: Record<string, number>
  /** Share of runs that needed ladder rung 3; flagged when over PROMINENT_RUNG_3_RATE. */
  rung3Rate: number
  rung3Prominent: boolean
  /** `chat.classify` only: correct / judged. Null elsewhere. */
  classifyAccuracy: number | null
}

/**
 * Does a candidate clear the gate on this site? Issue #55: at least 90% of
 * all runs hard-fail-free, no scenario failing more than once, and for
 * `chat.classify` at least 95% accuracy over the runs that carried an expected
 * label. An empty run set does not clear - it has not been measured.
 */
export function clearsGate(site: GateSite, runs: readonly ScenarioRun[]): GateVerdict {
  const reasons: string[] = []
  const total = runs.length
  const hardFails = runs.filter((r) => r.run.hardFail !== null).length
  const hardFailFreeRate = total === 0 ? 0 : (total - hardFails) / total

  if (total === 0) reasons.push('no runs')
  if (total > 0 && hardFailFreeRate < MIN_HARD_FAIL_FREE_RATE) {
    reasons.push(`${Math.round(hardFailFreeRate * 100)}% hard-fail-free < ${MIN_HARD_FAIL_FREE_RATE * 100}%`)
  }

  const perScenario = new Map<string, number>()
  for (const r of runs) {
    if (r.run.hardFail !== null) perScenario.set(r.scenarioId, (perScenario.get(r.scenarioId) ?? 0) + 1)
  }
  const failingScenarios: Record<string, number> = {}
  for (const [id, count] of perScenario) {
    if (count > MAX_HARD_FAILS_PER_SCENARIO) failingScenarios[id] = count
  }
  const failingIds = Object.keys(failingScenarios)
  if (failingIds.length > 0) {
    reasons.push(`${failingIds.length} scenario${failingIds.length === 1 ? '' : 's'} failed more than ${MAX_HARD_FAILS_PER_SCENARIO}×`)
  }

  const rung3 = runs.filter((r) => r.run.scores.rung === 3).length
  const rung3Rate = total === 0 ? 0 : rung3 / total
  const rung3Prominent = rung3Rate > PROMINENT_RUNG_3_RATE

  let classifyAccuracy: number | null = null
  if (site === 'chat.classify') {
    const judged = runs.filter((r) => r.run.scores.correct !== null)
    const correct = judged.filter((r) => r.run.scores.correct === true).length
    classifyAccuracy = judged.length === 0 ? 0 : correct / judged.length
    if (classifyAccuracy < MIN_CLASSIFY_ACCURACY) {
      reasons.push(`classify accuracy ${Math.round(classifyAccuracy * 100)}% < ${MIN_CLASSIFY_ACCURACY * 100}%`)
    }
  }

  return {
    clears: reasons.length === 0,
    reasons,
    runs: total,
    hardFails,
    hardFailFreeRate,
    failingScenarios,
    rung3Rate,
    rung3Prominent,
    classifyAccuracy,
  }
}
