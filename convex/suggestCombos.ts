import { action } from './_generated/server'
import { v } from 'convex/values'
import { callAnthropic, callHaiku } from './lib/anthropic'
import { startLlmLog, completeLlmLog, failLlmLog } from './lib/logLlmUsage'
import { extractStrategyQueries } from './lib/strategyQueries'
function getSystemPrompt(language: string): string {
  const langInstruction = language === 'de'
    ? `- Write combo names and explanations in German
- Use ENGLISH card names (official Oracle names) in the "cards" array - these are needed for Scryfall lookups`
    : `- Write combo names and explanations in English
- Use ENGLISH card names (official Oracle names)`

  return `You are an expert Magic: The Gathering deck builder. Suggest exactly 5 core card combinations (2-4 cards each) that form the backbone of a 60-card casual deck.

CORE COMBO PHILOSOPHY:
- Each combo must contain at least ONE showstopper — a splashy build-around, famous engine, or exciting mythic the player gets excited to draw
- The other cards should amplify or enable that showstopper with deep synergy
- Prefer rich ability text over vanilla stats. Think "cards I'd tell my friend about"
- No generic support cards (mana dorks, ramp, removal) — those go in the shell, not the core

KEYWORD/TRAIT ACCURACY:
- When the user selects keywords (e.g. deathtouch, flying), at least one card per combo MUST have that keyword in its Oracle text — this is verified against Scryfall
- Do NOT claim a card has an ability it doesn't have

TRIBAL TRAITS ARE COMMITMENTS:
- When the user lists a creature type, at least 2 of 5 combos must prominently feature that type
- A user picking "Lifegain + Elves" wants elf-flavored lifegain, not generic lifegain

MULTI-ARCHETYPE BALANCE:
- Every listed archetype must appear in at least one combo's core mechanic
- With 2 archetypes: ~2 combos each + 1 hybrid. Hybrids must show both archetypes doing work

COLOR DISCIPLINE:
- SELECTED colors: every combo must work in a deck running these
- MAYBE colors: each must appear in at least one combo's color identity across the batch
- Never use colors outside SELECTED ∪ MAYBE

Cards are validated automatically — bad synergies, wrong colors, and invalid cards get rejected.

RULES:
- Use ONLY real, existing Magic cards
${langInstruction}
- 5 distinct combos with genuinely different strategic directions
- Explain WHY the cards work together in 1-2 sentences
- Prefer Modern/Legacy legal cards
- 60-card deck, NOT Commander

OUTPUT FORMAT (JSON ONLY):
{
  "combos": [
    {
      "name": "Short combo name",
      "cards": ["Card Name 1", "Card Name 2", "Card Name 3"],
      "explanation": "Why these cards synergize"
    }
  ]
}

Respond ONLY with the JSON object.`
}

interface ComboResult {
  combos: Array<{
    name: string
    cards: string[]
    explanation: string
  }>
}

