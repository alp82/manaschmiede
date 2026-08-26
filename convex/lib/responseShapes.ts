/**
 * The shapes the three deck-building call sites ask a model for, and the
 * parsers that read them: a whole deck (`chat.generate`), a section's worth of
 * cards (`fillSection`), and a list of combos (`suggestCombos`). The name
 * adapter that forces a parsed deck to exactly 60 cards lives here too, since
 * it works on the parsed shape.
 *
 * These used to sit in the actions themselves. They moved here so the
 * mechanical gate (`mechanicalGate.ts`) can run the very same parser the site
 * runs on a candidate model's raw output, and score what the enforcer had to
 * repair - a second copy of the parse spec would drift, which is the bug
 * issue #28 was filed for. The actions re-export them, so their tests and
 * call sites are unchanged.
 *
 * Zero runtime imports, like every other module in `convex/lib/` that both
 * trees reach. Everything imported here is dependency-free itself.
 */
import { cardEntry, isNonEmptyString, parseCardList } from './parseCardList'
import type { JsonLadderRung } from './jsonLadder'
import { enforceDeck } from './deckRules'
import { BASIC_LAND_NAMES, BASIC_LAND_NAME_BY_COLOR } from './basicLands'

export interface GeneratedCard {
  name: string
  quantity: number
}

export interface GeneratedDeck {
  name: string
  description: string
  explanation?: string
  cards: GeneratedCard[]
}

/**
 * A parsed response plus the ladder rung that yielded it. The `read*` variants
 * return this for the mechanical gate, which scores on the rung; the plain
 * parsers the actions call drop it, so nothing extra crosses the wire.
 */
export interface ReadResponse<T> {
  value: T
  rung: JsonLadderRung
}

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
export function parseDeckResponse(text: string): GeneratedDeck {
  return readDeckResponse(text).value
}

/** `parseDeckResponse`, reporting the ladder rung as well. */
export function readDeckResponse(text: string): ReadResponse<GeneratedDeck> {
  const parsed = parseCardList<{ cards: GeneratedCard }>(text, {
    lists: { cards: { entry: cardEntry(), required: true } },
    // Anchored on the `cards` key so an object in surrounding prose can't match.
    bareObjectAnchor: 'cards',
    scalars: { name: undefined, description: '', explanation: undefined },
    requiredScalars: ['name'],
    onFailure: 'throw',
  })

  return {
    value: {
      // requiredScalars guarantees a non-empty name; the ?? is for the type only.
      name: parsed.scalars.name ?? '',
      description: parsed.scalars.description ?? '',
      explanation: parsed.scalars.explanation,
      cards: parsed.lists.cards,
    },
    // onFailure: 'throw' means a returned result always climbed a rung.
    rung: parsed.rung ?? 1,
  }
}

export interface SectionFillResult {
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
  return readSectionResponse(text).value
}

/** `parseSectionResponse`, reporting the ladder rung as well. */
export function readSectionResponse(text: string): ReadResponse<SectionFillResult> {
  const parsed = parseCardList<{ cards: GeneratedCard }>(text, {
    lists: { cards: { entry: cardEntry({ clampCopies: true }), required: true } },
    scalars: { explanation: '' },
    onFailure: 'throw',
  })

  return {
    value: { cards: parsed.lists.cards, explanation: parsed.scalars.explanation ?? '' },
    rung: parsed.rung ?? 1,
  }
}

export interface Combo {
  name: string
  cards: string[]
  explanation: string
}

export interface ComboResult {
  combos: Combo[]
}

/**
 * Coerce one raw combo. A combo needs a name, at least two named cards, and an
 * explanation - anything else is dropped. The shape is local to that call
 * site, so the adapter is too; only the name rule comes from the shared module.
 */
function comboEntry(raw: unknown): Combo | null {
  if (raw === null || typeof raw !== 'object') return null
  const { name, cards, explanation } = raw as {
    name?: unknown
    cards?: unknown
    explanation?: unknown
  }
  if (!isNonEmptyString(name)) return null
  if (typeof explanation !== 'string') return null
  if (!Array.isArray(cards) || cards.length < 2) return null
  // Every element has to be a real card name - a null in here would reach
  // Scryfall as a lookup.
  if (!cards.every(isNonEmptyString)) return null
  return { name, cards: [...cards], explanation }
}

/**
 * Parse a combo response and drop malformed combos. No embedded-object rung:
 * the prompt asks for JSON only, so a response that needs one is malformed
 * either way.
 */
export function parseComboResponse(text: string): ComboResult {
  return readComboResponse(text).value
}

/** `parseComboResponse`, reporting the ladder rung as well. */
export function readComboResponse(text: string): ReadResponse<ComboResult> {
  const parsed = parseCardList<{ combos: Combo }>(text, {
    lists: { combos: { entry: comboEntry, required: true } },
    onFailure: 'throw',
  })
  return { value: { combos: parsed.lists.combos }, rung: parsed.rung ?? 1 }
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
 * Whole-word land tests over a Scryfall `type_line`. `includes('land')` would
 * also fire on "island", the subtype every blue basic and dual carries.
 */
export function isBasicLandTypeLine(typeLine: string): boolean {
  const type = typeLine.toLowerCase()
  return /\bbasic\b/.test(type) && /\bland\b/.test(type)
}

export function isLandTypeLine(typeLine: string): boolean {
  return /\bland\b/.test(typeLine.toLowerCase())
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
  const typeLineOf = (name: string) => cardTypes[name] ?? ''
  const isBasic = (name: string) => BASIC_LAND_NAMES.has(name) || isBasicLandTypeLine(typeLineOf(name))
  const isLand = (name: string) => isBasic(name) || isLandTypeLine(typeLineOf(name))
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
