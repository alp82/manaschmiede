/**
 * The one place that says what a deck is: exactly 60 cards, at most four
 * copies of anything that isn't a basic land, the two ways an oversized deck
 * gets cut back down, and the shape it aims for - land count and mana curve.
 *
 * Before issue #28 these rules were written six times - once in the server's
 * `enforceDeckSize`, again in the client's `enforceDeltaSize`, again in each
 * of the two `fillLands` helpers, and as bare `60`s in the wizard and the deck
 * route - so which deck you got depended on which path produced it.
 *
 * Zero runtime imports (`convex/lib/basicLands.ts` is the only import, and it
 * is dependency-free too), so both trees reach this module the same way they
 * reach `cardFilters.ts` and the node suite stays offline.
 *
 * **`enforceDeck` never looks inside a key.** The server works in card names,
 * the client in Scryfall ids, so it takes opaque strings and the caller
 * supplies the predicates (`isBasic`, `isLand`) and the colour -> key map
 * (`basicForColor`). That is what keeps this file free of Scryfall knowledge.
 * `clampCopies` is the one name-keyed helper here, for the response parsers
 * that only ever see names.
 */
import { isBasicLandName } from './basicLands'

/**
 * The size of a deck. A target, not a floor - Manaschmiede builds 60-card
 * casual decks and nothing else, so a legal deck here is EXACTLY 60 maindeck
 * cards (see docs/adr/0001-60-card-casual-only.md).
 */
export const TARGET_DECK_SIZE = 60

/** Maximum copies of any one non-basic card in a deck. */
export const MAX_COPIES = 4

/**
 * Apply the 4-copy rule to one entry. Basic lands are exempt - a deck runs as
 * many Mountains as it likes.
 */
function capCopies(quantity: number, isBasic: boolean): number {
  return isBasic ? quantity : Math.min(quantity, MAX_COPIES)
}

/** The 4-copy rule keyed by card name, for the parsers that only see names. */
export function clampCopies(name: string, quantity: number): number {
  return capCopies(quantity, isBasicLandName(name))
}

/** One deck entry as the rules see it: an opaque key and a copy count. */
export interface DeckRuleEntry {
  key: string
  quantity: number
}

/** Sum the copies in a deck. */
export function totalCopies(entries: readonly DeckRuleEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0)
}

/**
 * Spread `total` across `slots` as evenly as whole numbers allow, giving the
 * remainder to the leading slots. Slots that would get nothing are dropped.
 *
 * This is the one pad formula in the app: land auto-fill, section fill, and
 * both size enforcers all split a deficit this way, and the numbers are
 * asserted in three tests apiece on either side.
 */
export function splitEvenly<T>(
  total: number,
  slots: readonly T[],
): Array<{ slot: T; quantity: number }> {
  if (total <= 0 || slots.length === 0) return []

  const per = Math.floor(total / slots.length)
  const remainder = total % slots.length

  const split: Array<{ slot: T; quantity: number }> = []
  for (let i = 0; i < slots.length; i++) {
    const quantity = per + (i < remainder ? 1 : 0)
    if (quantity > 0) split.push({ slot: slots[i], quantity })
  }
  return split
}

/** Colour letter used to pad a deck that declares no colour of its own. */
const FALLBACK_COLOR = 'G'

/**
 * Resolve W/U/B/R/G letters to the pad keys an undersized deck grows by, in
 * the order given and with repeats collapsed. Letters that name no basic land
 * (colorless, or anything unexpected) are dropped, and a list that resolves to
 * nothing falls back to green so the deck still reaches 60.
 */
export function padKeysForColors(
  colors: readonly string[],
  basicForColor: (color: string) => string | undefined,
): string[] {
  const keys: string[] = []
  for (const color of colors) {
    const key = basicForColor(color.toUpperCase())
    if (key !== undefined && !keys.includes(key)) keys.push(key)
  }
  if (keys.length > 0) return keys

  const fallback = basicForColor(FALLBACK_COLOR)
  return fallback === undefined ? [] : [fallback]
}

/**
 * How this deck came to be, which is what decides the trim order. Named for
 * the situation rather than the mechanic, because the reason is the whole
 * point - see docs/adr/0002-two-trim-policies.md.
 */
export type TrimPolicy = 'rebuild' | 'delta'

