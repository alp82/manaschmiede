/**
 * The one JSON-out-of-an-LLM-response parser.
 *
 * Every action that asks a model for JSON gets the same three-rung ladder, so a
 * response wrapped in a code fence or buried in prose still parses, and a
 * truncated one fails the same way everywhere.
 *
 * This module gets *some* JSON out of a response; `parseCardList.ts` owns the
 * step after it - turning that unknown value into the lists and scalars a
 * caller asked for. Card-list callers go through parseCardList and should not
 * reach for this directly.
 *
 * Zero runtime imports, so it is importable from node tests the same way
 * cardPoolQueries.ts and deltaPrompt.ts are.
 */

/** Thrown when no rung of the ladder yields JSON. */
export const UNPARSEABLE_RESPONSE_MESSAGE = 'Could not parse AI response as JSON'

/** Matches a ```json ... ``` block, or a bare ``` ... ``` one. */
const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/

/** Matches the first brace-delimited object in surrounding prose. */
export const ANY_OBJECT_PATTERN = /\{[\s\S]*\}/

/**
 * Parse the JSON an LLM response carries.
 *
 * Ladder: plain JSON.parse -> the first code fence -> the first object matching
 * `embeddedPattern`, if one is given. Each rung guards its own parse, so a
 * fence holding truncated JSON falls through to the next rung instead of
 * leaking its SyntaxError to the caller.
 *
 * Pass `embeddedPattern` to enable the third rung. Anchor it on a key the shape
 * must have (`"cards"`, say) where the response shares its prose with other
 * objects; use ANY_OBJECT_PATTERN where it does not.
 *
 * Throws UNPARSEABLE_RESPONSE_MESSAGE when every rung fails. The returned value
 * is unvalidated - it is whatever the model wrote, cast to T.
 */
export function parseJsonLadder<T>(text: string, embeddedPattern?: RegExp): T {
  const climbed = climbJsonLadder<T>(text, embeddedPattern)
  if (climbed === null) throw new Error(UNPARSEABLE_RESPONSE_MESSAGE)
  return climbed.value
}

/** Which rung of the ladder yielded JSON: 1 plain, 2 fenced, 3 embedded in prose. */
export type JsonLadderRung = 1 | 2 | 3

/**
 * The same climb as `parseJsonLadder`, but reporting the rung that succeeded
 * and returning null instead of throwing. Rung 3 is a reliability signal: the
 * model was asked for JSON and wrote prose around it. The mechanical gate
 * scores on it; product code goes through `parseJsonLadder`.
 */
export function climbJsonLadder<T>(
  text: string,
  embeddedPattern?: RegExp,
): { value: T; rung: JsonLadderRung } | null {
  // 1. Plain JSON.
  try {
    return { value: JSON.parse(text) as T, rung: 1 }
  } catch {
    // fall through
  }

  // 2. Fenced ```json ... ``` or bare ``` ... ``` fence.
  const fenceMatch = text.match(FENCE_PATTERN)
  if (fenceMatch) {
    try {
      return { value: JSON.parse(fenceMatch[1].trim()) as T, rung: 2 }
    } catch {
      // fall through
    }
  }

  // 3. The first embedded object in surrounding prose.
  if (embeddedPattern) {
    const objectMatch = text.match(embeddedPattern)
    if (objectMatch) {
      try {
        return { value: JSON.parse(objectMatch[0]) as T, rung: 3 }
      } catch {
        // fall through
      }
    }
  }

  return null
}
