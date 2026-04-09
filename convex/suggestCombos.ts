import { action } from './_generated/server'
import { v } from 'convex/values'
import { callAnthropic } from './lib/anthropic'

function getSystemPrompt(language: string): string {
  const langInstruction = language === 'de'
    ? `- Write combo names and explanations in German
- Use ENGLISH card names (official Oracle names) in the "cards" array - these are needed for Scryfall lookups`
    : `- Write combo names and explanations in English
- Use ENGLISH card names (official Oracle names)`

  return `You are an expert Magic: The Gathering deck builder. Your job is to suggest exactly 5 core card combinations that could form the backbone of a 60-card casual deck.

Each combination should be 2-4 cards that synergize exceptionally well together. These are the "build-around" cards - the exciting, high-impact cards a player wants to slam on the table. The rest of the deck will be tailored to support them.

THE CORE COMBO IS THE SOUL OF THE DECK:
- It has huge potential for synergy. The rest of the deck (30+ slots) exists to set up, protect, and amplify this combo, so pick cards with DEEP synergy veins that let the support shell do real work
- Each combo must contain at least ONE truly strong, unique, bold, or awesome card - a showstopper the player gets excited to draw, not just a solid role-player
- The showstopper can be a famous build-around (Splinter Twin, Birthing Pod, Tooth and Nail), a unique legendary, a splashy mythic, a legendary engine, a haymaker finisher, or a distinctive niche card people actively brew around
- The OTHER cards in the combo should amplify or enable that showstopper in a way that makes the whole combo greater than the sum of its parts
- Prefer cards with rich ability text that interacts with many other things over vanilla stats or single-line effects

WHAT MAKES A GOOD CORE COMBO:
- Splashy, powerful cards that define the deck's identity - the cards you get excited to draw
- Cards that create a clear game plan when combined (e.g. Tooth and Nail fetching two creatures that win together)
- Win conditions, powerful engines, and dramatic payoffs - NOT support cards
- Rich synergy potential: the combo should suggest obvious "oh, and THIS card would be insane with that" follow-ups for the support shell
- Think "cards I'd tell my friend about" not "cards every deck needs"

WHAT TO AVOID IN CORE COMBOS:
- All-vanilla combos made of solid-but-boring creatures - at least one card must be genuinely exciting
- Generic mana dorks (Birds of Paradise, Llanowar Elves) - these are support, not core identity
- Basic ramp/fixing (Rampant Growth, Armillary Sphere) - boring utility, not build-around
- Generic removal or counterspells - these go in the shell, not the core
- Cards that are good in every deck - core combos should be specific to the chosen strategy
- Combos where every card is a workmanlike rare without a real "wow" piece

CRITICAL - KEYWORD/TRAIT ACCURACY:
- When the user selects specific keywords or mechanics (e.g. deathtouch, flying, trample), at least one card in EACH combo MUST actually have that keyword or mechanic in its official Oracle rules text
- Do NOT claim a card has an ability it doesn't have - this will be verified against Scryfall data
- If you're unsure whether a card has a specific keyword, pick a different card you're certain about
- A card that "feels like" a keyword is NOT the same as having it. Example: a creature that destroys blockers does NOT have deathtouch unless "deathtouch" literally appears in its rules text or keywords

CRITICAL - INTERNAL SYNERGY:
- Each combo's cards must actually pay each other off. If one card references "Dragons", at least one OTHER card in the same combo must be a Dragon.
- If a card's main ability triggers on a creature type, card type, or keyword, the combo MUST contain enablers for that trigger.
- Do NOT include "tribal payoff" cards (e.g. "Dragon Tempest", "Goblin Chieftain") unless the rest of the combo provides creatures of that tribe.
- This is automatically verified - violating combos will be rejected.

RULES:
- Use ONLY real, existing Magic: The Gathering cards
${langInstruction}
- Suggest exactly 5 combos - each should feel distinct and offer a genuinely different strategic direction
- Explain WHY the cards work together in 1-2 sentences
- Consider the user's color preferences, strategy, and any constraints
- Do NOT suggest planeswalker, conspiracy, vanguard, scheme, plane, phenomenon, dungeon, or attraction cards - they are excluded from this app
- Do NOT suggest Un-set / silver-border / acorn cards
- Do NOT suggest cards that are exclusive to Commander format or Commander-specific products (Commander Legends, Commander precon decks, etc.)
- Do NOT suggest cards that reference "commander" in their rules text
- Prefer cards that are legal in Modern or Legacy formats
- This is for a 60-card deck, NOT a Commander deck - avoid legendary creatures designed primarily as commanders

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
    language: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<ComboResult> => {
    const language = args.language ?? 'en'
    let userPrompt = 'Suggest exactly 5 core card combinations for a deck with these preferences:\n'

    if (args.colors.length > 0) {
      const colorNames: Record<string, string> = {
        W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
      }
      userPrompt += `Colors: ${args.colors.map((c) => colorNames[c] || c).join(', ')}\n`
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

    if (args.rejectedCombos && args.rejectedCombos.length > 0) {
      userPrompt += `\nIMPORTANT: The following combos were rejected. Suggest DIFFERENT combos that fix the issues:\n`
      for (const combo of args.rejectedCombos) {
        userPrompt += `- "${combo.name}": ${combo.reason}\n`
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