export interface EnforceDeckOptions {
  /** How this deck came to be. Decides trim order and whether copies are clamped. */
  trimPolicy: TrimPolicy
  /** True when the key is a basic land, which is exempt from the 4-copy rule. */
  isBasic: (key: string) => boolean
  /** True when the key is any land. Defaults to `isBasic`. */
  isLand?: (key: string) => boolean
  /** Keys the enforcer may not remove, in whatever key the caller works in. */
  locked?: ReadonlySet<string>
  /**
   * The quantity a locked key keeps. Defaults to the quantity it already has,
   * which means "never touched"; the server passes the pinned count instead so
   * a locked 4-of can come back to a locked 2-of as a last resort.
   */
  lockedFloor?: (key: string) => number
  /** Deck colours as W/U/B/R/G letters. Picks the basics an undersized deck grows by. */
  colors?: readonly string[]
  /** Colour letter -> the key of the basic land that produces it. */
  basicForColor: (color: string) => string | undefined
}

/** One row of the trim plan. `initialQuantity` is the count before any trimming. */
interface TrimRow {
  index: number
  key: string
  initialQuantity: number
  locked: boolean
  priority: number
}

/**
 * One sweep of the trim plan: which rows it may take copies from, how far down
 * it will take each, and the order it works in (most expendable first).
 */
interface TrimStep {
  includes: (row: TrimRow) => boolean
  floor: (row: TrimRow) => number
  order: (a: TrimRow, b: TrimRow) => number
}

/** What a policy needs to know about the deck it is cutting. */
interface PolicyContext {
  isBasic: (key: string) => boolean
  isLand: (key: string) => boolean
  /** The row's count right now, which moves as earlier sweeps take copies. */
  quantityAt: (row: TrimRow) => number
  /** How far down a locked row may come. */
  lockedFloor: (row: TrimRow) => number
}

/**
 * Everything one policy decides, gathered in one record so a third policy
 * can't be added to the trim order and forgotten at the clamp.
 */
interface TrimPolicySpec {
  /** True when the copies came from the model and get the 4-copy rule on the way in. */
  clampsCopies: boolean
  /** Lower ranks give way first. Both policies keep locked rows for last. */
  rank: (key: string, locked: boolean, ctx: PolicyContext) => number
  /** The sweeps, in order. */
  steps: (ctx: PolicyContext) => TrimStep[]
}

const TRIM_POLICIES: Record<TrimPolicy, TrimPolicySpec> = {
  /**
   * The model returned a whole deck, so the untrusted copy counts are capped on
   * the way in. Then shrink every stack to its floor - spells before lands,
   * biggest stacks first, so a 4-of drops to a 3-of before a 1-of disappears -
   * and delete whole entries in the mirror order, smallest and latest-listed
   * first, so the playset the model asked for outlives a random singleton.
   */
  rebuild: {
    clampsCopies: true,
    rank: (key, locked, ctx) => (locked ? 2 : ctx.isLand(key) ? 1 : 0),
    steps: (ctx) => [
      {
        includes: () => true,
        floor: (row) => (row.locked ? ctx.lockedFloor(row) : 1),
        order: (a, b) => a.priority - b.priority || b.initialQuantity - a.initialQuantity,
      },
      {
        includes: (row) => !row.locked,
        floor: () => 0,
        order: (a, b) =>
          a.priority - b.priority || ctx.quantityAt(a) - ctx.quantityAt(b) || b.index - a.index,
      },
    ],
  },

  /**
   * The user asked for one targeted edit, so their own copy counts stand as
   * they are - the add sites already cap them. Shed basic land copies from the
   * end of the deck, then any unlocked card from the end: a Forest goes before
   * a spell they never mentioned.
   */
  delta: {
    clampsCopies: false,
    rank: (key, locked, ctx) => (locked ? 2 : ctx.isBasic(key) ? 0 : 1),
    steps: (ctx) => {
      const fromTheEnd = (a: TrimRow, b: TrimRow) => b.index - a.index
      return [
        {
          includes: (row) => !row.locked && ctx.isBasic(row.key),
          floor: () => 0,
          order: fromTheEnd,
        },
        { includes: (row) => !row.locked, floor: () => 0, order: fromTheEnd },
      ]
    },
  },
}

const EMPTY_KEYS: ReadonlySet<string> = new Set()

/**
 * Force a deck to exactly TARGET_DECK_SIZE cards.
 *
 * Duplicate keys merge, an oversized deck is trimmed by the policy's rules,
 * and an undersized one grows basic lands split across `colors`. Returns a new
 * list - the entries passed in are never mutated - with zero-quantity entries
 * dropped, original order kept, and any newly added basics appended.
 *
 * The one deck this returns oversized is one that is 61+ cards of locked
 * entries: a locked card is never deleted outright.
 */