export const suggest = action({
  args: {
    cardPool: v.string(),
    selectedColors: v.array(v.string()),
    maybeColors: v.array(v.string()),
    archetypes: v.array(v.string()),
    traits: v.array(v.string()),
    requiredKeywords: v.optional(v.array(v.string())),
    pinnedCard: v.optional(v.string()),
    customStrategy: v.optional(v.string()),
    format: v.optional(v.string()),
    budgetLimit: v.optional(v.number()),
    rejectedCards: v.optional(v.array(v.object({
      name: v.string(),
      reason: v.string(),
    }))),
    rejectedCombos: v.optional(v.array(v.object({
      name: v.string(),
      reason: v.string(),
    }))),
    /**
     * Maybe colors that a previous attempt failed to cover. When present,
     * the retry MUST produce combos whose color identity collectively
     * includes every one of these.
     */
    missingMaybeColors: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ComboResult> => {
    const language = args.language ?? 'en'
    let userPrompt = 'Suggest exactly 5 core card combinations for a deck with these preferences:\n'

    const colorNames: Record<string, string> = {
      W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
    }
    const fmtColors = (cs: string[]) =>
      cs.map((c) => `${colorNames[c] || c} (${c})`).join(', ')

    if (args.selectedColors.length > 0) {
      userPrompt += `SELECTED colors (committed - every combo must live within SELECTED ∪ MAYBE): ${fmtColors(args.selectedColors)}\n`
    }
    if (args.maybeColors.length > 0) {
      userPrompt += `MAYBE colors (each one MUST appear in at least one combo's color identity across the batch): ${fmtColors(args.maybeColors)}\n`
    } else if (args.selectedColors.length > 0) {
      userPrompt += `MAYBE colors: none — every combo must stay strictly within the SELECTED colors above.\n`
    }

    if (args.archetypes.length > 0) {
      userPrompt += `Archetypes:\n${args.archetypes.map((a) => `- ${a}`).join('\n')}\n`
    }

    if (args.traits.length > 0) {
      userPrompt += `Traits/themes: ${args.traits.join(', ')}\n`
    }

    if (args.requiredKeywords && args.requiredKeywords.length > 0) {
      userPrompt += `\nREQUIRED KEYWORDS: At least one card in each combo MUST have one of these keywords/mechanics in its actual Oracle rules text: ${args.requiredKeywords.join(', ')}\n`
      userPrompt += `These will be verified against real card data - do not guess or approximate.\n`
    }

    if (args.pinnedCard) {
      userPrompt += `\nMUST-INCLUDE CARD: Every combo MUST include "${args.pinnedCard}". Build each combo around this card with different supporting cards.\n`
    }

    if (args.customStrategy) {
      userPrompt += `\nUSER STRATEGY (treat as a commitment): The player described their deck as: "${args.customStrategy}". At least 2 of the 5 combos MUST clearly reflect this — lean into its themes, creature types, and effects. If the theme is narrow, still honor it in as many combos as the card pool allows.\n`
    }

    if (args.format && args.format !== 'casual') {
      userPrompt += `Format: ${args.format}\n`
    }

    if (args.budgetLimit != null) {
      userPrompt += `Budget: max $${args.budgetLimit.toFixed(2)} per card\n`
    }

    if (args.rejectedCards && args.rejectedCards.length > 0) {
      const recent = args.rejectedCards.slice(-5)
      userPrompt += `\nDo NOT suggest these previously rejected cards:\n`
      for (const card of recent) {
        userPrompt += `- ${card.name}: ${card.reason}\n`
      }
    }

    if (args.rejectedCombos && args.rejectedCombos.length > 0) {
      const recent = args.rejectedCombos.slice(-5)
      userPrompt += `\nSuggest DIFFERENT combos (these were rejected):\n`
      for (const combo of recent) {
        userPrompt += `- "${combo.name}": ${combo.reason}\n`
      }
    }

    if (args.missingMaybeColors && args.missingMaybeColors.length > 0) {
      const missing = args.missingMaybeColors.map((c) => colorNames[c] || c).join(', ')
      userPrompt += `\nCRITICAL - MAYBE COVERAGE FAILURE: The previous batch did not produce a combo using these MAYBE colors: ${missing}. The new batch MUST include at least one combo whose color identity covers each of: ${args.missingMaybeColors.join(', ')}. A batch that still leaves any of these uncovered is invalid.\n`
    }

    if (args.cardPool) {
      userPrompt += `\nHere are real cards that match the theme (prefer picking from these, but you can suggest others you know exist):\n${args.cardPool}`
    }

    const systemPrompt = getSystemPrompt(language)
    const inputMessages = [{ role: 'user', content: userPrompt }]
    const model = 'claude-haiku-4-5-20251001'
    const logId = await startLlmLog(ctx, 'suggestCombos', model, systemPrompt, inputMessages)
    const llmResult = await callAnthropic(systemPrompt, inputMessages, { model, maxTokens: 4096 })
    await completeLlmLog(ctx, logId, llmResult)

    // Parse the response
    let result: ComboResult
    try {
      result = JSON.parse(llmResult.text)
    } catch {
      const match = llmResult.text.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (match) {
        result = JSON.parse(match[1].trim())
      } else {
        throw new Error('Could not parse AI response as JSON')
      }
    }

    if (!result.combos || !Array.isArray(result.combos)) {
      throw new Error('AI response has an invalid format')
    }

    // Validate and clean up
    result.combos = result.combos.filter(
      (c) =>
        typeof c.name === 'string' &&
        Array.isArray(c.cards) &&
        c.cards.length >= 2 &&
        typeof c.explanation === 'string',
    )

    return result
  },
})

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

interface ParseStrategyResult {
  queries: string[]
}

export const parseStrategy = action({
  args: {
    customStrategy: v.string(),
    selectedColors: v.array(v.string()),
    format: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ParseStrategyResult> => {
    if (args.customStrategy.trim() === '') {
      return { queries: [] }
    }

    const colorNames: Record<string, string> = {
      W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
    }

    // Colors and format are CONTEXT for the translation, not filters — the
    // model must not emit them as scoping tokens (the app applies those).
    let userPrompt = `Strategy: ${args.customStrategy}\n`
    if (args.selectedColors.length > 0) {
      const colorList = args.selectedColors.map((c) => `${colorNames[c] || c} (${c})`).join(', ')
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
    const logId = await startLlmLog(ctx, 'parseStrategy', model, systemPrompt, inputMessages)

    try {
      const llmResult = await callHaiku(systemPrompt, inputMessages)
      await completeLlmLog(ctx, logId, llmResult)
      return { queries: extractStrategyQueries(llmResult.text) }
    } catch (err) {
      await failLlmLog(ctx, logId, err instanceof Error ? err.message : String(err))
      return { queries: [] }
    }
  },
})
