/**
 * The bench's pure rules: which sites it evaluates, how a scenario is read
 * out of a real prompt, which candidates it runs first, and how runs get
 * their blind labels. Decided in #57 (board layout, live fan-out, replay only
 * seeds a scenario) and #52 (the bench-first six).
 *
 * A **scenario** is one real prompt - the exact system prompt and messages an
 * `llmUsageLogs` row carried - plus the facts the gate needs to judge an
 * answer to it (colours, archetype, requested count). The prompt is kept
 * verbatim so every candidate answers the same question; the facts are read
 * out of it here, because the log stores the prompt and nothing else.
 *
 * Zero runtime imports.
 */
import type { GateScenario, GateSite } from './mechanicalGate'
import type { ReasoningRequest, StructuredMode } from './gatewayShapes'

/** The three representative sites the map evaluates. */
export const BENCH_SITES = ['chat.generate', 'suggestCombos', 'fillSection'] as const satisfies readonly GateSite[]
export type BenchSite = (typeof BENCH_SITES)[number]

export function isBenchSite(action: string): action is BenchSite {
  return (BENCH_SITES as readonly string[]).includes(action)
}

/** What the board shows in the scenario strip, plus what the gate needs. */
export interface ScenarioFacts extends GateScenario {
  archetypes: string[]
  /** One line: the user's own words where the prompt has them, else the ask. */
  idea: string
}

const COLOR_LETTERS = new Set(['W', 'U', 'B', 'R', 'G'])

function uniqueLetters(matches: string[]): string[] {
  return Array.from(new Set(matches.filter((c) => COLOR_LETTERS.has(c))))
}

/**
 * Read a scenario's facts out of the prompt text. Each site writes its colours
 * and archetypes differently, so the patterns are per site and match the
 * prompt builders in `generateDeck.ts` / `suggestCombos.ts`:
 *
 * - `chat.generate` / `fillSection`: `buildIntentContextPrompt` writes
 *   `Allowed colors (HARD CONSTRAINT): White, Blue [WU]` and
 *   `Archetypes: Aggro (…), Tribal (…)`.
 * - `suggestCombos`: the user turn writes `SELECTED colors …: White (W)` and
 *   an `Archetypes:` list of `- Label (description)` lines.
 */
export function readScenarioFacts(
  site: BenchSite,
  systemPrompt: string,
  messages: ReadonlyArray<{ role: string; content: string }>,
): ScenarioFacts {
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  if (site === 'suggestCombos') {
    const colors = uniqueLetters((user.match(/\(([WUBRG])\)/g) ?? []).map((m) => m[1]))
    const archetypes = (user.match(/^- ([A-Za-z][^(\n]*?)\s*\(/gm) ?? []).map((m) => m.replace(/^- /, '').replace(/\s*\($/, '').trim())
    const idea = user.match(/described their deck as:\s*"([^"]+)"/)?.[1] ?? archetypes.join(' + ')
    return { colors, archetype: archetypeId(archetypes[0]), archetypes, idea: idea || 'core combos' }
  }

  const colors = uniqueLetters((systemPrompt.match(/Allowed colors \(HARD CONSTRAINT\):[^\n]*\[([WUBRG]+)\]/)?.[1] ?? '').split(''))
  const archetypes = (systemPrompt.match(/^Archetypes: (.+)$/m)?.[1] ?? '')
    .split(',')
    .map((a) => a.replace(/\s*\(.*$/, '').trim())
    .filter(Boolean)
  const strategy = systemPrompt.match(/^Strategy: (.+)$/m)?.[1]

  if (site === 'fillSection') {
    const requested = Number(lastUser.match(/exactly (\d+) cards/)?.[1])
    const section = lastUser.match(/Fill the "([^"]+)" section/)?.[1]
    const description = lastUser.match(/Section description: ([\s\S]+)$/)?.[1]?.trim()
    return {
      colors,
      archetype: archetypeId(archetypes[0]),
      archetypes,
      requestedCount: Number.isFinite(requested) ? requested : undefined,
      idea: section ? `${section}: ${description ?? ''}`.trim() : (description ?? 'section fill'),
    }
  }

  return {
    colors,
    archetype: archetypeId(archetypes[0]),
    archetypes,
    idea: strategy ?? firstLine(lastUser) ?? 'deck build',
  }
}

/** `Aggro (fast creatures)` -> `aggro`, the id `landCountForArchetype` keys on. */
function archetypeId(label: string | undefined): string | undefined {
  if (!label) return undefined
  return label.split(/\s+/)[0].toLowerCase()
}

function firstLine(text: string): string | undefined {
  const line = text.split('\n').find((l) => l.trim() !== '')
  return line?.trim()
}

// ── Candidates ──────────────────────────────────────────────────────────────

/** One model configuration the bench runs a scenario through. */
export interface BenchCandidate {
  model: string
  /** Provider slug to pin; unset lets the gateway route. */
  provider?: string
  structured: StructuredMode
  reasoning?: ReasoningRequest
  maxTokens: number
}

/**
 * `maxTokens` per site, sized for the answer alone. #51 warned that every cap
 * in the app assumes a model that answers directly; a reasoning model spends
 * this budget before it writes a character, so the bench doubles the app's
 * caps and records `reasoningTokens` so a truncation is diagnosed as budget.
 */
export const BENCH_MAX_TOKENS: Readonly<Record<BenchSite, number>> = {
  'chat.generate': 8192,
  suggestCombos: 8192,
  fillSection: 2048,
}

/**
 * The bench-first six from #52, with the structured mode #54 found each one
 * honours through OpenRouter. Slugs are the ones the live models list carried
 * on 2026-08-26; the bench checks them against the list before a run and
 * flags any that moved rather than failing at request time. DeepSeek is
 * `json_object` only, and #54 says pin its host.
 */
export function benchFirstCandidates(site: BenchSite): BenchCandidate[] {
  const maxTokens = BENCH_MAX_TOKENS[site]
  return [
    { model: 'openai/gpt-5.6-luna', provider: 'openai', structured: 'json_schema', maxTokens },
    { model: 'anthropic/claude-sonnet-5', provider: 'anthropic', structured: 'json_schema', maxTokens },
    { model: 'anthropic/claude-haiku-4.5', provider: 'anthropic', structured: 'json_schema', maxTokens },
    { model: 'inception/mercury-2', structured: 'json_schema', maxTokens },
    { model: 'meta/muse-spark-1.2', structured: 'json_schema', maxTokens },
    { model: 'deepseek/deepseek-v4-flash', provider: 'deepseek', structured: 'json_object', maxTokens },
  ]
}

// ── Blind labels ────────────────────────────────────────────────────────────

/**
 * Blind labels A, B, C … in an order that does not follow candidate order,
 * so the row position cannot leak the model. Seeded by the batch id so the
 * order is stable across reloads and sessions - the reviewer's "B" stays "B".
 */
export function blindLabels(runIds: readonly string[], seed: string): Map<string, string> {
  const order = [...runIds].sort((a, b) => hash(seed + a) - hash(seed + b))
  const labels = new Map<string, string>()
  order.forEach((id, i) => labels.set(id, String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '')))
  return labels
}

/** FNV-1a, enough to shuffle a handful of ids deterministically. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
