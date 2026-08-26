/**
 * The OpenRouter request and response shapes, as pure functions: build the
 * body a bench candidate needs, read the body the gateway returns, and
 * classify how a structured call failed. Decided in issues #53 (OpenRouter,
 * bare fetch, one key) and #54 (one request shape, five failure surfaces).
 *
 * This is the bench's half of the eventual provider seam, not the seam
 * itself - the map keeps that in the fog until the survivor count is known.
 * What is fixed here is what #54 fixed: the request carries `schema`,
 * `reasoning` and `provider`; the result carries the normalized finish reason
 * with the native one beside it, the host that answered, the reasoning and
 * cache token counts, `usage.cost` as the cost, and a `failure` field that
 * names which of the five surfaces the call fell through.
 *
 * Zero runtime imports. The `fetch` lives in `openRouter.ts`.
 */

/** OpenRouter's normalized `finish_reason` values (#54). */
export type GatewayStopReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'

/** One axis of reasoning control, never both (#54). */
export type ReasoningRequest = { effort: string } | { maxTokens: number } | 'off'

/**
 * How the request asks for JSON. `json_schema` is rung 1 of #54's ladder;
 * `json_object` is rung 3, for a host that accepts `response_format` but not a
 * schema (DeepSeek); `none` is rung 4, the prompt alone with `jsonLadder`
 * behind it. The strict-tool rung (2) is not built until the seam lands.
 */
export type StructuredMode = 'json_schema' | 'json_object' | 'none'

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
  additionalProperties: false
}

export interface GatewayRequest {
  /** OpenRouter slug, e.g. `anthropic/claude-sonnet-5`. */
  model: string
  system: string
  messages: Array<{ role: string; content: string }>
  maxTokens: number
  structured: StructuredMode
  schema?: JsonSchema
  /** `json_schema.name`; stable, since Anthropic caches grammars by it. */
  schemaName?: string
  reasoning?: ReasoningRequest
  /** Provider slug to pin the request to. No fallbacks when set. */
  provider?: string
}

/** Which rung produced the text (#54). */
export type SchemaEnforced = 'native' | 'json-only' | 'none'

export type GatewayFailure = 'truncated' | 'refused' | 'provider-error' | 'empty' | null

export interface GatewayResult {
  text: string
  model: string
  /** The host that answered, from the response's `provider` field. */
  provider: string | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  /** OpenRouter's `cache_discount`; negative when a cache write cost extra. */
  cacheDiscount: number
  /** `usage.cost`, the actual charge in credits (USD). */
  costUsd: number
  durationMs: number
  stopReason: GatewayStopReason | null
  nativeFinishReason: string | null
  schemaEnforced: SchemaEnforced
  refusal: string | null
  providerError: { code: number; message: string } | null
  /**
   * The first failure surface the response fell through, in #54's order:
   * a provider error on a 200, a refusal, truncation, or an empty body.
   * Parse and schema failures are the gate's to judge, not the transport's.
   */
  failure: GatewayFailure
}

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** The wire body for one request. Everything optional is omitted, not nulled. */
export function buildGatewayBody(request: GatewayRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    messages: [{ role: 'system', content: request.system }, ...request.messages],
  }

  if (request.structured === 'json_schema') {
    if (!request.schema) throw new Error('json_schema mode needs a schema')
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: request.schemaName ?? 'response', strict: true, schema: request.schema },
    }
  } else if (request.structured === 'json_object') {
    body.response_format = { type: 'json_object' }
  }

  if (request.reasoning !== undefined) {
    body.reasoning =
      request.reasoning === 'off'
        ? { effort: 'none' }
        : 'effort' in request.reasoning
          ? { effort: request.reasoning.effort }
          : { max_tokens: request.reasoning.maxTokens }
  }

  // `require_parameters` is what makes a pass honest: without it the gateway
  // silently drops an unsupported `response_format` or `reasoning` and routes
  // anyway (#54). Pinning disables fallbacks so the host that answers is the
  // host that was measured.
  const routing: Record<string, unknown> = { require_parameters: true }
  if (request.provider) {
    routing.order = [request.provider]
    routing.allow_fallbacks = false
  }
  body.provider = routing

  return body
}

/** The slice of a chat-completion body this module reads. */
export interface GatewayResponseBody {
  model?: string
  provider?: string
  choices?: Array<{
    finish_reason?: string | null
    native_finish_reason?: string | null
    message?: { content?: string | null; refusal?: string | null }
    error?: { code?: number; message?: string }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    cache_discount?: number
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

const STOP_REASONS: ReadonlySet<string> = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'error'])

