import { action } from './_generated/server'
import { v } from 'convex/values'
import { callAnthropic, callHaiku } from './lib/anthropic'

const SYSTEM_PROMPT = `You are an expert Magic: The Gathering casual deck builder.

RULES:
- ALWAYS exactly 60 cards in the main deck. Count all cards including lands. This is the most important rule.
- Maximum 4 copies of any card (except basic lands: Plains, Island, Swamp, Mountain, Forest)
- Include 22-26 lands. This is critical for a playable deck:
  - Aggro decks (avg CMC < 2.5): 22 lands
  - Midrange decks (avg CMC 2.5-3.5): 24 lands
  - Control/ramp decks (avg CMC > 3.5): 25-26 lands
  - NEVER go below 22 lands unless using extensive mana dorks
- Focus on a clear theme or strategy with strong synergies
- Build a good mana curve (mix of cheap and expensive cards)
- Include removal (3-6 cards), card draw (3-5 cards), and synergy cards
- Use ONLY real, existing Magic: The Gathering cards
- Use ENGLISH card names (official Oracle names)
- Make sure the land base supports all colors in the deck — each color needs proportional land support
- Do NOT suggest planeswalker, conspiracy, vanguard, scheme, plane, phenomenon, dungeon, or attraction cards — they are excluded from this app
- Do NOT suggest Un-set / silver-border / acorn cards
- Do NOT suggest cards from Commander-specific sets or cards that reference "commander"

COUNTING:
Before outputting, mentally sum all quantities. The total MUST be exactly 60.
A typical split: 24 lands + 36 non-lands = 60. Verify your math.

OUTPUT FORMAT (JSON ONLY, no other text):
{
  "name": "Deck name",
  "description": "Short strategy description (1-2 sentences)",
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
      const parts = [c.name]
      if (c.mana_cost) parts.push(c.mana_cost)
      parts.push(`[${c.type_line}]`)
      if (c.oracle_text) parts.push(c.oracle_text.slice(0, 100))
      return parts.join(' — ')
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
    allCards.push(...results.slice(0, 100)) // top 100 per query
  }

  if (allCards.length === 0) return ''

  // Deduplicate
  const unique = [...new Set(allCards)]

  return `\n\nCARD POOL (real cards that match the theme — prefer picking from these, but you can add others you know exist):
${unique.join('\n')}`
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
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      deck = JSON.parse(match[1].trim())
    } else {
      throw new Error('Could not parse AI response as JSON')
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
    cards: deck.cards,
  }
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
const TARGET_SIZE = 60
const MAX_COPIES = 4

/**
 * Layer 2: Programmatic enforcement — force deck to exactly 60 cards.
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

  // Step 4: Pad if under 60 — add basic lands proportionally
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

/**
 * Layer 3: Correction re-prompt — if wildly off, ask AI to fix it once.
 */
const CORRECTION_PROMPT = `The deck you generated has {total} cards instead of exactly 60. Fix this and return the corrected deck with EXACTLY 60 cards total.

Keep the same strategy and card choices but adjust quantities so the sum is exactly 60. Do not add or remove card types unless necessary.

Return the corrected deck in the same JSON format.`

async function generateWithEnforcement(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  lockedCards?: Array<{ name: string; quantity: number }>,
): Promise<GeneratedDeck> {
  const text = await callAnthropic(systemPrompt, messages)
  let deck = parseResponse(text)
  let total = deck.cards.reduce((s, c) => s + c.quantity, 0)

  // Layer 3: If wildly off (more than 5 cards away), try one correction re-prompt
  if (Math.abs(total - TARGET_SIZE) > 5) {
    try {
      const correctionMsg = CORRECTION_PROMPT.replace('{total}', String(total))
      const correctedText = await callAnthropic(systemPrompt, [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: correctionMsg },
      ])
      const correctedDeck = parseResponse(correctedText)
      const correctedTotal = correctedDeck.cards.reduce((s, c) => s + c.quantity, 0)

      // Only use the correction if it's actually closer to 60
      if (Math.abs(correctedTotal - TARGET_SIZE) < Math.abs(total - TARGET_SIZE)) {
        deck = correctedDeck
        total = correctedTotal
      }
    } catch {
      // Correction failed, proceed with programmatic fix
    }
  }

  // Layer 2: Programmatic enforcement always runs as final guarantee
  return enforceDeckSize(deck, lockedCards)
}

export const generate = action({
  args: {
    prompt: v.string(),
    format: v.string(),
  },
  handler: async (_ctx, args): Promise<GeneratedDeck> => {
    const cardPool = await buildCardPool(args.prompt)
    const system = SYSTEM_PROMPT + cardPool
    return generateWithEnforcement(system, [
      { role: 'user', content: `Build a casual 60-card deck with this theme: ${args.prompt}` },
    ])
  },
})

interface ChatResult {
  intent: ChatIntent
  // Present when intent === 'change'
  deck?: GeneratedDeck
  // Present when intent === 'question'
  answer?: string
}

async function classifyIntent(messages: Array<{ role: string; content: string }>): Promise<ChatIntent> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUserMsg) return 'change'

  try {
    const result = await callHaiku(INTENT_CLASSIFIER_PROMPT, [
      { role: 'user', content: lastUserMsg.content },
    ])
    const intent = result.trim().toLowerCase()
    if (intent === 'question') return 'question'
    return 'change'
  } catch {
    // Default to change on classification failure
    return 'change'
  }
}

function buildDeckContext(
  currentCards?: Array<{ name: string; quantity: number }>,
  deckDescription?: string,
  lockedCards?: Array<{ name: string; quantity: number }>,
): string {
  let context = ''

  if (deckDescription) {
    context += `\n\nDECK STRATEGY: ${deckDescription}`
  }

  if (currentCards && currentCards.length > 0) {
    const cardList = currentCards
      .map((c) => `${c.quantity}x ${c.name}`)
      .join('\n')
    const totalCards = currentCards.reduce((s, c) => s + c.quantity, 0)
    context += `\n\nCURRENT DECK (${totalCards} cards):\n${cardList}`
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
        }),
      ),
    ),
    deckDescription: v.optional(v.string()),
    lockedCards: v.optional(
      v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
        }),
      ),
    ),
  },
  handler: async (_ctx, args): Promise<ChatResult> => {
    const intent = await classifyIntent(args.messages)
    const deckContext = buildDeckContext(
      args.currentCards,
      args.deckDescription,
      args.lockedCards,
    )

    if (intent === 'question') {
      const systemPrompt = QUESTION_SYSTEM_PROMPT + deckContext
      const answer = await callAnthropic(systemPrompt, args.messages)
      return { intent: 'question', answer }
    }

    // intent === 'change'
    const lastUserMsg = [...args.messages].reverse().find((m) => m.role === 'user')
    const searchContext = [
      args.deckDescription || '',
      lastUserMsg?.content || '',
    ].join(' ')

    const cardPool = await buildCardPool(searchContext)

    let systemPrompt = SYSTEM_PROMPT + cardPool + deckContext

    if (args.currentCards && args.currentCards.length > 0) {
      systemPrompt += `\n\nIMPORTANT: When the user requests changes, always return the COMPLETE updated card list, not just the changes. The deck must ALWAYS have exactly 60 cards. If you remove cards, add others to stay at 60. Maintain the deck's color identity and land base.`
    }

    const deck = await generateWithEnforcement(systemPrompt, args.messages, args.lockedCards)
    return { intent: 'change', deck }
  },
})
