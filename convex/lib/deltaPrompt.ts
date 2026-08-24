/**
 * Single-card delta-edit prompt + response parsing.
 *
 * The delta path is a small targeted edit: the model returns ONLY the named
 * cards to add/remove/swap (not a full 60-card deck). This module owns the
 * system prompt, the user-message framing, and the never-throw response parser.
 *
 * Zero runtime imports (no ActionCtx / fetch / callHaiku) so it is importable
 * from src/ node tests the same way cardPoolQueries.ts / strategyQueries.ts
 * are - the two modules it does import, jsonLadder.ts and cardFilters.ts, are
 * pure and zero-dependency themselves. generateDelta (in generateDeck.ts)
 * wraps parseDeltaResponse with ctx + logging.
 */

import { ANY_OBJECT_PATTERN, parseJsonLadder } from './jsonLadder'
import { HARD_FILTER_PROMPT_RULES } from './cardFilters'

/** Maximum entries kept in each direction of a delta edit. */
const DELTA_CAP = 3

export interface DeltaResult {
  remove: Array<{ name: string }>
  add: Array<{ name: string; quantity: number }>
  explanation: string
}

/** The op the user is hinting at. Used only to frame the user message. */
export type DeltaOp = 'add' | 'remove' | 'swap'

export const DELTA_SYSTEM_PROMPT = `You are an expert Magic: The Gathering casual deck builder making a SMALL, TARGETED edit to an existing 60-card deck.

The user wants to add, remove, or swap a few specific cards - NOT rebuild the deck. Return ONLY the named cards to change, never a full deck list.

RULES:
- Return ONLY the cards to add and/or remove. Do NOT return the unchanged deck.
- At most 3 cards in "remove" and at most 3 cards in "add".
- Use FULL English Oracle card names. For double-faced or split cards use the complete "Front // Back" name (e.g. "Delver of Secrets // Insectile Aberration").
- NEVER remove or change a card listed under LOCKED CARDS.
- Honor the deck's intent constraints (colors, archetypes, traits, strategy, budget) in DECK CONTEXT.
- On a swap, the replacement should serve the same role and fit the same section as the card it replaces.
- Only suggest real, existing Magic cards.
${HARD_FILTER_PROMPT_RULES}

OUTPUT FORMAT (JSON ONLY, no other text):
{
  "remove": [{ "name": "English Card Name" }],
  "add": [{ "name": "English Card Name", "quantity": 1 }],
  "explanation": "What changed and why (1-2 sentences)"
}

Respond ONLY with the JSON object. No explanatory text before or after.`

/**
 * Frame the user's request for the delta model. The op is a hint derived from
 * the classifier / message so the prompt nudges the model toward the right
 * shape, but the model is free to return whichever of add/remove is warranted.
 */
export function buildDeltaUserMessage(op: DeltaOp, userText: string): string {
  const hint =
    op === 'add'
      ? 'The user wants to ADD one or a few cards.'
      : op === 'remove'
        ? 'The user wants to REMOVE one or a few cards.'
        : 'The user wants to SWAP one or a few cards (remove some, add replacements).'
  return `${hint}\n\nRequest: ${userText}`
}

function safeEmpty(): DeltaResult {
  return { remove: [], add: [], explanation: '' }
}

/** Coerce an unknown parsed value into a clean DeltaResult, never throwing. */
function normalize(parsed: unknown): DeltaResult {
  if (parsed === null || typeof parsed !== 'object') return safeEmpty()
  const obj = parsed as Record<string, unknown>

  const rawRemove = Array.isArray(obj.remove) ? obj.remove : []
  const rawAdd = Array.isArray(obj.add) ? obj.add : []

  const remove = rawRemove
    .filter((e): e is { name: string } => {
      return e != null && typeof (e as { name?: unknown }).name === 'string'
    })
    .map((e) => ({ name: e.name }))
    .slice(0, DELTA_CAP)

  const add = rawAdd
    .filter((e): e is { name: string; quantity?: unknown } => {
      return e != null && typeof (e as { name?: unknown }).name === 'string'
    })
    .map((e) => ({
      name: e.name,
      quantity: typeof e.quantity === 'number' && e.quantity > 0 ? e.quantity : 1,
    }))
    .slice(0, DELTA_CAP)

  const explanation = typeof obj.explanation === 'string' ? obj.explanation : ''

  return { remove, add, explanation }
}

/**
 * Parse a delta model response into a DeltaResult. Never throws.
 *
 * Runs the shared ladder and swallows its failure: anything
 * malformed/empty/prose-only degrades to a safe-empty result, so the caller
 * never sees an exception.
 */
export function parseDeltaResponse(text: string): DeltaResult {
  if (typeof text !== 'string' || text.trim() === '') return safeEmpty()

  // A generic object match, not a "cards"-anchored one - the delta shape has
  // no "cards" key.
  try {
    return normalize(parseJsonLadder(text, ANY_OBJECT_PATTERN))
  } catch {
    return safeEmpty()
  }
}
