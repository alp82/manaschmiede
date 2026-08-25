import { action } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import { MODELS, callAnthropic, callHaiku, isTruncated, TRUNCATED_RESPONSE_MESSAGE } from './lib/anthropic'
import { startLlmLog, completeLlmLog, failLlmLog, parseAndLog } from './lib/logLlmUsage'
import { cardEntry, parseCardList } from './lib/parseCardList'
import { enforceDeck } from './lib/deckRules'
import { BASIC_LAND_NAMES, BASIC_LAND_NAME_BY_COLOR } from './lib/basicLands'
import {
  HARD_FILTER_PROMPT_RULES,
  HARD_FILTER_SCRYFALL_QUERY,
  isPlayableCard,
} from './lib/cardFilters'
import { buildIntentContextPrompt, colorFilterClause, colorCastableClause } from './lib/intentContext'
import { extractSearchQueries, buildCombinedStrategy } from './lib/cardPoolQueries'
import { buildStrategyTraitPool } from './lib/strategyQueries'
import { parseStrategyQueries } from './lib/strategyParse'
import {
  DELTA_SYSTEM_PROMPT,
  buildDeltaUserMessage,
  parseDeltaResponse,
  type DeltaOp,
  type DeltaResult,
} from './lib/deltaPrompt'
export const SYSTEM_PROMPT = `You are an expert Magic: The Gathering casual deck builder.

RULES:
- ALWAYS exactly 60 cards in the main deck. Count all cards including lands.
- Maximum 4 copies of any card (except basic lands)
- Include 22-26 lands (aggro 22, midrange 24, control 25-26)
- Focus on a clear theme with strong synergies
- Good mana curve, include removal and card draw
- Use ONLY real, existing Magic cards with ENGLISH Oracle names
- Land base must support all colors proportionally
- For 3+ colors, include mana-fixing artifacts
${HARD_FILTER_PROMPT_RULES}

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

/**
 * The slice of a Scryfall search hit the pool needs: the prompt fields, plus
 * the hard-filter fields so `isPlayableCard` can run on the response. Every
 * field is one Scryfall returns on a search hit.
 */
interface PoolSearchHit {
  name: string
  type_line: string
  oracle_text?: string
  mana_cost?: string
  cmc: number
  color_identity: string[]
  layout: string
  set: string
  set_name: string
  legalities: Record<string, string>
  border_color?: string
  security_stamp?: string
  set_type?: string
  games?: string[]
  oversized?: boolean
  digital?: boolean
}

interface ScryfallSearchResult {
  data?: PoolSearchHit[]
}

/**
 * One card from a Scryfall pool search: the prompt line the model reads, plus
 * the raw `type_line` the 60-card enforcement uses to tell lands from spells.
 */
interface PoolCard {
  name: string
  typeLine: string
  line: string
}

/** A card pool as the prompt block the model reads plus its name -> type_line map. */
interface CardPool {
  block: string
  cardTypes: Record<string, string>
}

// Search Scryfall for cards matching a query. The hard filter rides along on
// every pool search, so the block the model reads can't offer it the cards the
// app rejects downstream - mirroring searchCards in src/lib/scryfall/client.ts.
//
// The query is parenthesized first. Scryfall binds implicit AND tighter than
// OR, so appending the filter to a bare `t:elf OR t:goblin` would exclude
// planeswalkers from the right branch only, and these queries come from a
// model that is free to write one.
async function scryfallSearch(query: string): Promise<PoolCard[]> {
  const url = new URL('https://api.scryfall.com/cards/search')
  url.searchParams.set('q', `(${query}) ${HARD_FILTER_SCRYFALL_QUERY}`)
  url.searchParams.set('order', 'edhrec') // sort by popularity
  url.searchParams.set('unique', 'cards')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data: ScryfallSearchResult = await res.json()
    // Belt and suspenders, the same pairing searchCards uses: the query asks
    // Scryfall to exclude these, and the pass here catches anything the query
    // misses. A pool card the app would reject costs a retry downstream.
    return (data.data ?? []).filter(isPlayableCard).map((c) => {
      const type = c.type_line.replace(/ —.*/, '') // "Creature" not "Creature — Elf Wizard"
      // The prompt gets the trimmed type; the map keeps the full type_line so
      // "Land Creature — Forest Dryad" still reads as a land downstream.
      return { name: c.name, typeLine: c.type_line, line: `${c.name} (${c.mana_cost ?? '0'}) [${type}]` }
    })
  } catch {
    return []
  }
}

// Persisted customStrategy is the deck's anchor theme. A long/conversational
// live chat message contributes no theme but could, via the <=3-fragment parse
// cap, displace persisted themes — so we trim+cap the live message before
// folding it into the parse input. Best-effort: a genuine short new theme still
// gets through; a runaway message degrades gracefully to the persisted anchor.
const STRATEGY_PARSE_TIMEOUT_MS = 8000
const LIVE_MESSAGE_PARSE_CAP = 240

// callHaiku uses bare fetch with no built-in timeout, so a stalled strategy
// parse would hang the suggestion path. Race it against an 8s guard that
// resolves to no fragments; the trait pool still carries the request.
function withParseTimeout(p: Promise<{ queries: string[] }>): Promise<{ queries: string[] }> {
  // Known caveat: on the timeout branch the losing parseStrategyQueries promise
  // keeps running and its completeLlmLog may fire after the action returns,
  // leaving an llmUsageLogs row in the pending state — acceptable since the
  // parse rarely exceeds 8s.
  return Promise.race([
    p.catch(() => ({ queries: [] as string[] })),
    new Promise<{ queries: string[] }>((resolve) =>
      setTimeout(() => resolve({ queries: [] }), STRATEGY_PARSE_TIMEOUT_MS),
    ),
  ])
}

/**
 * Fetch a list of Scryfall queries and format the results as a deduplicated
 * CARD POOL prompt block. Shared empty-guard + rate-limited fetch loop
 * (sliceSize results per query) + Set dedup + the "CARD POOL (prefer
 * these...)" format string. The block is '' when there are no queries or no
 * results.
 *
 * Also returns the pool's name -> type_line map, which is the only structured
 * card data the server has: the model answers with bare names, so this map is
 * what lets enforceDeckSize tell a dual land from a spell.
 */
export async function buildCardPoolBlock(
  queries: string[],
  sliceSize: number,
): Promise<CardPool> {
  const cardTypes: Record<string, string> = {}
  if (queries.length === 0) return { block: '', cardTypes }

  const allCards: PoolCard[] = []
  for (const query of queries) {
    // Rate limit: 100ms between requests
    await new Promise((r) => setTimeout(r, 100))
    const results = await scryfallSearch(query)
    allCards.push(...results.slice(0, sliceSize))
  }

  if (allCards.length === 0) return { block: '', cardTypes }

  const unique = new Set<string>()
  for (const card of allCards) {
    unique.add(card.line)
    cardTypes[card.name] = card.typeLine
  }
  return {
    block: `\n\nCARD POOL (prefer these, but you can suggest others):\n${[...unique].join('\n')}`,
    cardTypes,
  }
}

async function buildCardPool(
  ctx: ActionCtx,
  prompt: string,
  colors?: string[],
  customStrategy?: string,
): Promise<CardPool> {
  // Conditional parse: an empty strategy skips the Haiku call (no
  // chatStrategyParse log) and yields a byte-identical trait-only pool.
  const strategyInput = (customStrategy ?? '').trim()
  const strategyQueries = strategyInput !== ''
    ? (await withParseTimeout(
        parseStrategyQueries(ctx, { customStrategy: strategyInput, selectedColors: colors ?? [] }, 'chatStrategyParse'),
      )).queries
    : []
  const hasStrategy = strategyQueries.length > 0
  const traitQueries = extractSearchQueries(prompt, colors, hasStrategy)
  const queries = buildStrategyTraitPool(strategyQueries, traitQueries, colorCastableClause(colors ?? []))
  return buildCardPoolBlock(queries, 50)
}

type ChatIntent = 'rebuild' | 'question' | 'delta'

export const INTENT_CLASSIFIER_PROMPT = `Classify the user's latest message about their Magic: The Gathering deck into one of these intents:

