import { action } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import { callAnthropic, callHaiku } from './lib/anthropic'
import { startLlmLog, completeLlmLog } from './lib/logLlmUsage'
const SYSTEM_PROMPT = `You are an expert Magic: The Gathering casual deck builder.

RULES:
- ALWAYS exactly 60 cards in the main deck. Count all cards including lands.
- Maximum 4 copies of any card (except basic lands)
- Include 22-26 lands (aggro 22, midrange 24, control 25-26)
- Focus on a clear theme with strong synergies
- Good mana curve, include removal and card draw
- Use ONLY real, existing Magic cards with ENGLISH Oracle names
- Land base must support all colors proportionally
- For 3+ colors, include mana-fixing artifacts

Cards are validated automatically after generation — invalid cards get rejected and re-requested. Focus on synergy and fun.

COUNTING: Sum all quantities. Must be exactly 60. Typical: 24 lands + 36 non-lands.

OUTPUT FORMAT (JSON ONLY, no other text):
{
  "name": "Deck name",
  "description": "Short strategy description (1-2 sentences)",
  "explanation": "What changed and why (1-2 sentences) - only when modifying an existing deck",
  "total": 60,
  "cards": [
    { "name": "English Card Name", "quantity": 4 },
    { "name": "English Card Name", "quantity": 2 }
  ]
}

Respond ONLY with the JSON object. No explanatory text before or after.`

interface GeneratedCard {
  name: string
  quantity: number
}

interface GeneratedDeck {
  name: string
  description: string
  explanation?: string
  cards: GeneratedCard[]
}

interface ScryfallSearchResult {
  data?: Array<{
    name: string
    type_line: string
    oracle_text?: string
    mana_cost?: string
    cmc: number
    color_identity: string[]
  }>
}

// Search Scryfall for cards matching a query
async function scryfallSearch(query: string): Promise<string[]> {
  const url = new URL('https://api.scryfall.com/cards/search')
  url.searchParams.set('q', query)
  url.searchParams.set('order', 'edhrec') // sort by popularity
  url.searchParams.set('unique', 'cards')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data: ScryfallSearchResult = await res.json()
    return (data.data ?? []).map((c) => {
      const type = c.type_line.replace(/ —.*/, '') // "Creature" not "Creature — Elf Wizard"
      return `${c.name} (${c.mana_cost ?? '0'}) [${type}]`
    })
  } catch {
    return []
  }
}

