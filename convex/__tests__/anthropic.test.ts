import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnthropic, isTruncated } from '../lib/anthropic'

/**
 * Coverage for the `stop_reason` plumbing added so a response cut off at
 * `max_tokens` is reported as truncation instead of flowing on as if complete.
 */

function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      content: [{ text: '{"ok":true}' }],
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
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBe('max_tokens')
    expect(isTruncated(result)).toBe(true)
  })

  it('reports a complete response as not truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse()))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBe('end_turn')
    expect(isTruncated(result)).toBe(false)
  })

  it('falls back to null when the body carries no stop reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse({ stop_reason: undefined })))
    const result = await callAnthropic('sys', [{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeNull()
  })
})
