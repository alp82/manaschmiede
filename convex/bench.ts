/**
 * The bench: the repo's harness for choosing models by evidence (#57, #65).
 *
 * A scenario is seeded from a real `llmUsageLogs` row - the exact prompt an
 * app call carried - and then fanned out **live** through OpenRouter to every
 * candidate at once, so every answer on the board is to the same question.
 * Replayed rows never share a prompt (#57), which is why replay only seeds.
 * Each answer is measured by the gateway (`usage.cost`, tokens, reasoning,
 * cache), judged by the mechanical gate on its raw text, and stored as a
 * `benchRuns` row for the reviewer to rank blind.
 *
 * The bench runs are not app usage: they never touch `llmUsageLogs`, so the
 * replay corpus and the usage stats stay what the app actually did.
 */
import { v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { BENCH_SITES, isBenchSite, readScenarioFacts, type BenchSite } from './lib/benchScenario'
import { GatewayError, callOpenRouter, listOpenRouterModels } from './lib/openRouter'
import type { GatewayModel, GatewayRequest, ReasoningRequest, StructuredMode } from './lib/gatewayShapes'
import { SITE_SCHEMAS } from './lib/responseSchemas'
import { runMechanicalGate } from './lib/mechanicalGateCheck'
import type { GateRun } from './lib/mechanicalGate'

const SEEDABLE_PER_SITE = 25

// ── Scenarios ───────────────────────────────────────────────────────────────

export const listScenarios = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('benchScenarios').order('desc').take(100)
  },
})

/** The completed log rows a scenario can be seeded from, newest first per site. */
export const listSeedableLogs = query({
  args: {},
  handler: async (ctx) => {
    const rows: Array<Pick<Doc<'llmUsageLogs'>, '_id' | '_creationTime' | 'action' | 'model' | 'inputMessages' | 'systemPrompt'>> = []
    for (const site of BENCH_SITES) {
      const logs = await ctx.db
        .query('llmUsageLogs')
        .withIndex('by_action', (q) => q.eq('action', site))
        .order('desc')
        .take(SEEDABLE_PER_SITE)
      for (const log of logs) {
        if (log.status !== 'complete') continue
        rows.push({
          _id: log._id,
          _creationTime: log._creationTime,
          action: log.action,
          model: log.model,
          inputMessages: log.inputMessages,
          systemPrompt: log.systemPrompt,
        })
      }
    }
    return rows.map((log) => {
      const facts = readScenarioFacts(log.action as BenchSite, log.systemPrompt, log.inputMessages)
      return { _id: log._id, _creationTime: log._creationTime, site: log.action, model: log.model, ...facts }
    })
  },
})

export const seedScenario = mutation({
  args: { logId: v.id('llmUsageLogs'), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.logId)
    if (!log) throw new Error('Log row not found')
    if (log.status !== 'complete') throw new Error('Only a completed call can seed a scenario')
    if (!isBenchSite(log.action)) throw new Error(`${log.action} is not a bench site`)
    const facts = readScenarioFacts(log.action, log.systemPrompt, log.inputMessages)
    return await ctx.db.insert('benchScenarios', {
      site: log.action,
      name: args.name ?? facts.idea.slice(0, 80),
      systemPrompt: log.systemPrompt,
      inputMessages: log.inputMessages,
      colors: [...facts.colors],
      archetype: facts.archetype,
      archetypes: facts.archetypes,
      requestedCount: facts.requestedCount,
      idea: facts.idea,
      seededFrom: log._id,
    })
  },
})

export const getScenario = query({
  args: { scenarioId: v.id('benchScenarios') },
  handler: async (ctx, args) => {
    const scenario = await ctx.db.get(args.scenarioId)
    if (!scenario) return null
    const runs = await ctx.db
      .query('benchRuns')
      .withIndex('by_scenario', (q) => q.eq('scenarioId', args.scenarioId))
      .order('desc')
      .take(500)
    return { scenario, runs }
  },
})

export const deleteScenario = mutation({
  args: { scenarioId: v.id('benchScenarios') },
  handler: async (ctx, args) => {
    for (;;) {
      const runs = await ctx.db
        .query('benchRuns')
        .withIndex('by_scenario', (q) => q.eq('scenarioId', args.scenarioId))
        .take(100)
      for (const run of runs) await ctx.db.delete(run._id)
      if (runs.length < 100) break
    }
    await ctx.db.delete(args.scenarioId)
    return null
  },
})

export const readScenario = internalQuery({
  args: { scenarioId: v.id('benchScenarios') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.scenarioId)
  },
})

// ── Runs ────────────────────────────────────────────────────────────────────

const candidateValidator = v.object({
  model: v.string(),
  provider: v.optional(v.string()),
  structured: v.union(v.literal('json_schema'), v.literal('json_object'), v.literal('none')),
  effort: v.optional(v.string()),
  reasoningMaxTokens: v.optional(v.number()),
  maxTokens: v.number(),
})