// Extract likely search queries from a user prompt
function extractSearchQueries(prompt: string, colors?: string[]): string[] {
  const queries: string[] = []
  const lower = prompt.toLowerCase()

  // Color mapping
  const colorMap: Record<string, string> = {
    rot: 'r', red: 'r', schwarz: 'b', black: 'b',
    blau: 'u', blue: 'u', gruen: 'g', grün: 'g', green: 'g',
    weiss: 'w', weiß: 'w', white: 'w',
  }

  const detectedColors = new Set<string>()
  for (const [word, code] of Object.entries(colorMap)) {
    if (lower.includes(word)) detectedColors.add(code)
  }
  if (colors) colors.forEach((c) => detectedColors.add(c.toLowerCase()))

  const colorFilter = detectedColors.size > 0
    ? ` c:${Array.from(detectedColors).join('')}`
    : ''

  // Creature type / tribal detection
  const tribalPatterns = [
    'elf', 'elfen', 'elves', 'goblin', 'merfolk', 'meervolk', 'dragon', 'drachen',
    'zombie', 'vampire', 'angel', 'engel', 'demon', 'daemon', 'knight', 'ritter',
    'wizard', 'zauberer', 'warrior', 'krieger', 'soldier', 'soldat', 'beast',
    'elemental', 'spirit', 'geist', 'faerie', 'dinosaur', 'dinosaurier',
    'cat', 'katze', 'bird', 'vogel', 'snake', 'schlange', 'spider', 'spinne',
    'rat', 'ratte', 'human', 'mensch', 'cleric', 'kleriker', 'rogue', 'schurke',
    'shaman', 'schamane', 'druid', 'druide', 'pirate', 'skeleton', 'skelett',
  ]

  for (const tribe of tribalPatterns) {
    if (lower.includes(tribe)) {
      const englishTribe = tribe.replace(/en$/, '') // rough de->en
      queries.push(`t:creature t:${englishTribe}${colorFilter}`)
      break
    }
  }

  // Theme detection
  const themes: Record<string, string> = {
    'lifegain': 'o:"gain life"',
    'leben': 'o:"gain life"',
    'token': 'o:"create" o:"token"',
    'graveyard': 'o:graveyard',
    'friedhof': 'o:graveyard',
    'counter': 'o:"+1/+1 counter"',
    'mill': 'o:mill',
    'burn': 'o:"damage to" t:instant',
    'aggro': 'cmc<=3 t:creature',
    'control': 't:instant o:counter',
    'ramp': 'o:"search your library" o:land',
    'equipment': 't:equipment',
    'enchantment': 't:enchantment',
    'artifact': 't:artifact',
    'flyer': 'o:flying t:creature',
    'flieger': 'o:flying t:creature',
    'removal': '(o:destroy OR o:exile) t:instant',
    'sacrifice': 'o:"whenever" o:"dies"',
    'sacrifice-payoff': 'o:"whenever a creature dies"',
    'drain': 'o:"loses" o:"life" o:"gain"',
    'mana fixing': 't:artifact o:"add" o:"mana of any color"',
    'multicolor': 'id>=3 t:creature r>=rare',
    'goodstuff': 't:artifact o:"add" o:"mana of any color"',
  }

  for (const [keyword, query] of Object.entries(themes)) {
    if (lower.includes(keyword)) {
      queries.push(`${query}${colorFilter}`)
    }
  }

  // General creature search for the colors
  if (colorFilter && queries.length === 0) {
    queries.push(`t:creature${colorFilter}`)
  }

  // Always add a removal + utility search
  if (colorFilter) {
    queries.push(`(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery)${colorFilter}`)
  }

  return queries.slice(0, 4) // max 4 searches
}

async function buildCardPool(prompt: string): Promise<string> {
  const queries = extractSearchQueries(prompt)
  if (queries.length === 0) return ''

  const allCards: string[] = []
  for (const query of queries) {
    // Rate limit: 100ms between requests
    await new Promise((r) => setTimeout(r, 100))
    const results = await scryfallSearch(query)
    allCards.push(...results.slice(0, 50))
  }

  if (allCards.length === 0) return ''

  // Deduplicate
  const unique = [...new Set(allCards)]

  return `\n\nCARD POOL (prefer these, but you can suggest others):\n${unique.join('\n')}`
}

type ChatIntent = 'change' | 'question'

const INTENT_CLASSIFIER_PROMPT = `Classify the user's latest message about their Magic: The Gathering deck into one of these intents:

- "change": The user wants to modify their deck (add/remove/swap cards, change strategy, build a new deck, suggest improvements, make it more aggressive, etc.)
- "question": The user is asking a question about their deck, a card, rules, strategy, or MTG in general. They do NOT want the deck modified.

Respond with ONLY the intent word: "change" or "question". Nothing else.`

const QUESTION_SYSTEM_PROMPT = `You are an expert Magic: The Gathering advisor helping a player understand their 60-card casual deck.

RULES:
- Answer questions about the current deck, card interactions, strategy, rules, and MTG concepts
- Keep answers concise (2-4 sentences unless more detail is needed)
- Reference specific cards from the user's deck when relevant
- If asked about something completely unrelated to MTG or the deck, politely redirect: "I'm here to help with your deck! Ask me about cards, strategy, or rules."
- Respond in the same language the user writes in`

function parseResponse(text: string): GeneratedDeck {
  let deck: GeneratedDeck
  try {
    deck = JSON.parse(text)
  } catch {
    // Try code fence
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      deck = JSON.parse(fenceMatch[1].trim())
    } else {
      // Try to find a JSON object anywhere in the response
      const jsonMatch = text.match(/\{[\s\S]*"cards"\s*:\s*\[[\s\S]*\][\s\S]*\}/)
      if (jsonMatch) {
        deck = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('Could not parse AI response as JSON')
      }
    }
  }

  if (!deck.name || !deck.cards || !Array.isArray(deck.cards)) {
    throw new Error('AI response has an invalid format')
  }

  deck.cards = deck.cards.filter(
    (c) =>
      typeof c.name === 'string' &&
      c.name.length > 0 &&
      typeof c.quantity === 'number' &&
      c.quantity > 0,
  )

  return {
    name: deck.name,
    description: deck.description || '',
    explanation: deck.explanation,
    cards: deck.cards,
  }
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
const TARGET_SIZE = 60
const MAX_COPIES = 4

