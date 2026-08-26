/**
 * The OpenRouter `fetch` half of `gatewayShapes.ts`: one key, bare fetch,
 * no SDK (#53). The shapes are pure and tested; this module only moves them
 * over the wire and races the call against a ceiling so a stalled host
 * cannot hold a bench batch open.
 */
import {
  OPENROUTER_CHAT_URL,
  OPENROUTER_MODELS_URL,
  buildGatewayBody,
  readGatewayError,
  readGatewayModels,
  readGatewayResponse,
  type GatewayModel,
  type GatewayRequest,
  type GatewayResult,
} from './gatewayShapes'

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://manaschmiede.app',
  'X-Title': 'Manaschmiede bench',
}

/**
 * Above the gate's hardest latency ceiling (120s for a deck site) so a run
 * that would fail the gate on latency is still measured, not abandoned.
 */
export const GATEWAY_TIMEOUT_MS = 150_000

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly refused: boolean,
  ) {
    super(message)
  }
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured')
  return key
}

/**
 * One chat completion. A non-2xx answer throws `GatewayError`; a 2xx answer
 * always returns, with `failure` set when the body carries one of #54's
 * in-band failures. `AbortSignal` is undocumented in Convex's V8 runtime, so
 * the ceiling is a `Promise.race`, like the strategy-parse guard.
 */
export async function callOpenRouter(request: GatewayRequest): Promise<GatewayResult> {
  const key = apiKey()
  const start = Date.now()
  const call = (async () => {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...OPENROUTER_HEADERS },
      body: JSON.stringify(buildGatewayBody(request)),
    })
    if (!response.ok) {
      const error = readGatewayError(response.status, await response.text())
      throw new GatewayError(`OpenRouter error (${error.status}): ${error.message}`, error.status, error.refused)
    }
    const body = await response.json()
    return readGatewayResponse(body, { model: request.model, structured: request.structured, durationMs: Date.now() - start })
  })()
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new GatewayError(`No answer within ${GATEWAY_TIMEOUT_MS / 1000}s`, 0, false)), GATEWAY_TIMEOUT_MS),
  )
  return Promise.race([call, timeout])
}

/** The live model list, so slugs and effort levels are read, never hardcoded (#53). */
export async function listOpenRouterModels(): Promise<GatewayModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey()}`, ...OPENROUTER_HEADERS },
  })
  if (!response.ok) throw new GatewayError(`OpenRouter models list failed (${response.status})`, response.status, false)
  return readGatewayModels(await response.json())
}
