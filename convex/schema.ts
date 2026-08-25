import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  llmUsageLogs: defineTable({
    status: v.union(v.literal('pending'), v.literal('complete'), v.literal('error')),
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
    outputText: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    // Anthropic's stop_reason. 'max_tokens' means the response was cut off,
    // which is otherwise invisible in the log.
    stopReason: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index('by_action', ['action']),
})