/**
 * Layer 2: Programmatic enforcement - force deck to exactly 60 cards.
 * Respects locked cards and the 4-copy rule.
 */
function enforceDeckSize(
  deck: GeneratedDeck,
  lockedCards?: Array<{ name: string; quantity: number }>,
): GeneratedDeck {
  const lockedSet = new Map<string, number>()
  if (lockedCards) {
    for (const c of lockedCards) lockedSet.set(c.name, c.quantity)
  }

  // Step 1: Enforce 4-copy rule (except basic lands)
  for (const card of deck.cards) {
    if (!BASIC_LAND_NAMES.has(card.name)) {
      card.quantity = Math.min(card.quantity, MAX_COPIES)
    }
    card.quantity = Math.max(card.quantity, 1)
  }

  // Step 2: Deduplicate (AI sometimes lists the same card twice)
  const merged = new Map<string, number>()
  for (const card of deck.cards) {
    merged.set(card.name, (merged.get(card.name) || 0) + card.quantity)
  }
  deck.cards = Array.from(merged, ([name, quantity]) => {
    // Re-enforce max copies after merge
    if (!BASIC_LAND_NAMES.has(name)) {
      quantity = Math.min(quantity, MAX_COPIES)
    }
    return { name, quantity }
  })

  let total = deck.cards.reduce((s, c) => s + c.quantity, 0)

  // Step 3: Trim if over 60
  if (total > TARGET_SIZE) {
    // Sort cards by priority: locked first, then lands, then by quantity desc
    // We'll trim from the end (lowest priority)
    const trimmable = deck.cards
      .map((c, i) => ({ ...c, index: i, isLocked: lockedSet.has(c.name), isLand: BASIC_LAND_NAMES.has(c.name) }))
      .filter((c) => !c.isLocked)
      // Trim non-lands first, then lands. Within each group, trim cards with highest quantity first
      .sort((a, b) => {
        if (a.isLand !== b.isLand) return a.isLand ? 1 : -1 // non-lands first
        return b.quantity - a.quantity // highest qty first (reduce 4x to 3x before removing 1x)
      })

    let excess = total - TARGET_SIZE
    for (const card of trimmable) {
      if (excess <= 0) break
      const deckCard = deck.cards[card.index]
      const minQty = lockedSet.get(card.name) || 1
      const canRemove = Math.min(deckCard.quantity - minQty, excess)
      if (canRemove > 0) {
        deckCard.quantity -= canRemove
        excess -= canRemove
      }
    }

    // Remove zero-quantity cards
    deck.cards = deck.cards.filter((c) => c.quantity > 0)
    total = deck.cards.reduce((s, c) => s + c.quantity, 0)
  }

  // Step 4: Pad if under 60 - add basic lands proportionally
  if (total < TARGET_SIZE) {
    const deficit = TARGET_SIZE - total
    // Detect deck colors from non-land card names (rough heuristic from existing lands)
    const landNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']
    const existingLands = landNames.filter((l) =>
      deck.cards.some((c) => c.name === l),
    )
    const landsToUse = existingLands.length > 0 ? existingLands : ['Forest'] // fallback

    const perLand = Math.floor(deficit / landsToUse.length)
    const remainder = deficit % landsToUse.length

    for (let i = 0; i < landsToUse.length; i++) {
      const landName = landsToUse[i]
      const addQty = perLand + (i < remainder ? 1 : 0)
      if (addQty <= 0) continue

      const existing = deck.cards.find((c) => c.name === landName)
      if (existing) {
        existing.quantity += addQty
      } else {
        deck.cards.push({ name: landName, quantity: addQty })
      }
    }
  }

  return deck
}

