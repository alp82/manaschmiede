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
    // The provider's stop reason: Anthropic's 'max_tokens' or the gateway's
    // normalized 'length' both mean the response was cut off, which is
    // otherwise invisible in the log. `isTruncated` reads either.
    stopReason: v.optional(v.string()),
    error: v.optional(v.string()),
    // Gateway-reported spend detail (#58): reasoning billed beside the answer,
    // and what the provider's prompt cache did. Only a gateway call fills
    // these; the Anthropic path leaves them unset.
    reasoningTokens: v.optional(v.number()),
    cachedTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    cacheDiscount: v.optional(v.number()),
  }).index('by_action', ['action']),

  // ── The bench (#57, #65) ──────────────────────────────────────────────
  //
  // A scenario is one real prompt, kept verbatim, that every candidate
  // answers; a run is one candidate's answer to it, with the gateway's
  // measurements, the gate's verdict and the reviewer's rank. Runs are rows,
  // not an array on the scenario, so a scenario can hold any number of them.
  benchScenarios: defineTable({
    site: v.string(),
    name: v.string(),
    systemPrompt: v.string(),
    inputMessages: v.array(v.object({ role: v.string(), content: v.string() })),
    // The facts the gate needs, read out of the prompt (`readScenarioFacts`).
    colors: v.array(v.string()),
    archetype: v.optional(v.string()),
    archetypes: v.array(v.string()),
    requestedCount: v.optional(v.number()),
    idea: v.string(),
    // The log row the prompt was seeded from, when it was.
    seededFrom: v.optional(v.id('llmUsageLogs')),
  }).index('by_site', ['site']),

  benchRuns: defineTable({
    scenarioId: v.id('benchScenarios'),
    // Runs fanned out together share a batch; blind labels are shuffled per batch.
    batchId: v.string(),
    status: v.union(v.literal('pending'), v.literal('complete'), v.literal('error')),
    // The candidate as requested.
    model: v.string(),
    providerPinned: v.optional(v.string()),
    structured: v.string(),
    effort: v.optional(v.string()),
    reasoningMaxTokens: v.optional(v.number()),
    maxTokens: v.number(),
    // What the gateway answered with.
    providerAnswered: v.optional(v.string()),
    outputText: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    cacheDiscount: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    stopReason: v.optional(v.string()),
    nativeFinishReason: v.optional(v.string()),
    schemaEnforced: v.optional(v.string()),
    failure: v.optional(v.string()),
    error: v.optional(v.string()),
    // The gate's verdict (`GateRun`): the hard-fail line and every score.
    gateHardFail: v.optional(v.union(v.string(), v.null())),
    gateScores: v.optional(
      v.object({
        rung: v.union(v.number(), v.null()),
        costUsd: v.number(),
        projectedBuildCostUsd: v.number(),
        latencyMs: v.number(),
        reasoningTokens: v.union(v.number(), v.null()),
        cardsNamed: v.union(v.number(), v.null()),
        nonexistentCards: v.array(v.string()),
        offPoolCards: v.array(v.string()),
        offColorCards: v.array(v.string()),
        countDistance: v.union(v.number(), v.null()),
        overCopies: v.union(v.number(), v.null()),
        repairDistance: v.union(v.number(), v.null()),
        landCount: v.union(v.number(), v.null()),
        landVerdict: v.union(v.string(), v.null()),
        landDistance: v.union(v.number(), v.null()),
        averageManaValue: v.union(v.number(), v.null()),
        curveTooHigh: v.union(v.boolean(), v.null()),
        combos: v.union(v.number(), v.null()),
        label: v.union(v.string(), v.null()),
        correct: v.union(v.boolean(), v.null()),
        fragments: v.union(v.number(), v.null()),
        missedQueries: v.array(v.string()),
      }),
    ),
    // The reviewer's blind rank, 1 = best. Unset until ranked.
    humanRank: v.optional(v.number()),
  })
    .index('by_scenario', ['scenarioId'])
    .index('by_batch', ['batchId']),
})
