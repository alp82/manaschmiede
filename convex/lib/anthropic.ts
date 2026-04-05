export async function callAnthropic(
  system: string,
  messages: Array<{ role: string; content: string }>,
  options?: { model?: string; maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const model = options?.model ?? 'claude-sonnet-4-20250514'
  const maxTokens = options?.maxTokens ?? 4096

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
  const text = data.content?.[0]?.text
  if (!text) {
    throw new Error('No response received from AI')
  }
  return text
}

/** Fast, cheap intent classification via Haiku */
export async function callHaiku(
  system: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  return callAnthropic(system, messages, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 256,
  })
}
