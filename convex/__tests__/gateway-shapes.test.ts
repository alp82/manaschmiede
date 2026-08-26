import { describe, expect, it } from 'vitest'
import {
  buildGatewayBody,
  readGatewayError,
  readGatewayModels,
  readGatewayResponse,
  type GatewayRequest,
} from '../lib/gatewayShapes'
import { DECK_SCHEMA } from '../lib/responseSchemas'
import { isTruncated } from '../lib/anthropic'

/**
 * The OpenRouter shapes issue #54 fixed: one request body for every
 * candidate, a normalized stop reason with the native one beside it, cost
 * and cache accounting straight from `usage`, and the five failure surfaces
 * read in order.
 */

const base: GatewayRequest = {
  model: 'anthropic/claude-sonnet-5',
  system: 'You build decks.',
  messages: [{ role: 'user', content: 'Build me an elf deck' }],
  maxTokens: 4096,
  structured: 'json_schema',
  schema: DECK_SCHEMA,
  schemaName: 'deck',
}

describe('buildGatewayBody', () => {
  it('sends the system prompt as the first message and requires the parameters it uses', () => {
    const body = buildGatewayBody(base)
    expect(body.messages).toEqual([
      { role: 'system', content: 'You build decks.' },
      { role: 'user', content: 'Build me an elf deck' },
    ])
    expect(body.max_tokens).toBe(4096)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'deck', strict: true, schema: DECK_SCHEMA },
    })
    expect(body.provider).toEqual({ require_parameters: true })
  })

  it('pins a provider with fallbacks off', () => {
    const body = buildGatewayBody({ ...base, provider: 'deepseek' })
    expect(body.provider).toEqual({ require_parameters: true, order: ['deepseek'], allow_fallbacks: false })
  })

  it('expresses json_object and none as rungs 3 and 4', () => {
    expect(buildGatewayBody({ ...base, structured: 'json_object' }).response_format).toEqual({ type: 'json_object' })
    expect(buildGatewayBody({ ...base, structured: 'none' })).not.toHaveProperty('response_format')
  })

  it('refuses json_schema mode without a schema', () => {
    expect(() => buildGatewayBody({ ...base, schema: undefined })).toThrow(/schema/)
  })

  it('maps the reasoning axis onto the unified reasoning object', () => {
    expect(buildGatewayBody({ ...base, reasoning: { effort: 'low' } }).reasoning).toEqual({ effort: 'low' })
    expect(buildGatewayBody({ ...base, reasoning: { maxTokens: 2000 } }).reasoning).toEqual({ max_tokens: 2000 })
    expect(buildGatewayBody({ ...base, reasoning: 'off' }).reasoning).toEqual({ effort: 'none' })
    expect(buildGatewayBody(base)).not.toHaveProperty('reasoning')
  })
})

function ok(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return {
    model: 'anthropic/claude-sonnet-5',
    provider: 'Anthropic',
    choices: [
      {
        finish_reason: 'stop',
        native_finish_reason: 'end_turn',
        message: { content: '{"cards":[]}' },
        ...overrides,
      },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 800,
      cost: 0.0123,
      cache_discount: -0.001,
      prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 },
      completion_tokens_details: { reasoning_tokens: 500 },
      ...usage,
    },
  }
}

const requested = { model: 'anthropic/claude-sonnet-5', structured: 'json_schema' as const, durationMs: 4200 }

describe('readGatewayResponse', () => {
  it('reads cost, tokens, reasoning and cache accounting from usage', () => {
    const result = readGatewayResponse(ok(), requested)
    expect(result).toMatchObject({
      text: '{"cards":[]}',
      provider: 'Anthropic',
      inputTokens: 1200,
      outputTokens: 800,
      reasoningTokens: 500,
      cachedTokens: 1000,
      cacheWriteTokens: 200,
      cacheDiscount: -0.001,
      costUsd: 0.0123,
      durationMs: 4200,
      stopReason: 'stop',
      nativeFinishReason: 'end_turn',
      schemaEnforced: 'native',
      failure: null,
    })
  })

  it('records the rung the request asked for', () => {
    expect(readGatewayResponse(ok(), { ...requested, structured: 'json_object' }).schemaEnforced).toBe('json-only')
    expect(readGatewayResponse(ok(), { ...requested, structured: 'none' }).schemaEnforced).toBe('none')
  })

  it('reads a truncation as length and keeps the native reason', () => {
    const result = readGatewayResponse(ok({ finish_reason: 'length', native_finish_reason: 'max_tokens' }), requested)
    expect(result.stopReason).toBe('length')
    expect(result.nativeFinishReason).toBe('max_tokens')
    expect(result.failure).toBe('truncated')
    expect(isTruncated(result)).toBe(true)
  })

  it('tolerates a null native_finish_reason and an unknown finish_reason', () => {
    const result = readGatewayResponse(ok({ finish_reason: 'whatever', native_finish_reason: null }), requested)
    expect(result.stopReason).toBeNull()
    expect(result.nativeFinishReason).toBeNull()
  })

  it('checks a provider error on a 200 before reading the content', () => {
    const result = readGatewayResponse(
      ok({ finish_reason: 'error', error: { code: 502, message: 'upstream' }, message: { content: '{"partial' } }),
      requested,
    )
    expect(result.failure).toBe('provider-error')
    expect(result.providerError).toEqual({ code: 502, message: 'upstream' })
    expect(result.text).toBe('{"partial')
  })

  it('reads a refusal before a truncation', () => {
    const result = readGatewayResponse(
      ok({ finish_reason: 'length', message: { content: '', refusal: 'I cannot help with that' } }),
      requested,
    )
    expect(result.failure).toBe('refused')
    expect(result.refusal).toBe('I cannot help with that')
  })

  it('reports an empty body', () => {
    expect(readGatewayResponse(ok({ message: { content: '  ' } }), requested).failure).toBe('empty')
  })

  it('defaults every missing usage field to zero', () => {
    const result = readGatewayResponse({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }, requested)
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, costUsd: 0, provider: null })
    expect(result.model).toBe(requested.model)
  })
})

describe('readGatewayError', () => {
  it('types a 400 refusal as refused', () => {
    const error = readGatewayError(400, JSON.stringify({ error: { message: 'nope', metadata: { error_type: 'refusal' } } }))
    expect(error).toEqual({ status: 400, message: 'nope', refused: true })
  })

  it('keeps a non-JSON body as the message', () => {
    expect(readGatewayError(502, 'Bad Gateway')).toEqual({ status: 502, message: 'Bad Gateway', refused: false })
  })
})

describe('readGatewayModels', () => {
  it('reads both pricing shapes and scales to per million tokens', () => {
    const models = readGatewayModels({
      data: [
        { id: 'a/one', pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['response_format'] },
        {
          id: 'b/two',
          name: 'Two',
          pricing: { input: 0.000001, output: 0.000005 },
          reasoning: { mandatory: true, supported_efforts: ['low', 'high'], default_effort: 'high' },
        },
        { name: 'no id' },
      ],
    })
    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({ id: 'a/one', name: 'a/one', pricing: { input: 3, output: 15 }, reasoning: null })
    expect(models[1]).toMatchObject({
      pricing: { input: 1, output: 5 },
      reasoning: { mandatory: true, defaultEnabled: null, supportedEfforts: ['low', 'high'], defaultEffort: 'high' },
    })
  })
})
