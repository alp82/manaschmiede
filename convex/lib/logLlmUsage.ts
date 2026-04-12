import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import type { LlmResult } from './anthropic'
import type { Id } from '../_generated/dataModel'

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
      outputText: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      estimatedCostUsd: result.estimatedCostUsd,
    })
  } catch {
    console.error('Failed to complete LLM log entry')
  }
}

/** Mark a pending log entry as errored. */
export async function failLlmLog(
  ctx: ActionCtx,
  id: Id<'llmUsageLogs'> | null,
  error: string,
): Promise<void> {
  if (!id) return
  try {
    await ctx.runMutation(internal.llmUsageLogs.complete, {
      id,
      status: 'error',
      error,
    })
  } catch {
    console.error('Failed to mark LLM log entry as errored')
  }
}
