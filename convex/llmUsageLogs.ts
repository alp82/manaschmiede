import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'

export const create = internalMutation({
  args: {
    action: v.string(),
    provider: v.string(),
    model: v.string(),
    systemPrompt: v.string(),
    inputMessages: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('llmUsageLogs', {
      ...args,
      status: 'pending',
    })
  },
})

export const complete = internalMutation({
  args: {
    id: v.id('llmUsageLogs'),
    status: v.union(v.literal('complete'), v.literal('error')),
    outputText: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args
    await ctx.db.patch(id, fields)
  },
})

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('llmUsageLogs')
      .order('desc')
      .take(args.limit ?? 50)
  },
})

/** Aggregates stats over the most recent 500 log entries. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query('llmUsageLogs').order('desc').take(500)
    let totalCalls = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCostUsd = 0
    let totalDurationMs = 0
    let pendingCalls = 0
    const byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = {}
    const byAction: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = {}

    for (const log of logs) {
      totalCalls++
      if (log.status === 'pending') {
        pendingCalls++
        continue
      }
      totalInputTokens += log.inputTokens ?? 0
      totalOutputTokens += log.outputTokens ?? 0
      totalCostUsd += log.estimatedCostUsd ?? 0
      totalDurationMs += log.durationMs ?? 0

      if (!byModel[log.model]) {
        byModel[log.model] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      }
      byModel[log.model].calls++
      byModel[log.model].inputTokens += log.inputTokens ?? 0
      byModel[log.model].outputTokens += log.outputTokens ?? 0
      byModel[log.model].costUsd += log.estimatedCostUsd ?? 0

      if (!byAction[log.action]) {
        byAction[log.action] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      }
      byAction[log.action].calls++
      byAction[log.action].inputTokens += log.inputTokens ?? 0
      byAction[log.action].outputTokens += log.outputTokens ?? 0
      byAction[log.action].costUsd += log.estimatedCostUsd ?? 0
    }

    return {
      totalCalls,
      pendingCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      totalDurationMs,
      byModel,
      byAction,
    }
  },
})

