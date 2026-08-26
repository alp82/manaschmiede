/**
 * The JSON schema for each site's response shape, written once in the subset
 * every constrained-decoding provider accepts (#54): every property
 * `required`, `additionalProperties: false`, and no `minimum`, `pattern` or
 * length constraint - OpenAI and DeepSeek demand the first two, Anthropic
 * rejects the rest. A schema here mirrors the OUTPUT FORMAT block of the
 * site's prompt; the site's parser in `responseShapes.ts` is still the judge
 * of what came back, because the gateway's flag means accepted, not enforced.
 *
 * Zero runtime imports.
 */
import type { JsonSchema } from './gatewayShapes'

const CARD_ENTRY = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'English Oracle card name' },
    quantity: { type: 'integer' },
  },
  required: ['name', 'quantity'],
  additionalProperties: false,
} as const

/** `chat.generate`: a whole deck. */
export const DECK_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    explanation: { type: 'string' },
    total: { type: 'integer' },
    cards: { type: 'array', items: CARD_ENTRY },
  },
  required: ['name', 'description', 'explanation', 'total', 'cards'],
  additionalProperties: false,
}

/** `fillSection`: one section's cards. */
export const SECTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    cards: { type: 'array', items: CARD_ENTRY },
    explanation: { type: 'string' },
  },
  required: ['cards', 'explanation'],
  additionalProperties: false,
}

/** `suggestCombos`: five core combos. */
export const COMBO_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    combos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cards: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
        },
        required: ['name', 'cards', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['combos'],
  additionalProperties: false,
}

/** Schema and its stable name per bench site. */
export const SITE_SCHEMAS = {
  'chat.generate': { name: 'deck', schema: DECK_SCHEMA },
  fillSection: { name: 'section_fill', schema: SECTION_SCHEMA },
  suggestCombos: { name: 'combos', schema: COMBO_SCHEMA },
} as const

/** Keys a schema in the Anthropic subset must not use anywhere. */
export const FORBIDDEN_SCHEMA_KEYS = ['minimum', 'maximum', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format'] as const

/**
 * Does a schema stay inside the subset? Walks every object node: each must
 * list all its properties as required and forbid extras, and no node may carry
 * a constraint keyword. Used by the tests, and cheap enough for a bench to
 * assert before sending.
 */
export function schemaSubsetViolations(node: unknown, path = '$'): string[] {
  if (node === null || typeof node !== 'object') return []
  const violations: string[] = []
  const obj = node as Record<string, unknown>
  for (const key of FORBIDDEN_SCHEMA_KEYS) {
    if (key in obj) violations.push(`${path}: uses ${key}`)
  }
  if (obj.type === 'object') {
    const props = Object.keys((obj.properties as Record<string, unknown> | undefined) ?? {})
    const required = new Set((obj.required as string[] | undefined) ?? [])
    for (const p of props) if (!required.has(p)) violations.push(`${path}: ${p} not required`)
    if (obj.additionalProperties !== false) violations.push(`${path}: additionalProperties not false`)
    for (const p of props) {
      violations.push(...schemaSubsetViolations((obj.properties as Record<string, unknown>)[p], `${path}.${p}`))
    }
  }
  if (obj.type === 'array') violations.push(...schemaSubsetViolations(obj.items, `${path}[]`))
  return violations
}
