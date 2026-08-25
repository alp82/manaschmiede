import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODELS, callAnthropic, isTruncated } from '../lib/anthropic'

/**
 * Coverage for the `stop_reason` plumbing added so a response cut off at
 * `max_tokens` is reported as truncation instead of flowing on as if complete,
 * and for picking the text block out of a multi-block response body.
 */

function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: 'end_turn',
      ...overrides,
    }),
  }
}

describe('isTruncated', () => {
  it('is true only for a max_tokens stop reason', () => {
    expect(isTruncated({ stopReason: 'max_tokens' })).toBe(true)
    expect(isTruncated({ stopReason: 'end_turn' })).toBe(false)
    expect(isTruncated({ stopReason: 'stop_sequence' })).toBe(false)
    expect(isTruncated({ stopReason: null })).toBe(false)
  })
})

describe('callAnthropic', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('surfaces the stop reason from the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse({ stop_reason: 'max_tokens' })))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], { model: MODELS.fast })
    expect(result.stopReason).toBe('max_tokens')
    expect(isTruncated(result)).toBe(true)
  })

  it('reports a complete response as not truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse()))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], { model: MODELS.fast })
    expect(result.stopReason).toBe('end_turn')
    expect(isTruncated(result)).toBe(false)
  })

  it('falls back to null when the body carries no stop reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse({ stop_reason: undefined })))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], { model: MODELS.fast })
    expect(result.stopReason).toBeNull()
  })
  it('reads the text block, not whichever block came first', async () => {
    // A response can lead with a non-text block. Reading content[0] blindly
    // reported a perfectly good answer as "No response received from AI".
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        apiResponse({
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'the answer' },
          ],
        }),
      ),
    )
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], { model: MODELS.fast })
    expect(result.text).toBe('the answer')
  })

  it('throws when the response carries no text block at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiResponse({ content: [{ type: 'thinking', thinking: 'hmm' }] })),
    )
    await expect(callAnthropic('sys', [{ role: 'user', content: 'hi' }], { model: MODELS.fast })).rejects.toThrow(
      /No response received from AI/,
    )
  })

  it('prices a Haiku response at the published $1 / $5 per million rate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse()))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], {
      model: MODELS.fast,
    })
    // 10 input + 20 output tokens.
    expect(result.estimatedCostUsd).toBeCloseTo((10 * 1 + 20 * 5) / 1_000_000, 12)
  })

  it('prices the quality tier at the published $3 / $15 per million rate', async () => {
    // MODELS.main needs a MODEL_PRICING row of its own — without one it falls
    // through to the same default and every quality-tier cost silently reads
    // as an estimate nobody checked (#46).
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse()))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }], {
      model: MODELS.main,
    })
    expect(result.estimatedCostUsd).toBeCloseTo((10 * 3 + 20 * 15) / 1_000_000, 12)
  })
})
