/**
 * Server-only free-text strategy → Scryfall query-fragment parse.
 *
 * One Haiku round-trip turns the deck's free-text strategy into <=3 theme-only
 * Scryfall fragments (see strategyQueries.ts for the cleaning pipeline). Shared
 * by the parseStrategy action (step-3 combos) and the chat/fill card-pool
 * builders so all three honor the same free-text theme.
 */
import { startLlmLog, completeLlmLog, failLlmLog } from './logLlmUsage'
import { callHaiku } from './anthropic'
import { extractStrategyQueries } from './strategyQueries'
import { COLOR_NAMES } from './intentContext'
import type { ActionCtx } from '../_generated/server'

// NOTE on translation degradation: the German->English instruction below is a
// soft prompt hint. An untranslated fragment (e.g. `t:albtraum` instead of
// `t:nightmare`) will return zero Scryfall results and be dropped silently in
// the Scryfall loop — it is NOT a correctness guarantee. The theme still
// survives via the `customStrategy` arg passed to `suggest`, so the suggest
// model can reason about it even without on-theme pool cards.
function getParseSystemPrompt(): string {
  return `You translate a Magic: The Gathering player's free-text strategy into at most 3 Scryfall search query FRAGMENTS that find on-theme cards for their deck.

MAPPING:
- Creature types -> t:<type>  (e.g. "nightmares" -> t:nightmare)
- Oracle themes / effects -> o:"phrase"  (e.g. "opponents lose life" -> o:"loses life")
- Keywords / abilities -> o:<keyword> or keyword:<keyword>  (e.g. "flying" -> keyword:flying)

RULES:
- PREFER fragments that combine a type or keyword WITH the theme so results stay on-theme rather than flooding with off-theme cards.
- Emit THEME ONLY. NEVER include c:/c<=/c>=, f:, r:/r>=, or usd/eur/tix — the app applies color, format, rarity, and budget itself.
- Translate German creature types and themes into English Oracle vocabulary (e.g. "Albträume" -> t:nightmare).
- Output JSON ONLY: {"queries":["...","..."]}. No prose, no code fence, no more than 3 fragments.`
}

/**
 * Parse the deck's free-text strategy into <=3 theme-only Scryfall fragments.
 * Empty strategy short-circuits with no Haiku call. A parse failure logs the
 * error and degrades to no fragments.
 *
 * logLabel defaults to 'parseStrategy' to preserve the action's LLM-usage
 * attribution and the StepCoreCards contract; chat/fill pass distinct labels
 * ('chatStrategyParse' / 'fillStrategyParse') so their calls are attributable.
 */
export async function parseStrategyQueries(
  ctx: ActionCtx,
  args: {
    customStrategy: string
    selectedColors: string[]
    format?: string
    language?: string
  },
  logLabel = 'parseStrategy',
): Promise<{ queries: string[] }> {
  if (args.customStrategy.trim() === '') {
    return { queries: [] }
  }

  // Colors and format are CONTEXT for the translation, not filters — the
  // model must not emit them as scoping tokens (the app applies those).
  let userPrompt = `Strategy: ${args.customStrategy}\n`
  if (args.selectedColors.length > 0) {
    const colorList = args.selectedColors.map((c) => `${COLOR_NAMES[c] || c} (${c})`).join(', ')
    userPrompt += `\nCONTEXT (for translation only, do NOT emit as filters):\n`
    userPrompt += `- Deck colors: ${colorList}\n`
  }
  if (args.format && args.format !== 'casual') {
    userPrompt += `- Format: ${args.format}\n`
  }
  if (args.language === 'de') {
    userPrompt += `- The strategy may be written in German; translate types and themes to English Oracle vocabulary.\n`
  }

  const systemPrompt = getParseSystemPrompt()
  const inputMessages = [{ role: 'user', content: userPrompt }]
  const model = 'claude-haiku-4-5-20251001'
  const logId = await startLlmLog(ctx, logLabel, model, systemPrompt, inputMessages)

  try {
    const llmResult = await callHaiku(systemPrompt, inputMessages)
    await completeLlmLog(ctx, logId, llmResult)
    return { queries: extractStrategyQueries(llmResult.text) }
  } catch (err) {
    await failLlmLog(ctx, logId, err instanceof Error ? err.message : String(err))
    return { queries: [] }
  }
}