- "delta": A small, targeted edit that names 1-3 specific cards to add, remove, or swap (e.g. "swap Lightning Bolt for Shock", "add 2 Counterspell", "cut Craw Wurm"). The deck stays the same except for those few cards.
- "rebuild": A broader rebuild or a vague direction with no specific cards (e.g. "make it more aggressive", "rebuild this as a control deck", "improve the mana base", "build me an Elf deck").
- "question": The user is asking a question about their deck, a card, rules, strategy, or MTG in general. They do NOT want the deck modified.

Respond with ONLY the intent word: "delta", "rebuild", or "question". Nothing else.`

export const QUESTION_SYSTEM_PROMPT = `You are an expert Magic: The Gathering advisor helping a player understand their 60-card casual deck.

RULES:
- Answer questions about the current deck, card interactions, strategy, rules, and MTG concepts
- Keep answers concise (2-4 sentences unless more detail is needed)
- Reference specific cards from the user's deck when relevant
- If asked about something completely unrelated to MTG or the deck, politely redirect: "I'm here to help with your deck! Ask me about cards, strategy, or rules."
- Respond in the same language the user writes in`

/**
 * Parse a deck response into a GeneratedDeck, dropping malformed cards.
 *
 * Quantities are NOT clamped here - `enforceDeckSize` owns the 4-copy rule for
 * a whole deck, because it also has to dedupe and re-balance to exactly 60.
 *
 * Throws 'Could not parse AI response as JSON' when no rung of the ladder
 * yields JSON, and 'AI response has an invalid format' when it yields
 * something that isn't a deck.
 */
export function parseResponse(text: string): GeneratedDeck {
  const parsed = parseCardList<{ cards: GeneratedCard }>(text, {
    lists: { cards: { entry: cardEntry(), required: true } },
    // Anchored on the `cards` key so an object in surrounding prose can't match.
    bareObjectAnchor: 'cards',
    scalars: { name: undefined, description: '', explanation: undefined },
    requiredScalars: ['name'],
    onFailure: 'throw',
  })

  return {
    // requiredScalars guarantees a non-empty name; the ?? is for the type only.
    name: parsed.scalars.name ?? '',
    description: parsed.scalars.description ?? '',
    explanation: parsed.scalars.explanation,
    cards: parsed.lists.cards,
  }
}

export interface EnforceDeckSizeOptions {
  /** Deck color identity as W/U/B/R/G letters. Picks the basics used for padding. */
  colors?: string[]
  /**
   * Card name -> Scryfall `type_line`, for the cards the prompt's card pool
   * knows about. Lets the trim step tell a dual land from a spell. Names that
   * are absent fall back to the basic-land name check, which is what the whole
   * function did before.
   */
  cardTypes?: Record<string, string>
}

/**
 * Layer 2: Programmatic enforcement - force deck to exactly 60 cards.
 *
 * The name adapter for `enforceDeck`: the rules work in opaque keys, so this
 * supplies the type-line predicates, the locked floors, and the colour -> basic
 * name map, and hands back a GeneratedDeck. The trim order, the 4-copy rule and
 * the pad split all live in `convex/lib/deckRules.ts` under the `'rebuild'`
 * policy, shared with the client (issue #28).
 */
export function enforceDeckSize(
  deck: GeneratedDeck,
  lockedCards?: Array<{ name: string; quantity: number }>,
  options?: EnforceDeckSizeOptions,
): GeneratedDeck {
  const lockedQuantities = new Map<string, number>()
  for (const c of lockedCards ?? []) lockedQuantities.set(c.name, c.quantity)

  const cardTypes = options?.cardTypes ?? {}
  const typeLineOf = (name: string) => (cardTypes[name] ?? '').toLowerCase()
  // Whole-word match: `includes('land')` would also fire on "island", the
  // subtype every blue basic and dual carries.
  const isBasic = (name: string) => {
    if (BASIC_LAND_NAMES.has(name)) return true
    const type = typeLineOf(name)
    return /\bbasic\b/.test(type) && /\bland\b/.test(type)
  }
  const isLand = (name: string) => isBasic(name) || /\bland\b/.test(typeLineOf(name))
  const basicForColor = (color: string) => BASIC_LAND_NAME_BY_COLOR[color]

  // The deck's declared colors are the truth about which basics belong here; a
  // mono-blue deck the model returned with no lands must pad with Islands. When
  // none of them name a basic, fall back to the colors of the basics the deck
  // already runs, and let deckRules take it from there.
  const declared = (options?.colors ?? []).filter((c) => basicForColor(c.toUpperCase()))
  const colors =
    declared.length > 0
      ? declared
      : Object.entries(BASIC_LAND_NAME_BY_COLOR)
          .filter(([, name]) => deck.cards.some((c) => c.name === name))
          .map(([color]) => color)

  deck.cards = enforceDeck(
    deck.cards.map((c) => ({ key: c.name, quantity: c.quantity })),
    {
      trimPolicy: 'rebuild',
      isBasic,
      isLand,
      colors,
      basicForColor,
      locked: new Set(lockedQuantities.keys()),
      lockedFloor: (name) => lockedQuantities.get(name) ?? 1,
    },
  ).map(({ key, quantity }) => ({ name: key, quantity }))

  return deck
}

async function generateWithEnforcement(
  ctx: ActionCtx,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  lockedCards?: Array<{ name: string; quantity: number }>,
  options?: EnforceDeckSizeOptions,
): Promise<GeneratedDeck> {
  // Quality tier (#46): deciding what 60 cards belong together IS the product.
  // One call per deck build, so the tier costs little in aggregate.
  const model = MODELS.main
  const logId = await startLlmLog(ctx, 'chat.generate', model, systemPrompt, messages)
  const result = await callAnthropic(systemPrompt, messages, { model, maxTokens: 4096 })
  const deck = await parseAndLog(ctx, logId, result, parseResponse)

  // Programmatic enforcement: force exactly 60 cards, 4-copy rule, land padding
  return enforceDeckSize(deck, lockedCards, options)
}

interface ChatResult {
  intent: ChatIntent
  // Present when intent === 'rebuild'
  deck?: GeneratedDeck
  // Present when intent === 'question'
  answer?: string
  // Present when intent === 'delta'
  delta?: DeltaResult
}

async function classifyIntent(ctx: ActionCtx, messages: Array<{ role: string; content: string }>): Promise<ChatIntent> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUserMsg) return 'rebuild'

  const inputMessages = [{ role: 'user', content: lastUserMsg.content }]
  const logId = await startLlmLog(ctx, 'chat.classify', MODELS.fast, INTENT_CLASSIFIER_PROMPT, inputMessages)
  try {
    const result = await callHaiku(INTENT_CLASSIFIER_PROMPT, inputMessages)
    await completeLlmLog(ctx, logId, result)
    // Truncation needs no special handling here: the answer is one word, and a
    // cut-off one falls through to 'rebuild' like any other unexpected label.
    const intent = result.text.trim().toLowerCase()
    if (intent === 'question') return 'question'
    if (intent === 'delta') return 'delta'
    return 'rebuild'
  } catch (err) {
    // Default to a rebuild on classification failure. The log entry is marked
    // errored rather than left pending forever.
    await failLlmLog(ctx, logId, err instanceof Error ? err.message : String(err))
    return 'rebuild'
  }
}

export function buildDeckContext(
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

/** Shared arg shape for the chat action and the generateDelta helper. */
interface ChatArgs {
  messages: Array<{ role: string; content: string }>
  currentCards?: Array<{ name: string; quantity: number; section?: string }>
  deckDescription?: string
  deckComposition?: string
  rejectedCards?: Array<{ name: string; reason: string }>
  lockedCards?: Array<{ name: string; quantity: number }>
  colors?: string[]
  archetypes?: string[]
  traits?: string[]
  customStrategy?: string
  budgetMin?: number
  budgetMax?: number
}

// Add/remove/swap verbs that hint the delta op for prompt framing and let a
// pure removal skip the (pointless) card-pool fetch. Best-effort heuristic only;
// the actual remove/add split comes from the model response.
const REMOVE_VERBS = /\b(remove|cut|drop|delete|take out|get rid of|entfern|raus|streich)/i
const ADD_VERBS = /\b(add|include|put in|insert|run|hinzufüg|hinzufueg|aufnehm|einbau)/i

export function deriveDeltaOp(message: string): DeltaOp {
  const wantsRemove = REMOVE_VERBS.test(message)
  const wantsAdd = ADD_VERBS.test(message)
  if (wantsRemove && !wantsAdd) return 'remove'
  if (wantsAdd && !wantsRemove) return 'add'
  return 'swap'
}

/**
 * Plain helper (no action-from-action) that produces a single-card delta edit.
 * One Haiku call wrapped with ctx + LLM-usage logging, mirroring how the chat
 * handler uses generateWithEnforcement. Returns a parsed DeltaResult; never
 * returns a full deck. The op is a pre-call hint - a pure removal skips the
 * card pool since there are no replacements to source.
 */
async function generateDelta(ctx: ActionCtx, args: ChatArgs): Promise<DeltaResult> {
  const lastUserMsg = [...args.messages].reverse().find((m) => m.role === 'user')
  const userText = lastUserMsg?.content ?? ''
  const op = deriveDeltaOp(userText)

  const deckContext = buildDeckContext(
    args.currentCards,
    args.deckDescription,
    args.lockedCards,
  )

  let systemPrompt = DELTA_SYSTEM_PROMPT

  // A pure removal needs no card pool (nothing to add). Otherwise narrow the
  // pool to on-color cards so the replacement/addition starts on-intent.
  if (op !== 'remove') {
    const searchContext = [args.deckDescription || '', userText].join(' ')
    const combinedStrategy = buildCombinedStrategy(args.customStrategy, userText, LIVE_MESSAGE_PARSE_CAP)
    const cardPool = await buildCardPool(ctx, searchContext, args.colors, combinedStrategy)
    systemPrompt += cardPool.block
  }

  systemPrompt += deckContext

  // Same hard-constraint block the full-deck path emits, so delta suggestions
  // honor the deck's intent identically.
  systemPrompt += buildIntentContextPrompt({
    colors: args.colors ?? [],
    archetypes: args.archetypes ?? [],
    traits: args.traits ?? [],
    customStrategy: args.customStrategy,
    budgetMin: args.budgetMin,
    budgetMax: args.budgetMax,
  })

  if (args.deckComposition) {
    systemPrompt += `\n\nDECK COMPOSITION (use this to avoid dead cards):\n${args.deckComposition}`
  }

  if (args.rejectedCards && args.rejectedCards.length > 0) {
    const recent = args.rejectedCards.slice(-5)
    systemPrompt += `\n\nPREVIOUSLY REJECTED CARDS - do not suggest these again:\n${recent.map((c) => `- ${c.name}: ${c.reason}`).join('\n')}`
  }

  const inputMessages = [{ role: 'user', content: buildDeltaUserMessage(op, userText) }]
  const model = MODELS.fast
  const logId = await startLlmLog(ctx, 'chat.delta', model, systemPrompt, inputMessages)
  const result = await callAnthropic(systemPrompt, inputMessages, { model, maxTokens: 1024 })

  return parseAndLog(ctx, logId, result, parseDeltaResponse)
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
    // Deck intent — the user-authored color/archetype/budget constraints that
    // the AI must honor on every suggestion. Rarity is intentionally not sent.
    colors: v.optional(v.array(v.string())),
    archetypes: v.optional(v.array(v.string())),
    traits: v.optional(v.array(v.string())),
    customStrategy: v.optional(v.string()),
    budgetMin: v.optional(v.number()),
    budgetMax: v.optional(v.number()),
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
      const qModel = MODELS.fast
      const logId = await startLlmLog(ctx, 'chat.question', qModel, systemPrompt, args.messages)
      const result = await callAnthropic(systemPrompt, args.messages, { model: qModel, maxTokens: 1024 })
      // Free text has no parse step to fail, so truncation is checked here.
      // A cut-off answer reads exactly like a finished one, and half an answer
      // about a rules interaction is worse than none.
      if (isTruncated(result)) {
        await failLlmLog(ctx, logId, TRUNCATED_RESPONSE_MESSAGE, result)
        throw new Error(TRUNCATED_RESPONSE_MESSAGE)
      }
      await completeLlmLog(ctx, logId, result)
      return { intent: 'question', answer: result.text }
    }

    if (intent === 'delta') {
      const delta = await generateDelta(ctx, args)
      return { intent: 'delta', delta }
    }

    // intent === 'rebuild'
    const lastUserMsg = [...args.messages].reverse().find((m) => m.role === 'user')
    const searchContext = [
      args.deckDescription || '',
      lastUserMsg?.content || '',
    ].join(' ')

    // Persisted strategy is the anchor; the live message is trimmed+capped so a
    // long chat turn can add a short new theme without displacing it.
    const combinedStrategy = buildCombinedStrategy(args.customStrategy, lastUserMsg?.content ?? '', LIVE_MESSAGE_PARSE_CAP)

    // Narrow the card pool to the allowed colors so the AI is steered toward
    // on-color cards from the start (the client gate is the hard backstop).
    const cardPool = await buildCardPool(ctx, searchContext, args.colors, combinedStrategy)

    let systemPrompt = SYSTEM_PROMPT + cardPool.block + deckContext

    // Shared deck-context block — the same HARD CONSTRAINT block fillSection
    // emits, so chat suggestions honor the deck's intent identically.
    systemPrompt += buildIntentContextPrompt({
      colors: args.colors ?? [],
      archetypes: args.archetypes ?? [],
      traits: args.traits ?? [],
      customStrategy: args.customStrategy,
      budgetMin: args.budgetMin,
      budgetMax: args.budgetMax,
    })

    if (args.deckComposition) {
      systemPrompt += `\n\nDECK COMPOSITION (use this to avoid dead cards):\n${args.deckComposition}`
    }

    if (args.rejectedCards && args.rejectedCards.length > 0) {
      const recent = args.rejectedCards.slice(-5)
      systemPrompt += `\n\nPREVIOUSLY REJECTED CARDS - do not suggest these again:\n${recent.map((c) => `- ${c.name}: ${c.reason}`).join('\n')}`
    }

    if (args.currentCards && args.currentCards.length > 0) {
      systemPrompt += `\n\nIMPORTANT: When the user requests changes, always return the COMPLETE updated card list, not just the changes. The deck must ALWAYS have exactly 60 cards. If you remove cards, add others to stay at 60.`
    }

    // The pool's type lines are the only card data the enforcement step has —
    // a card the model invented outside the pool still falls back to the
    // basic-land name check.
    const deck = await generateWithEnforcement(ctx, systemPrompt, args.messages, args.lockedCards, {
      colors: args.colors,
      cardTypes: cardPool.cardTypes,
    })
    return { intent: 'rebuild', deck }
  },
})

// ─── Section Fill ───────────────────────────────────────────

export const SECTION_FILL_SYSTEM_PROMPT = `You are filling ONE SECTION of a Magic: The Gathering 60-card casual deck.