function normalizedStop(value: string | null | undefined): GatewayStopReason | null {
  return value !== null && value !== undefined && STOP_REASONS.has(value) ? (value as GatewayStopReason) : null
}

/** Read a 200 body into a result. `schemaEnforced` is what the request asked for. */
export function readGatewayResponse(
  body: GatewayResponseBody,
  requested: { model: string; structured: StructuredMode; durationMs: number },
): GatewayResult {
  const choice = body.choices?.[0]
  const usage = body.usage ?? {}
  const text = choice?.message?.content ?? ''
  const refusal = choice?.message?.refusal ?? null
  const providerError =
    choice?.error !== undefined
      ? { code: choice.error.code ?? 0, message: choice.error.message ?? 'provider error' }
      : null
  const stopReason = normalizedStop(choice?.finish_reason)

  // #54's order: a 200 can carry `choices[0].error` beside partial content, so
  // that is checked before anything is read as an answer.
  let failure: GatewayFailure = null
  if (providerError) failure = 'provider-error'
  else if (refusal) failure = 'refused'
  else if (stopReason === 'length') failure = 'truncated'
  else if (text.trim() === '') failure = 'empty'

  return {
    text,
    model: body.model ?? requested.model,
    provider: body.provider ?? null,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens ?? 0,
    cacheDiscount: usage.cache_discount ?? 0,
    costUsd: usage.cost ?? 0,
    durationMs: requested.durationMs,
    stopReason,
    nativeFinishReason: choice?.native_finish_reason ?? null,
    schemaEnforced: requested.structured === 'json_schema' ? 'native' : requested.structured === 'json_object' ? 'json-only' : 'none',
    refusal,
    providerError,
    failure,
  }
}

/**
 * A pre-stream HTTP error. OpenRouter types refusals and policy violations
 * as 400s with an `error_type`; both read as `refused` so the bench counts
 * them beside a 200 refusal rather than as a transport error.
 */
export interface GatewayHttpError {
  status: number
  message: string
  refused: boolean
}

export function readGatewayError(status: number, bodyText: string): GatewayHttpError {
  let message = bodyText
  let errorType: string | undefined
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; type?: string; metadata?: { error_type?: string } } }
    message = parsed.error?.message ?? bodyText
    errorType = parsed.error?.type ?? parsed.error?.metadata?.error_type
  } catch {
    // not JSON; keep the raw text
  }
  const refused = status === 400 && (errorType === 'refusal' || errorType === 'content_policy_violation')
  return { status, message, refused }
}

/** The per-model reasoning metadata the models list carries (#54). */
export interface GatewayModel {
  id: string
  name: string
  /** Per-million-token USD, as OpenRouter's `pricing.prompt` / `.completion` strings parse. */
  pricing: { input: number; output: number }
  supportedParameters: string[]
  reasoning: {
    mandatory: boolean
    defaultEnabled: boolean | null
    supportedEfforts: string[]
    defaultEffort: string | null
  } | null
}

interface RawModel {
  id?: string
  name?: string
  pricing?: { prompt?: string | number; completion?: string | number; input?: string | number; output?: string | number }
  supported_parameters?: string[]
  reasoning?: {
    mandatory?: boolean
    default_enabled?: boolean
    supported_efforts?: string[]
    default_effort?: string | null
  } | null
}

/**
 * Read the models list. Two field shapes exist on the live endpoint (#53
 * saw `pricing.prompt` and `pricing.input` on the same day), so both are read.
 * Prices come per token; they are scaled to per million to match
 * `MODEL_PRICING`'s unit.
 */
export function readGatewayModels(body: { data?: RawModel[] }): GatewayModel[] {
  const perMillion = (v: string | number | undefined) => (v === undefined ? 0 : Number(v) * 1_000_000)
  return (body.data ?? [])
    .filter((m): m is RawModel & { id: string } => typeof m.id === 'string')
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      pricing: {
        input: perMillion(m.pricing?.prompt ?? m.pricing?.input),
        output: perMillion(m.pricing?.completion ?? m.pricing?.output),
      },
      supportedParameters: m.supported_parameters ?? [],
      reasoning: m.reasoning
        ? {
            mandatory: m.reasoning.mandatory ?? false,
            defaultEnabled: m.reasoning.default_enabled ?? null,
            supportedEfforts: m.reasoning.supported_efforts ?? [],
            defaultEffort: m.reasoning.default_effort ?? null,
          }
        : null,
    }))
}