async function generateWithEnforcement(
  ctx: ActionCtx,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  lockedCards?: Array<{ name: string; quantity: number }>,
): Promise<GeneratedDeck> {
  const model = 'claude-haiku-4-5-20251001'
  const logId = await startLlmLog(ctx, 'chat.generate', model, systemPrompt, messages)
  const result = await callAnthropic(systemPrompt, messages, { model, maxTokens: 4096 })
  await completeLlmLog(ctx, logId, result)
  const deck = parseResponse(result.text)

  // Programmatic enforcement: force exactly 60 cards, 4-copy rule, land padding
  return enforceDeckSize(deck, lockedCards)
}

interface ChatResult {
  intent: ChatIntent
  // Present when intent === 'change'
  deck?: GeneratedDeck
  // Present when intent === 'question'
  answer?: string
}

async function classifyIntent(ctx: ActionCtx, messages: Array<{ role: string; content: string }>): Promise<ChatIntent> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUserMsg) return 'change'

  const inputMessages = [{ role: 'user', content: lastUserMsg.content }]
  try {
    const logId = await startLlmLog(ctx, 'chat.classify', 'claude-haiku-4-5-20251001', INTENT_CLASSIFIER_PROMPT, inputMessages)
    const result = await callHaiku(INTENT_CLASSIFIER_PROMPT, inputMessages)
    await completeLlmLog(ctx, logId, result)
    const intent = result.text.trim().toLowerCase()
    if (intent === 'question') return 'question'
    return 'change'
  } catch {
    // Default to change on classification failure
    return 'change'
  }
}

function buildDeckContext(
  currentCards?: Array<{ name: string; quantity: number; section?: string }>,
  deckDescription?: string,
  lockedCards?: Array<{ name: string; quantity: number }>,
): string {
  let context = ''

  if (deckDescription) {
    context += `\n\nDECK STRATEGY: ${deckDescription}`
  }

  if (currentCards && currentCards.length > 0) {
    // Group cards by section for clearer context
    const bySection = new Map<string, typeof currentCards>()
    for (const c of currentCards) {
      const key = c.section ?? 'Other'
      const list = bySection.get(key) ?? []
      list.push(c)
      bySection.set(key, list)
    }

    const totalCards = currentCards.reduce((s, c) => s + c.quantity, 0)
    let cardList: string

    if (bySection.size > 1 || (bySection.size === 1 && !bySection.has('Other'))) {
      // Has section info - format grouped
      const parts: string[] = []
      for (const [section, cards] of bySection) {
        parts.push(`[${section}]`)
        for (const c of cards) parts.push(`  ${c.quantity}x ${c.name}`)
      }
      cardList = parts.join('\n')
    } else {
      cardList = currentCards.map((c) => `${c.quantity}x ${c.name}`).join('\n')
    }

    context += `\n\nCURRENT DECK (${totalCards} cards):\n${cardList}`
    context += `\n\nWhen replacing a card, the replacement should serve the same role and fit the same section.`
  }

  if (lockedCards && lockedCards.length > 0) {
    const lockedList = lockedCards
      .map((c) => `${c.quantity}x ${c.name}`)
      .join('\n')
    context += `\n\nLOCKED CARDS (do NOT remove or change them):\n${lockedList}`
  }

  return context
}