RULES:
- Card quantities MUST sum to the target count specified
- Maximum 4 copies of any card (except basic lands)
- Use ONLY real, existing Magic cards with ENGLISH Oracle names
- Pick cards that fit the section description and synergize with existing deck cards
- Do NOT duplicate cards already in the deck
- Stay within the allowed color identity (see DECK CONTEXT)
${HARD_FILTER_PROMPT_RULES}

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

/**
 * Parse a section-fill response, dropping malformed cards and clamping
 * non-basics to the 4-copy rule. A fill never runs `enforceDeckSize`, so the
 * clamp has to happen here. No embedded-object rung: the fill prompt asks for
 * JSON only, so a response that needs one is malformed either way.
 */
export function parseSectionResponse(text: string): SectionFillResult {
  const parsed = parseCardList<{ cards: GeneratedCard }>(text, {
    lists: { cards: { entry: cardEntry({ clampCopies: true }), required: true } },
    scalars: { explanation: '' },
    onFailure: 'throw',
  })

  return {
    cards: parsed.lists.cards,
    explanation: parsed.scalars.explanation ?? '',
  }
}

async function buildSectionCardPool(
  ctx: ActionCtx,
  scryfallHints: string[],
  colors: string[],
  description: string,
  customStrategy?: string,
): Promise<string> {
  // fillSection has its own count enforcement and never calls enforceDeckSize,
  // so it needs the prompt block only.
  const colorFilter = colorFilterClause(colors)

  // Color-scoped hints first (capped at 2).
  const hintQueries = scryfallHints.slice(0, 2).map((hint) => `${hint}${colorFilter}`)

  // Then the free-text strategy + description keyword queries.
  const strat = (customStrategy ?? '').trim()
  const strategyQueries = strat !== ''
    ? (await withParseTimeout(
        parseStrategyQueries(ctx, { customStrategy: strat, selectedColors: colors }, 'fillStrategyParse'),
      )).queries
    : []
  const traitQueries = extractSearchQueries(description, colors, strategyQueries.length > 0)
  const descQueries = buildStrategyTraitPool(strategyQueries, traitQueries, colorCastableClause(colors))

  // slice(0,3) bounds a fill to <=2 hints + 3 desc = <=5 Scryfall calls.
  const queries = [...hintQueries, ...descQueries.slice(0, 3)]
  return (await buildCardPoolBlock(queries, 30)).block
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
    budgetLimit: v.optional(v.number()),
    deckComposition: v.optional(v.string()),
    rejectedCards: v.optional(
      v.array(v.object({ name: v.string(), reason: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<SectionFillResult> => {
    const cardPool = await buildSectionCardPool(
      ctx,
      args.scryfallHints,
      args.colors,
      args.sectionDescription,
      args.customStrategy,
    )

    let systemPrompt = SECTION_FILL_SYSTEM_PROMPT + cardPool

    // Shared deck-context block — byte-identical to chat()'s, so the two AI
    // paths constrain colors/archetypes/traits/strategy/budget the same way.
    systemPrompt += buildIntentContextPrompt({
      colors: args.colors,
      archetypes: args.archetypes,
      traits: args.traits,
      customStrategy: args.customStrategy,
      budgetMax: args.budgetLimit,
    })

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
    const fillModel = MODELS.fast
    const logId = await startLlmLog(ctx, 'fillSection', fillModel, systemPrompt, inputMessages)
    const llmResult = await callAnthropic(systemPrompt, inputMessages, { model: fillModel, maxTokens: 1024 })
    const result = await parseAndLog(ctx, logId, llmResult, parseSectionResponse)

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
