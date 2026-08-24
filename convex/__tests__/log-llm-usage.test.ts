import { describe, expect, it, vi } from 'vitest'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { LlmResult } from '../lib/anthropic'
import { TRUNCATED_RESPONSE_MESSAGE } from '../lib/anthropic'
import { parseAndLog } from '../lib/logLlmUsage'

/**
 * `parseAndLog` decides what a log entry says. Before it existed the entry was
 * completed before parsing, so a truncated or unparseable response was recorded
 * as `status: 'complete'`.
 */

const LOG_ID = 'log_1' as Id<'llmUsageLogs'>

function llmResult(overrides: Partial<LlmResult> = {}): LlmResult {
  return {
    text: '{"ok":true}',
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 10,
    outputTokens: 20,
    durationMs: 5,
    estimatedCostUsd: 0.001,
    stopReason: 'end_turn',
    ...overrides,
  }
}

function fakeCtx() {
  const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => undefined)
  return { ctx: { runMutation } as unknown as ActionCtx, runMutation }
}

describe('parseAndLog', () => {
  it('returns the parsed value and logs the call as complete', async () => {
    const { ctx, runMutation } = fakeCtx()
    const parsed = await parseAndLog(ctx, LOG_ID, llmResult(), JSON.parse)
    expect(parsed).toEqual({ ok: true })
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      status: 'complete',
      outputText: '{"ok":true}',
      stopReason: 'end_turn',
    })
  })

  it('reports a truncated response that fails to parse as truncation', async () => {
    const { ctx, runMutation } = fakeCtx()
    await expect(
      parseAndLog(ctx, LOG_ID, llmResult({ text: '{"a":', stopReason: 'max_tokens' }), JSON.parse),
    ).rejects.toThrow(TRUNCATED_RESPONSE_MESSAGE)
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      status: 'error',
      error: TRUNCATED_RESPONSE_MESSAGE,
      stopReason: 'max_tokens',
    })
  })

  it('keeps a truncated response the parser still accepts', async () => {
    // The cap can land after the JSON closes. Discarding usable output because
    // stop_reason says max_tokens would cost the user a good answer.
    const { ctx, runMutation } = fakeCtx()
    const parsed = await parseAndLog(ctx, LOG_ID, llmResult({ stopReason: 'max_tokens' }), JSON.parse)
    expect(parsed).toEqual({ ok: true })
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      status: 'complete',
      stopReason: 'max_tokens',
    })
  })

  it('keeps the token counts and cost on an errored entry', async () => {
    const { ctx, runMutation } = fakeCtx()
    await expect(
      parseAndLog(ctx, LOG_ID, llmResult(), () => {
        throw new Error('Could not parse AI response as JSON')
      }),
    ).rejects.toThrow(/Could not parse AI response as JSON/)
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      status: 'error',
      error: 'Could not parse AI response as JSON',
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.001,
    })
  })

  it('parses without logging when the entry could not be created', async () => {
    const { ctx, runMutation } = fakeCtx()
    const parsed = await parseAndLog(ctx, null, llmResult(), JSON.parse)
    expect(parsed).toEqual({ ok: true })
    expect(runMutation).not.toHaveBeenCalled()
  })
})
