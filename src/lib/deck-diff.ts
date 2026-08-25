/**
 * Pure deck-delta helpers (zero React, zero network).
 *
 * These back the single-card delta-edit path: the model returns a small set of
 * cards to add/remove, the client resolves them to Scryfall data, and these
 * functions apply the delta, enforce the 60-card invariant, and diff the result
 * against the current deck for the change ledger.
 *
 * Kept side-effect free so they are unit-testable without a DOM or fetch and so
 * the delta arm of useDeckChat stays thin.
 */
import type { DeckCard } from './deck-utils'
import { MAX_COPIES, enforceDeck, type TrimPolicy } from '../../convex/lib/deckRules'
import type { ScryfallCard } from './scryfall/types'
import { getCardName } from './scryfall/types'
import type { CardChange } from './deck-chat-types'
import { BASIC_LAND_ID_BY_COLOR, isBasicLandId } from '../../convex/lib/basicLands'


/**
 * Diff the current deck against a resolved deck map, producing the change
 * ledger. Ported verbatim in behavior from the inline diff in useDeckChat.
 *
 * - Added: in resolvedMap, absent from current (oldQty 0).
 * - Changed: in both, different quantity.
 * - Removed: in current, absent from resolvedMap (newQty 0).
 * Added/changed names come from the resolvedMap card via getCardName; removed
 * names come from cardDataMap (falling back to the bare scryfallId). No-ops
 * (same quantity) are filtered out.
 */
export function computeDeckDiff(
  currentCards: DeckCard[],
  resolvedMap: Map<string, { card: ScryfallCard; quantity: number }>,
  cardDataMap: Map<string, ScryfallCard>,
): CardChange[] {
  const currentMap = new Map<string, number>()
  for (const c of currentCards.filter((c) => c.zone === 'main')) {
    currentMap.set(c.scryfallId, c.quantity)
  }

  const changes: CardChange[] = []

  // Added or changed cards.
  for (const [sid, { card, quantity }] of resolvedMap) {
    const oldQty = currentMap.get(sid) || 0
    if (oldQty === 0) {
      changes.push({
        name: getCardName(card),
        scryfallId: sid,
        scryfallCard: card,
        type: 'added',
        oldQuantity: 0,
        newQuantity: quantity,
      })
    } else if (quantity !== oldQty) {
      changes.push({
        name: getCardName(card),
        scryfallId: sid,
        scryfallCard: card,
        type: 'changed',
        oldQuantity: oldQty,
        newQuantity: quantity,
      })
    }
  }

  // Removed cards.
  for (const [sid, oldQty] of currentMap) {
    if (!resolvedMap.has(sid)) {
      const data = cardDataMap.get(sid)
      changes.push({
        name: data ? getCardName(data) : sid,
        scryfallId: sid,
        scryfallCard: data,
        type: 'removed',
        oldQuantity: oldQty,
        newQuantity: 0,
      })
    }
  }

  return changes.filter((c) => c.oldQuantity !== c.newQuantity)
}

/**
 * Apply a resolved delta to the current deck. PURE: removes every copy of each
 * id in removeIds, merges each addCard at its quantity (4-copy cap for
 * non-basics, no cap when isBasicLand), and copies untouched cards through at
 * their current quantity.
 *
 * Does NOT trim/pad to 60 (the caller runs enforceDeltaSize) and does NOT check
 * locks (the caller pre-filters removeIds via resolveRemoveIds). Returns both
 * the resolved card list and a resolvedMap carrying ScryfallCard data for every
 * resolved id (added cards from addCards.card, kept cards from cardDataMap).
 */