export const startRun = internalMutation({
  args: {
    scenarioId: v.id('benchScenarios'),
    batchId: v.string(),
    candidate: candidateValidator,
  },
  handler: async (ctx, args) => {
    const { candidate } = args
    return await ctx.db.insert('benchRuns', {
      scenarioId: args.scenarioId,
      batchId: args.batchId,
      status: 'pending',
      model: candidate.model,
      providerPinned: candidate.provider,
      structured: candidate.structured,
      effort: candidate.effort,
      reasoningMaxTokens: candidate.reasoningMaxTokens,
      maxTokens: candidate.maxTokens,
    })
  },
})

const gateScoresValidator = v.object({
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
})

export const completeRun = internalMutation({
  args: {
    id: v.id('benchRuns'),
    status: v.union(v.literal('complete'), v.literal('error')),
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
    gateHardFail: v.optional(v.union(v.string(), v.null())),
    gateScores: v.optional(gateScoresValidator),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args
    await ctx.db.patch(id, fields)
    return null
  },
})

export const setHumanRank = mutation({
  args: { runId: v.id('benchRuns'), rank: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { humanRank: args.rank ?? undefined })
    return null
  },
})

function toReasoning(candidate: { effort?: string; reasoningMaxTokens?: number }): ReasoningRequest | undefined {
  if (candidate.effort === 'none') return 'off'
  if (candidate.effort) return { effort: candidate.effort }
  if (candidate.reasoningMaxTokens !== undefined) return { maxTokens: candidate.reasoningMaxTokens }
  return undefined
}

function batchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Fan one scenario out to every candidate, `runs` times each, all at once.
 * Every run is a row from the moment it starts, so the board shows a batch
 * filling in and a crash leaves a `pending` row rather than nothing.
 */
export const fanOut = action({
  args: {
    scenarioId: v.id('benchScenarios'),
    candidates: v.array(candidateValidator),
    runs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ batchId: string; runIds: Id<'benchRuns'>[] }> => {
    const scenario: Doc<'benchScenarios'> | null = await ctx.runQuery(internal.bench.readScenario, {
      scenarioId: args.scenarioId,
    })
    if (!scenario) throw new Error('Scenario not found')
    if (!isBenchSite(scenario.site)) throw new Error(`${scenario.site} is not a bench site`)
    const site: BenchSite = scenario.site
    const repeats = Math.max(1, Math.min(args.runs ?? 1, 10))
    const batch = batchId()

    const jobs: Array<{ id: Id<'benchRuns'>; candidate: (typeof args.candidates)[number] }> = []
    for (const candidate of args.candidates) {
      for (let i = 0; i < repeats; i++) {
        const id: Id<'benchRuns'> = await ctx.runMutation(internal.bench.startRun, {
          scenarioId: scenario._id,
          batchId: batch,
          candidate,
        })
        jobs.push({ id, candidate })
      }
    }

    await Promise.all(
      jobs.map(async ({ id, candidate }) => {
        const request: GatewayRequest = {
          model: candidate.model,
          system: scenario.systemPrompt,
          messages: scenario.inputMessages,
          maxTokens: candidate.maxTokens,
          structured: candidate.structured as StructuredMode,
          schema: SITE_SCHEMAS[site].schema,
          schemaName: SITE_SCHEMAS[site].name,
          reasoning: toReasoning(candidate),
          provider: candidate.provider,
        }
        try {
          const result = await callOpenRouter(request)
          // The gate judges the raw text even when the transport already
          // saw a failure - a truncated body still shows how far it got.
          const gate: GateRun = await runMechanicalGate({
            site,
            scenario: {
              colors: scenario.colors,
              archetype: scenario.archetype,
              requestedCount: scenario.requestedCount,
            },
            text: result.text,
            stopReason: result.stopReason,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            reasoningTokens: result.reasoningTokens,
          })
          await ctx.runMutation(internal.bench.completeRun, {
            id,
            status: 'complete',
            providerAnswered: result.provider ?? undefined,
            outputText: result.text,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            reasoningTokens: result.reasoningTokens,
            cachedTokens: result.cachedTokens,
            cacheWriteTokens: result.cacheWriteTokens,
            cacheDiscount: result.cacheDiscount,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            stopReason: result.stopReason ?? undefined,
            nativeFinishReason: result.nativeFinishReason ?? undefined,
            schemaEnforced: result.schemaEnforced,
            failure: result.failure ?? undefined,
            gateHardFail: gate.hardFail,
            gateScores: gate.scores,
          })
        } catch (err) {
          const refused = err instanceof GatewayError && err.refused
          await ctx.runMutation(internal.bench.completeRun, {
            id,
            status: 'error',
            failure: refused ? 'refused' : 'provider-error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }),
    )

    return { batchId: batch, runIds: jobs.map((j) => j.id) }
  },
})

// ── The gateway's model list ────────────────────────────────────────────────

/**
 * The live models list, so the board can confirm a slate slug still exists
 * and offer the effort levels each model's metadata lists (#53, #54). Passed
 * through unfiltered when `ids` is empty.
 */
export const gatewayModels = action({
  args: { ids: v.optional(v.array(v.string())) },
  handler: async (_ctx, args): Promise<GatewayModel[]> => {
    const models = await listOpenRouterModels()
    if (!args.ids || args.ids.length === 0) return models
    const wanted = new Set(args.ids)
    return models.filter((m) => wanted.has(m.id))
  },
})