export function enforceDeck(
  entries: readonly DeckRuleEntry[],
  options: EnforceDeckOptions,
): DeckRuleEntry[] {
  const { trimPolicy, isBasic, basicForColor } = options
  const isLand = options.isLand ?? isBasic
  const locked = options.locked ?? EMPTY_KEYS
  const policy = TRIM_POLICIES[trimPolicy]

  // Merge duplicate keys. The model lists the same card twice often enough
  // that a deck can be off by a playset without it.
  const cards: DeckRuleEntry[] = []
  const indexByKey = new Map<string, number>()
  for (const entry of entries) {
    const index = indexByKey.get(entry.key)
    if (index === undefined) {
      indexByKey.set(entry.key, cards.length)
      cards.push({ key: entry.key, quantity: entry.quantity })
    } else {
      cards[index].quantity += entry.quantity
    }
  }

  if (policy.clampsCopies) {
    for (const card of cards) {
      card.quantity = Math.max(capCopies(card.quantity, isBasic(card.key)), 1)
    }
  }

  let total = totalCopies(cards)

  if (total > TARGET_DECK_SIZE) {
    const ctx: PolicyContext = {
      isBasic,
      isLand,
      quantityAt: (row) => cards[row.index].quantity,
      lockedFloor: (row) => options.lockedFloor?.(row.key) ?? row.initialQuantity,
    }

    const rows: TrimRow[] = cards.map((card, index) => {
      const isLocked = locked.has(card.key)
      return {
        index,
        key: card.key,
        initialQuantity: card.quantity,
        locked: isLocked,
        priority: policy.rank(card.key, isLocked, ctx),
      }
    })

    let excess = total - TARGET_DECK_SIZE
    for (const step of policy.steps(ctx)) {
      if (excess <= 0) break
      const candidates = rows.filter(step.includes).sort(step.order)
      for (const row of candidates) {
        if (excess <= 0) break
        const card = cards[row.index]
        const removable = Math.min(card.quantity - step.floor(row), excess)
        if (removable > 0) {
          card.quantity -= removable
          excess -= removable
        }
      }
    }

    total = totalCopies(cards)
  }

  if (total < TARGET_DECK_SIZE) {
    const padKeys = padKeysForColors(options.colors ?? [], basicForColor)
    for (const { slot, quantity } of splitEvenly(TARGET_DECK_SIZE - total, padKeys)) {
      const index = indexByKey.get(slot)
      if (index === undefined) {
        indexByKey.set(slot, cards.length)
        cards.push({ key: slot, quantity })
      } else {
        cards[index].quantity += quantity
      }
    }
  }

  return cards.filter((card) => card.quantity > 0)
}

// ─── Deck shape: the curve half of "decks are balanced" ─────────────────────
//
// Before issue #45 the curve was written three times and enforced nowhere: as
// prose in `generateDeck.ts`'s SYSTEM_PROMPT, as reporting thresholds in
// `src/lib/balance.ts`, and as an independent per-archetype land table plus a
// bare floor of 18 in `src/lib/section-plan.ts`. Only the last one ever changed
// an outcome, and none of the three referenced the others.
//
// The rule set is declared once here and adapted three ways in this file, the
// way `cardFilters.ts` adapts the hard filter - prose for the model, predicates
// for the balance report, a land target for the section plan. See
// docs/adr/0005-land-count-planned-curve-advised.md for why the land count is
// planned and the mana curve is only advised.

/**
 * The land count a 60-card casual deck lives inside. Every archetype target
 * sits in this band, and the section plan can never allocate outside it.
 */
export const LAND_COUNT_RANGE = { min: 22, max: 26 } as const

/**
 * The non-land count that follows from the land band, since a deck is exactly
 * TARGET_DECK_SIZE cards. Derived rather than written down, so the two halves
 * of the same statement cannot disagree.
 */
export const SPELL_COUNT_RANGE = {
  min: TARGET_DECK_SIZE - LAND_COUNT_RANGE.max,
  max: TARGET_DECK_SIZE - LAND_COUNT_RANGE.min,
} as const

/**
 * The average mana value of a deck's non-land cards, above which the deck plays
 * too slowly for casual. Advice, not enforcement: bringing a curve down means
 * swapping specific cards for cheaper ones that do the same job, which no
 * mechanical rule can do without gutting the deck's payoffs.
 */