export function applyDelta(
  currentCards: DeckCard[],
  removeIds: string[],
  addCards: Array<{ scryfallId: string; card: ScryfallCard; quantity: number; isBasicLand: boolean }>,
  cardDataMap: Map<string, ScryfallCard>,
): { resolvedCards: DeckCard[]; resolvedMap: Map<string, { card: ScryfallCard; quantity: number }> } {
  const removeSet = new Set(removeIds)

  // Untouched cards copied through at the same quantity.
  const resolvedCards: DeckCard[] = currentCards
    .filter((c) => !removeSet.has(c.scryfallId))
    .map((c) => ({ ...c }))

  // Merge each addCard, respecting the 4-copy cap for non-basics.
  for (const add of addCards) {
    if (add.quantity <= 0) continue
    const cap = add.isBasicLand ? Infinity : MAX_COPIES
    const idx = resolvedCards.findIndex((c) => c.scryfallId === add.scryfallId)
    if (idx >= 0) {
      const newQty = Math.min(resolvedCards[idx].quantity + add.quantity, cap)
      resolvedCards[idx] = { ...resolvedCards[idx], quantity: newQty }
    } else {
      const qty = Math.min(add.quantity, cap)
      resolvedCards.push({ scryfallId: add.scryfallId, quantity: qty, zone: 'main' })
    }
  }

  // Build the resolvedMap: card data from addCards for added ids, cardDataMap
  // for kept ids. Entries without resolvable card data are omitted from the map
  // (computeDeckDiff falls back to the scryfallId for those).
  const addCardById = new Map<string, ScryfallCard>()
  for (const add of addCards) addCardById.set(add.scryfallId, add.card)

  const resolvedMap = new Map<string, { card: ScryfallCard; quantity: number }>()
  for (const c of resolvedCards) {
    const card = addCardById.get(c.scryfallId) ?? cardDataMap.get(c.scryfallId)
    if (card) resolvedMap.set(c.scryfallId, { card, quantity: c.quantity })
  }

  return { resolvedCards, resolvedMap }
}

/**
 * Map English card names from the model response to deck scryfallIds. Returns
 * EVERY deck id whose card matches the name by English identity - either
 * `card.name` (the combined "Front // Back" form for DFC/split) or any
 * `card.card_faces[].name` (single-face fallback). Unknown names contribute
 * nothing (no off-60 drift). Any id in lockedCardIds is excluded - the hard
 * backstop that keeps a pinned card from being cut.
 */
export function resolveRemoveIds(
  removeNames: Array<{ name: string }>,
  currentCards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
  lockedCardIds: Set<string>,
): string[] {
  const wanted = new Set(removeNames.map((r) => r.name))
  const ids: string[] = []

  for (const dc of currentCards) {
    if (lockedCardIds.has(dc.scryfallId)) continue
    const card = cardDataMap.get(dc.scryfallId)
    if (!card) continue
    const matches =
      wanted.has(card.name) ||
      (card.card_faces?.some((f) => wanted.has(f.name)) ?? false)
    if (matches) ids.push(dc.scryfallId)
  }

  return ids
}

export interface EnforceDeckCardsOptions {
  /** How this deck came to be. Decides the trim order - see `TrimPolicy`. */
  trimPolicy: TrimPolicy
  /** Deck colours as W/U/B/R/G letters. Picks the basics an undersized deck grows by. */
  colors: string[]
  /** Ids the enforcer may not touch, on top of each card's own `locked` flag. */
  lockedIds?: ReadonlySet<string>
  /** True when the id is any land. Defaults to "basic land only". */
  isLand?: (id: string) => boolean
}

/**
 * Force a deck to EXACTLY 60 cards.
 *
 * The Scryfall-id adapter for `enforceDeck` (issue #28): the split formula, the
 * 4-copy rule, and both trim orders live in `convex/lib/deckRules.ts` and are
 * shared with the server. This function supplies the id predicates and puts
 * `zone` and `locked` back on the entries the rules hand out.
 *
 * Any trim or pad is surfaced downstream by computeDeckDiff (current -> final),
 * so there is no special return channel - just the 60-card list.
 */
export function enforceDeckCards(
  cards: DeckCard[],
  options: EnforceDeckCardsOptions,
): DeckCard[] {
  const byId = new Map(cards.map((c) => [c.scryfallId, c]))
  const locked = new Set(cards.filter((c) => c.locked).map((c) => c.scryfallId))
  for (const id of options.lockedIds ?? []) locked.add(id)

  const sized = enforceDeck(
    cards.map((c) => ({ key: c.scryfallId, quantity: c.quantity })),
    {
      trimPolicy: options.trimPolicy,
      isBasic: isBasicLandId,
      isLand: options.isLand,
      colors: options.colors,
      basicForColor: (color) => BASIC_LAND_ID_BY_COLOR[color],
      locked,
    },
  )

  return sized.map(({ key, quantity }) => {
    const existing = byId.get(key)
    return existing ? { ...existing, quantity } : { scryfallId: key, quantity, zone: 'main' }
  })
}

/**
 * Force a resolved delta to EXACTLY 60 cards: shed basic land copies before
 * anything the user did not mention, pad with basics across `colors`. The
 * delta arm's one-liner over `enforceDeckCards`.
 */
export function enforceDeltaSize(cards: DeckCard[], colors: string[]): DeckCard[] {
  return enforceDeckCards(cards, { trimPolicy: 'delta', colors })
}