export const chat = action({
  args: {
    messages: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
      }),
    ),
    currentCards: v.optional(
      v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
          section: v.optional(v.string()),
        }),
      ),
    ),
    deckDescription: v.optional(v.string()),
    deckComposition: v.optional(v.string()),
    rejectedCards: v.optional(
      v.array(
        v.object({
          name: v.string(),
          reason: v.string(),
        }),
      ),
    ),
    lockedCards: v.optional(
      v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<ChatResult> => {
    const intent = await classifyIntent(ctx, args.messages)
    const deckContext = buildDeckContext(
      args.currentCards,
      args.deckDescription,
      args.lockedCards,
    )

    if (intent === 'question') {
      const systemPrompt = QUESTION_SYSTEM_PROMPT + deckContext
      const qModel = 'claude-haiku-4-5-20251001'
      const logId = await startLlmLog(ctx, 'chat.question', qModel, systemPrompt, args.messages)
      const result = await callAnthropic(systemPrompt, args.messages, { model: qModel, maxTokens: 1024 })
      await completeLlmLog(ctx, logId, result)
      return { intent: 'question', answer: result.text }
    }

    // intent === 'change'
    const lastUserMsg = [...args.messages].reverse().find((m) => m.role === 'user')
    const searchContext = [
      args.deckDescription || '',
      lastUserMsg?.content || '',
    ].join(' ')

    const cardPool = await buildCardPool(searchContext)

    let systemPrompt = SYSTEM_PROMPT + cardPool + deckContext

    if (args.deckComposition) {
      systemPrompt += `\n\nDECK COMPOSITION (use this to avoid dead cards):\n${args.deckComposition}`
    }

    if (args.rejectedCards && args.rejectedCards.length > 0) {
      const recent = args.rejectedCards.slice(-5)
      systemPrompt += `\n\nPREVIOUSLY REJECTED CARDS - do not suggest these again:\n${recent.map((c) => `- ${c.name}: ${c.reason}`).join('\n')}`
    }

    if (args.currentCards && args.currentCards.length > 0) {
      systemPrompt += `\n\nIMPORTANT: When the user requests changes, always return the COMPLETE updated card list, not just the changes. The deck must ALWAYS have exactly 60 cards. If you remove cards, add others to stay at 60. Maintain the deck's color identity and land base.`
    }

    const deck = await generateWithEnforcement(ctx, systemPrompt, args.messages, args.lockedCards)
    return { intent: 'change', deck }
  },
})

// ─── Section Fill ───────────────────────────────────────────

const SECTION_FILL_SYSTEM_PROMPT = `You are filling ONE SECTION of a Magic: The Gathering 60-card casual deck.

RULES:
- Card quantities MUST sum to the target count specified
- Maximum 4 copies of any card (except basic lands)
- Use ONLY real, existing Magic cards with ENGLISH Oracle names
- Pick cards that fit the section description and synergize with existing deck cards
- Do NOT duplicate cards already in the deck
- Stay within the allowed color identity (see DECK CONTEXT)

Cards are validated automatically — wrong colors, bad synergies, and invalid cards get rejected.

OUTPUT FORMAT (JSON ONLY, no other text):
{
  "cards": [
    { "name": "English Card Name", "quantity": 4 },
    { "name": "English Card Name", "quantity": 2 }
  ],
  "explanation": "Brief explanation of the card choices (1-2 sentences)"
}

Respond ONLY with the JSON object. No explanatory text before or after.`

interface SectionFillResult {
  cards: GeneratedCard[]
  explanation: string
}

function parseSectionResponse(text: string): SectionFillResult {
  let result: SectionFillResult
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

  if (!result.cards || !Array.isArray(result.cards)) {
    throw new Error('AI response has an invalid format')
  }

  result.cards = result.cards.filter(
    (c) =>
      typeof c.name === 'string' &&
      c.name.length > 0 &&
      typeof c.quantity === 'number' &&
      c.quantity > 0,
  )

  // Enforce 4-copy rule
  for (const card of result.cards) {
    if (!BASIC_LAND_NAMES.has(card.name)) {
      card.quantity = Math.min(card.quantity, MAX_COPIES)
    }
  }

  return {
    cards: result.cards,
    explanation: result.explanation || '',
  }
}

async function buildSectionCardPool(
  scryfallHints: string[],
  colors: string[],
  description: string,
): Promise<string> {
  const colorFilter = colors.length > 0 ? ` c:${colors.join('').toLowerCase()}` : ''
  const allCards: string[] = []

  // Use provided Scryfall hints
  for (const hint of scryfallHints.slice(0, 2)) {
    await new Promise((r) => setTimeout(r, 100))
    const results = await scryfallSearch(`${hint}${colorFilter}`)
    allCards.push(...results.slice(0, 30))
  }

  // Also search based on description keywords
  const descQueries = extractSearchQueries(description, colors)
  for (const query of descQueries.slice(0, 1)) {
    await new Promise((r) => setTimeout(r, 100))
    const results = await scryfallSearch(query)
    allCards.push(...results.slice(0, 30))
  }

  if (allCards.length === 0) return ''

  const unique = [...new Set(allCards)]
  return `\n\nCARD POOL (prefer these, but you can suggest others):\n${unique.join('\n')}`
}

