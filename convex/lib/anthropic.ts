/**
 * The models this app calls, one home so a model swap is a single edit.
 *
 * Named by role, not by tier: what matters at the call site is whether the job
 * needs the quality model or the cheap one. Every entry needs a MODEL_PRICING
 * row - `estimatedCostUsd` on every `llmUsageLogs` entry is only as good as
 * that table.
 */
export const MODELS = {
  /** Quality tier. Only reached as `callAnthropic`'s default - see below. */
  main: 'claude-sonnet-4-20250514',
  /**
   * Cheap tier: classification, strategy parsing, deck generation, delta edits,
   * section fill, combos. In practice every call site passes this explicitly.
   */
  fast: 'claude-haiku-4-5-20251001',
} as const

/**
 * Per-million-token pricing (USD), input / output.
 *
 * Checked against Anthropic's published rates on 2026-08-24. Haiku 4.5 is
 * $1.00 / $5.00 - the previous 0.80 / 4 understated every Haiku cost in
 * `llmUsageLogs` by 20%. Sonnet 4 is $3 / $15 and is now a deprecated model;
 * see the note on MODELS.main.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [MODELS.main]: { input: 3, output: 15 },
  [MODELS.fast]: { input: 1, output: 5 },
}

export interface LlmResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  estimatedCostUsd: number
  /**
   * Anthropic's `stop_reason`: `end_turn`, `max_tokens`, `stop_sequence`,
   * `tool_use`, whatever Anthropic adds next, or null when the field is absent.
   * A `max_tokens` response is cut off mid-sentence, so callers must not treat
   * it as complete output. Typed as a string rather than a union because the
   * value crosses the wire from an API that can add cases.
   */
  stopReason: string | null
}

/** User-facing message for a response the model could not finish. */
export const TRUNCATED_RESPONSE_MESSAGE =
  'The AI response was cut off before it finished. Try again with a shorter request.'

/** True when the model ran out of output tokens and the text is incomplete. */
export function isTruncated(result: Pick<LlmResult, 'stopReason'>): boolean {
  return result.stopReason === 'max_tokens'
}

export async function callAnthropic(
  system: string,
  messages: Array<{ role: string; content: string }>,
  options?: { model?: string; maxTokens?: number },
): Promise<LlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const model = options?.model ?? MODELS.main
  const maxTokens = options?.maxTokens ?? 4096
  const start = Date.now()

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${error}`)
  }

  const data = await response.json()
  const durationMs = Date.now() - start
  // The first block is not necessarily the text one - a response can lead with
  // a thinking or tool-use block, and reading content[0] blindly would report
  // a perfectly good answer as "No response received".
  const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data.content)
    ? data.content
    : []
  const text = blocks.find((block) => block?.type === 'text')?.text
  if (!text) {
    throw new Error('No response received from AI')
  }

  const stopReason: string | null = data.stop_reason ?? null
  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  const pricing = MODEL_PRICING[model] ?? { input: 3, output: 15 }
  const estimatedCostUsd =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000

  return { text, model, inputTokens, outputTokens, durationMs, estimatedCostUsd, stopReason }
}

/** Fast, cheap intent classification via Haiku */
export async function callHaiku(
  system: string,
  messages: Array<{ role: string; content: string }>,
): Promise<LlmResult> {
  return callAnthropic(system, messages, {
    model: MODELS.fast,
    maxTokens: 256,
  })
}
