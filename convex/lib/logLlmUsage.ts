import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { TRUNCATED_RESPONSE_MESSAGE, isTruncated, type LlmResult } from './anthropic'
import type { Id } from '../_generated/dataModel'

/** The response-side fields shared by the complete and error paths. */
function usageFields(result: LlmResult) {
  return {
    outputText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
    estimatedCostUsd: result.estimatedCostUsd,
    stopReason: result.stopReason ?? undefined,
  }
}

/** Create a pending log entry before the LLM call. Returns the entry ID. */
export async function startLlmLog(
  ctx: ActionCtx,
  action: string,
  model: string,
  systemPrompt: string,
  inputMessages: Array<{ role: string; content: string }>,
): Promise<Id<'llmUsageLogs'> | null> {
  try {
    return await ctx.runMutation(internal.llmUsageLogs.create, {
      action,
      provider: 'anthropic',
      model,
      systemPrompt,
      inputMessages,
    })
  } catch {
    console.error('Failed to create LLM log entry')
    return null
  }
}

/** Update a pending log entry with results. */
export async function completeLlmLog(
  ctx: ActionCtx,
  id: Id<'llmUsageLogs'> | null,
  result: LlmResult,
): Promise<void> {
  if (!id) return
  try {
    await ctx.runMutation(internal.llmUsageLogs.complete, {
      id,
      status: 'complete',
      ...usageFields(result),
    })
  } catch {
    console.error('Failed to complete LLM log entry')
  }
}

/**
 * Mark a pending log entry as errored. Pass `result` when the call itself
 * succeeded and the failure came later (truncation, an unparseable body) so the
 * entry still carries the response text, token counts, and cost.
 */
export async function failLlmLog(
  ctx: ActionCtx,
  id: Id<'llmUsageLogs'> | null,
  error: string,
  result?: LlmResult,
): Promise<void> {
  if (!id) return
  try {
    await ctx.runMutation(internal.llmUsageLogs.complete, {
      id,
      status: 'error',
      error,
      ...(result ? usageFields(result) : {}),
    })
  } catch {
    console.error('Failed to mark LLM log entry as errored')
  }
}

/**
 * Run `parse` against an LLM response and log what actually happened. A
 * response the parser rejects is logged as `error`, not `complete`, and the
 * error propagates to the caller.
 *
 * Where the response was also cut off at `max_tokens`, the caller is told about
 * the truncation instead of about the malformed JSON it caused - the length is
 * the actionable half. A truncated response the parser still accepts is kept:
 * `stopReason` records the truncation either way.
 */
export async function parseAndLog<T>(
  ctx: ActionCtx,
  id: Id<'llmUsageLogs'> | null,
  result: LlmResult,
  parse: (text: string) => T,
): Promise<T> {
  let parsed: T
  try {
    parsed = parse(result.text)
  } catch (err) {
    const failure = isTruncated(result)
      ? new Error(TRUNCATED_RESPONSE_MESSAGE)
      : err instanceof Error
        ? err
        : new Error(String(err))
    await failLlmLog(ctx, id, failure.message, result)
    throw failure
  }
  await completeLlmLog(ctx, id, result)
  return parsed
}