export const fillSection = action({
  args: {
    sectionName: v.string(),
    sectionDescription: v.string(),
    targetCount: v.number(),
    scryfallHints: v.array(v.string()),
    currentCards: v.optional(v.array(v.object({ name: v.string(), quantity: v.number() }))),
    colors: v.array(v.string()),
    archetypes: v.array(v.string()),
    traits: v.array(v.string()),
    customStrategy: v.optional(v.string()),
    format: v.optional(v.string()),
    budgetLimit: v.optional(v.number()),
    deckComposition: v.optional(v.string()),
    rejectedCards: v.optional(
      v.array(v.object({ name: v.string(), reason: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<SectionFillResult> => {
    const cardPool = await buildSectionCardPool(
      args.scryfallHints,
      args.colors,
      args.sectionDescription,
    )

    let systemPrompt = SECTION_FILL_SYSTEM_PROMPT + cardPool

    // Add deck context
    const colorNames: Record<string, string> = {
      W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
    }
    systemPrompt += `\n\nDECK CONTEXT:`
    if (args.colors.length > 0) {
      const colorList = args.colors.map((c) => colorNames[c] || c).join(', ')
      const colorCodes = args.colors.join('')
      systemPrompt += `\nAllowed colors (HARD CONSTRAINT): ${colorList} [${colorCodes}]`
      systemPrompt += `\nOnly suggest cards whose color identity is a subset of {${colorCodes}}. Anything outside this set - including multicolor cards that touch other colors - will be rejected.`
    }
    if (args.archetypes.length > 0) systemPrompt += `\nArchetypes: ${args.archetypes.join(', ')}`
    if (args.traits.length > 0) systemPrompt += `\nTraits: ${args.traits.join(', ')}`
    if (args.customStrategy) systemPrompt += `\nStrategy: ${args.customStrategy}`
    if (args.format && args.format !== 'casual') systemPrompt += `\nFormat: ${args.format}`
    if (args.budgetLimit != null) systemPrompt += `\nBudget: max $${args.budgetLimit.toFixed(2)} per card`

    if (args.deckComposition) {
      systemPrompt += `\n\nDECK COMPOSITION (use this to avoid dead cards):\n${args.deckComposition}`
    }

    if (args.currentCards && args.currentCards.length > 0) {
      const cardList = args.currentCards.map((c) => `${c.quantity}x ${c.name}`).join('\n')
      systemPrompt += `\n\nCARDS ALREADY IN DECK (do NOT suggest these again):\n${cardList}`
    }

    if (args.rejectedCards && args.rejectedCards.length > 0) {
      const recent = args.rejectedCards.slice(-5)
      systemPrompt += `\n\nPREVIOUSLY REJECTED CARDS - do not suggest these again:\n${recent.map((c) => `- ${c.name}: ${c.reason}`).join('\n')}`
    }

    const userMessage = `Fill the "${args.sectionName}" section with exactly ${args.targetCount} cards total (sum of quantities = ${args.targetCount}).\n\nSection description: ${args.sectionDescription}`

    const inputMessages = [{ role: 'user', content: userMessage }]
    const fillModel = 'claude-haiku-4-5-20251001'
    const logId = await startLlmLog(ctx, 'fillSection', fillModel, systemPrompt, inputMessages)
    const llmResult = await callAnthropic(systemPrompt, inputMessages, { model: fillModel, maxTokens: 1024 })
    await completeLlmLog(ctx, logId, llmResult)

    const result = parseSectionResponse(llmResult.text)

    // Enforce target count - trim excess from end
    let total = result.cards.reduce((s, c) => s + c.quantity, 0)
    if (total > args.targetCount) {
      for (let i = result.cards.length - 1; i >= 0 && total > args.targetCount; i--) {
        const reduce = Math.min(result.cards[i].quantity, total - args.targetCount)
        result.cards[i].quantity -= reduce
        total -= reduce
      }
      result.cards = result.cards.filter((c) => c.quantity > 0)
    }

    return result
  },
})
