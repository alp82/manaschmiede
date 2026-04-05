import { action } from './_generated/server'
import { v } from 'convex/values'
import { callAnthropic } from './lib/anthropic'

function getSystemPrompt(language: string): string {
  const langInstruction = language === 'de'
    ? `- Write combo names and explanations in German
- Use ENGLISH card names (official Oracle names) in the "cards" array — these are needed for Scryfall lookups`
    : `- Write combo names and explanations in English
- Use ENGLISH card names (official Oracle names)`

  return `You are an expert Magic: The Gathering deck builder. Your job is to suggest 3-5 core card combinations that could form the backbone of a 60-card casual deck.

Each combination should be 2-4 cards that synergize exceptionally well together. These are the "build-around" cards — the rest of the deck will be tailored to support them.

RULES:
- Use ONLY real, existing Magic: The Gathering cards
${langInstruction}
- Each combo should feel distinct — offer genuinely different strategic directions
- Explain WHY the cards work together in 1-2 sentences
- Consider the user's color preferences, strategy, and any constraints
- Do NOT suggest planeswalker, conspiracy, vanguard, scheme, plane, phenomenon, dungeon, or attraction cards — they are excluded from this app
- Do NOT suggest Un-set / silver-border / acorn cards
- Do NOT suggest cards that are exclusive to Commander format or Commander-specific products (Commander Legends, Commander precon decks, etc.)
- Do NOT suggest cards that reference "commander" in their rules text
- Prefer cards that are legal in Modern or Legacy formats
- This is for a 60-card deck, NOT a Commander deck — avoid legendary creatures designed primarily as commanders

OUTPUT FORMAT (JSON ONLY, no other text):
{
  "combos": [
    {
      "name": "Short combo name",
      "cards": ["Card Name 1", "Card Name 2", "Card Name 3"],
      "explanation": "Why these cards synergize"
    }
  ]
}

Respond ONLY with the JSON object. No explanatory text before or after.`
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
    colors: v.array(v.string()),
    archetypes: v.array(v.string()),
    traits: v.array(v.string()),
    customStrategy: v.optional(v.string()),
    format: v.optional(v.string()),
    budgetLimit: v.optional(v.number()),
    rejectedCards: v.optional(v.array(v.object({
      name: v.string(),
      reason: v.string(),
    }))),
    language: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<ComboResult> => {
    const language = args.language ?? 'en'
    let userPrompt = 'Suggest 3-5 core card combinations for a deck with these preferences:\n'

    if (args.colors.length > 0) {
      const colorNames: Record<string, string> = {
        W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
      }
      userPrompt += `Colors: ${args.colors.map((c) => colorNames[c] || c).join(', ')}\n`
    }

    if (args.archetypes.length > 0) {
      userPrompt += `Archetypes: ${args.archetypes.join(', ')}\n`
    }

    if (args.traits.length > 0) {
      userPrompt += `Traits/themes: ${args.traits.join(', ')}\n`
    }

    if (args.customStrategy) {
      userPrompt += `Strategy description: ${args.customStrategy}\n`
    }

    if (args.format && args.format !== 'casual') {
      userPrompt += `Format: ${args.format}\n`
    }

    if (args.budgetLimit != null) {
      userPrompt += `Budget: max $${args.budgetLimit.toFixed(2)} per card\n`
    }

    if (args.rejectedCards && args.rejectedCards.length > 0) {
      userPrompt += `\nIMPORTANT: The following cards were rejected in a previous attempt. Do NOT suggest them again:\n`
      for (const card of args.rejectedCards) {
        userPrompt += `- ${card.name}: ${card.reason}\n`
      }
    }

    if (args.cardPool) {
      userPrompt += `\nHere are real cards that match the theme (prefer picking from these, but you can suggest others you know exist):\n${args.cardPool}`
    }

    const text = await callAnthropic(getSystemPrompt(language), [
      { role: 'user', content: userPrompt },
    ])

    // Parse the response
    let result: ComboResult
    try {
      result = JSON.parse(text)
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
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
