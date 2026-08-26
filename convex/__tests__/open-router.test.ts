import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayError, callOpenRouter, listOpenRouterModels } from '../lib/openRouter'
import { OPENROUTER_CHAT_URL, OPENROUTER_MODELS_URL } from '../lib/gatewayShapes'
import { COMBO_SCHEMA } from '../lib/responseSchemas'

/**
 * The fetch half: one key, the Bearer header, the body `buildGatewayBody`
 * makes, and an HTTP error that keeps its status and refusal type.
 */

const request = {
  model: 'openai/gpt-5.6-luna',
  system: 'sys',
  messages: [{ role: 'user', content: 'go' }],
  maxTokens: 512,
  structured: 'json_schema' as const,
  schema: COMBO_SCHEMA,
  schemaName: 'combos',
}

describe('callOpenRouter', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'or-test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('throws without a key before touching the network', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(callOpenRouter(request)).rejects.toThrow('OPENROUTER_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the built body with the bearer key and reads the result', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        provider: 'OpenAI',
        choices: [{ finish_reason: 'stop', native_finish_reason: 'stop', message: { content: '{"combos":[]}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 7, cost: 0.0002 },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callOpenRouter(request)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe(OPENROUTER_CHAT_URL)
    expect(init.headers.Authorization).toBe('Bearer or-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('openai/gpt-5.6-luna')
    expect(body.response_format.json_schema.name).toBe('combos')
    expect(result).toMatchObject({ text: '{"combos":[]}', provider: 'OpenAI', costUsd: 0.0002, failure: null })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('turns a typed 400 refusal into a refused GatewayError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: 'declined', metadata: { error_type: 'refusal' } } }),
      })),
    )
    const error = await callOpenRouter(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GatewayError)
    expect(error).toMatchObject({ status: 400, refused: true })
    expect((error as Error).message).toContain('declined')
  })

  it('keeps a 5xx as a non-refusal with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, text: async () => 'Bad Gateway' })))
    await expect(callOpenRouter(request)).rejects.toMatchObject({ status: 502, refused: false })
  })
})

describe('listOpenRouterModels', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'or-test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reads the models list', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'x/y', pricing: { prompt: '0.000001', completion: '0.000002' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const models = await listOpenRouterModels()
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(OPENROUTER_MODELS_URL)
    expect(models).toEqual([
      { id: 'x/y', name: 'x/y', pricing: { input: 1, output: 2 }, supportedParameters: [], reasoning: null },
    ])
  })
})