export const MAX_AVERAGE_MANA_VALUE = 3.5

/** Land count when no archetype matches. */
export const DEFAULT_LAND_COUNT = 24

/**
 * Lands each archetype aims for, counting every land in the deck - the fixing
 * lands a multicolour plan gets as well as the basics. Faster archetypes want
 * fewer lands and more early plays; grindier ones want to hit every land drop.
 *
 * Keyed by the archetype ids in `src/lib/section-plan.ts`. An id that is absent
 * takes DEFAULT_LAND_COUNT, so adding an archetype is not a breaking change.
 */
export const ARCHETYPE_LAND_COUNT: Readonly<Record<string, number>> = {
  aggro: 22,
  burn: 22,
  sacrifice: 22,
  midrange: 24,
  combo: 24,
  tribal: 24,
  ramp: 24,
  tokens: 24,
  voltron: 24,
  mill: 24,
  lifegain: 24,
  reanimator: 24,
  drain: 25,
  goodstuff: 25,
  control: 26,
}

/** Adapter for the section plan: how many lands this archetype's plan reserves. */
export function landCountForArchetype(archetype: string | undefined): number {
  if (archetype === undefined) return DEFAULT_LAND_COUNT
  return ARCHETYPE_LAND_COUNT[archetype] ?? DEFAULT_LAND_COUNT
}

/**
 * The most of a deck's land target that may go to fixing lands. Held well
 * below LAND_COUNT_RANGE.min so a five-colour deck still has room for basics.
 */
const MAX_FIXING_LANDS = 8

/**
 * Adapter for the section plan: how many of the archetype's lands are fixing
 * lands rather than basics.
 *
 * Zero for a mono-colour deck, which has nothing to fix, then two more per
 * extra colour so a five-colour deck gets meaningfully more fixing than a
 * two-colour one. These lands come out of the land target, not the spell slots
 * - that is what lets `landCountForArchetype` mean every land in the deck.
 */
export function fixingLandCountForColors(colorCount: number): number {
  if (colorCount < 2) return 0
  return Math.min(colorCount * 2 - 2, MAX_FIXING_LANDS)
}

/** Where a deck's land count falls relative to the band. */
export type LandCountVerdict = 'ok' | 'too-few' | 'too-many'

/** Adapter for the balance report: judge a finished deck's land count. */
export function checkLandCount(landCount: number): LandCountVerdict {
  if (landCount < LAND_COUNT_RANGE.min) return 'too-few'
  if (landCount > LAND_COUNT_RANGE.max) return 'too-many'
  return 'ok'
}

/** Adapter for the balance report: judge a finished deck's curve. */
export function isAverageManaValueTooHigh(averageManaValue: number): boolean {
  return averageManaValue > MAX_AVERAGE_MANA_VALUE
}

/**
 * Render the archetype table as `22 for aggro, burn, sacrifice; 24 for ...`,
 * so the prompt and the plan can never name different numbers. Archetypes the
 * table doesn't list join the default's group as "any other archetype".
 */
function describeArchetypeLandCounts(): string {
  const byCount = new Map<number, string[]>()
  for (const archetype of Object.keys(ARCHETYPE_LAND_COUNT).sort()) {
    const count = ARCHETYPE_LAND_COUNT[archetype]
    const named = byCount.get(count)
    if (named === undefined) byCount.set(count, [archetype])
    else named.push(archetype)
  }

  const defaultGroup = byCount.get(DEFAULT_LAND_COUNT)
  if (defaultGroup === undefined) byCount.set(DEFAULT_LAND_COUNT, ['any other archetype'])
  else defaultGroup.push('any other archetype')

  return Array.from(byCount.entries())
    .sort(([a], [b]) => a - b)
    .map(([count, named]) => `${count} for ${named.join(', ')}`)
    .join('; ')
}

/**
 * Adapter for the model: the same rule set as prose, for the deck-generation
 * system prompt. Generated from the table so the prompt cannot drift from it.
 */
export const DECK_SHAPE_PROMPT_RULES = `- Include ${LAND_COUNT_RANGE.min}-${LAND_COUNT_RANGE.max} lands, counting fixing lands as well as basics (${describeArchetypeLandCounts()})
- Keep the average mana value of the non-land cards at or below ${MAX_AVERAGE_MANA_VALUE}
- Land base must support all colors proportionally
- For 3+ colors, include mana-fixing artifacts`
