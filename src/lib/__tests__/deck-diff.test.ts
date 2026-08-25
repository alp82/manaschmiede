/**
 * Contracts asserted for the four functions in src/lib/deck-diff.ts.
 *
 * Since issue #28 the two size enforcers are thin adapters over
 * `enforceDeck` in convex/lib/deckRules.ts, which owns the trim orders and the
 * pad split and is tested in opaque keys by convex/__tests__/deck-rules.test.ts.
 * What is asserted HERE is what the adapters add: the Scryfall-id predicates,
 * the lock sources, and carrying `zone` / `locked` back onto the rows.
 *
 * Asserted contracts:
 *
 * enforceDeckCards(cards, { trimPolicy, colors, lockedIds?, isLand? }): DeckCard[]
 *   - Returns EXACTLY 60 cards, trimmed or padded per the policy.
 *   - Locks come from BOTH each card's own `locked` flag and `lockedIds`.
 *   - `zone` and `locked` survive onto the returned rows.
 *
 * computeDeckDiff(currentCards, resolvedMap, cardDataMap): CardChange[]
 *   - Mirrors the inline diff block in useDeckChat.ts ~461-512 exactly.
 *   - Iterates resolvedMap for added/changed cards (keyed by scryfallId).
 *   - Iterates currentMap for removed cards (not present in resolvedMap).
 *   - Filters no-ops (oldQuantity === newQuantity).
 *   - Card name resolved via getCardName(card) from resolvedMap; falls back
 *     to getCardName(cardDataMap entry) or bare scryfallId for removed cards.
 *
 * applyDelta(
 *   currentCards: DeckCard[],
 *   removeIds: string[],
 *   addCards: Array<{ scryfallId: string; card: ScryfallCard; quantity: number; isBasicLand: boolean }>,
 *   cardDataMap: Map<string, ScryfallCard>
 * ): { resolvedCards: DeckCard[]; resolvedMap: Map<string, { card: ScryfallCard; quantity: number }> }
 *   - PURE function — no `op` param, no network calls.
 *   - Removes ALL copies of each id in removeIds.
 *   - Adds/merges each addCard at its quantity; respects 4-copy cap for non-lands (via isBasicLand flag).
 *   - Untouched cards are copied through; their ScryfallCard data for resolvedMap comes from cardDataMap.
 *   - Does NOT pad or trim to 60 — the caller is responsible for that.
 *   - lockedCardIds protection is the caller's responsibility (caller pre-filters
 *     removeIds before passing to applyDelta). applyDelta executes removeIds
 *     mechanically — it does not check locks internally. Tests document this seam.
 *   - resolvedMap value shape: { card: ScryfallCard; quantity: number } — same shape
 *     as computeDeckDiff's input resolvedMap (unified shape, matches useDeckChat.ts:470-491).
 *
 * resolveRemoveIds(
 *   removeNames: Array<{ name: string }>,
 *   currentCards: DeckCard[],
 *   cardDataMap: Map<string, ScryfallCard>,
 *   lockedCardIds: Set<string>
 * ): string[]
 *   - Maps English card names from the model response to deck scryfallIds.
 *   - Returns EVERY matching deck scryfallId for a given name (all printings).
 *   - Unknown names (no deck card matches) -> omitted from result (no off-60 drift).
 *   - Hard backstop: any id in lockedCardIds is excluded from the result.
 *   - DFC/split: matches against card.name (combined "Front // Back") OR any card_faces[].name.
 *
 * enforceDeltaSize(resolvedCards, colors): DeckCard[]
 *   - Returns EXACTLY 60 cards — return type is DeckCard[] (not widened).
 *   - Trims (add-one: decrement one basic land copy) or pads (remove-one: add basic lands by color).
 *   - swap case: already 60 -> returned as-is (60).
 *   - add-one with land: 61 cards containing a basic land -> trims one basic land copy -> 60.
 *   - add-one without land: 61 cards with ZERO basic lands -> trims a deterministic non-locked card
 *     (implementer rule: reduce the last non-locked, non-just-added card) -> 60.
 *   - remove-one case: 59 cards -> pads with one basic land -> 60.
 *   - remove-N case: 57 cards -> pads with 3 basic land copies -> 60.
 *   - The "surface a visible removed-change" requirement from AC5 is satisfied DOWNSTREAM by
 *     computeDeckDiff (which diffs current->final and surfaces whatever enforceDeltaSize trimmed
 *     as a removed row in the ledger). enforceDeltaSize itself has no special return channel for
 *     this — every trim is visible via the diff.
 *
 * NOTE on locked card protection seam:
 *   The plan states "skip any ID in lockedCardIds — hard backstop". The seam
 *   is: resolveRemoveIds owns the hard backstop (filters locked ids before producing
 *   the removeIds list). applyDelta itself has no knowledge of locks.
 *   The test "locked removeId pre-filtered by caller" documents this boundary:
 *   a locked id that is NOT pre-filtered will be removed (expected behavior for
 *   the pure function), and it is the caller's responsibility to prevent that.
 */
import { describe, it, expect } from 'vitest'
import {
  computeDeckDiff,
  applyDelta,
  resolveRemoveIds,
  enforceDeckCards,
  enforceDeltaSize,
} from '../deck-diff'
import type { DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import type { CardChange } from '../deck-chat-types'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal ScryfallCard stub */
function makeCard(id: string, name: string, typeLine = 'Creature'): ScryfallCard {
  return {
    id,
    name,
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line: typeLine,
    oracle_text: '',
    color_identity: ['G'],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

function makeLandCard(id: string, name: string): ScryfallCard {
  return makeCard(id, name, 'Basic Land — Forest')
}

/** Minimal DeckCard stub (main zone by default) */
function makeDeckCard(
  scryfallId: string,
  quantity: number,
  zone: DeckCard['zone'] = 'main',
): DeckCard {
  return { scryfallId, quantity, zone }
}

/** Build a resolvedMap from an array of {card, quantity} pairs */
function makeResolvedMap(
  entries: Array<{ card: ScryfallCard; quantity: number }>,
): Map<string, { card: ScryfallCard; quantity: number }> {
  const m = new Map<string, { card: ScryfallCard; quantity: number }>()
  for (const e of entries) m.set(e.card.id, { card: e.card, quantity: e.quantity })
  return m
}

// ─── computeDeckDiff ──────────────────────────────────────────────────────────

describe('computeDeckDiff', () => {
  it('TC-DD-01: card added (in resolved, not in current) -> one "added" entry, oldQty 0, newQty N', () => {
    const current: DeckCard[] = []
    const cardNew = makeCard('card-new', 'Llanowar Elves')
    const resolvedMap = makeResolvedMap([{ card: cardNew, quantity: 4 }])
    const cardDataMap = new Map<string, ScryfallCard>()

    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('added')
    expect(changes[0].scryfallId).toBe('card-new')
    expect(changes[0].oldQuantity).toBe(0)
    expect(changes[0].newQuantity).toBe(4)
    expect(changes[0].name).toBe('Llanowar Elves')
  })

  it('TC-DD-02: card removed (in current, not in resolved) -> one "removed" entry, newQty 0', () => {
    const current = [makeDeckCard('old-card', 3)]
    const cardOld = makeCard('old-card', 'Craw Wurm')
    const resolvedMap = makeResolvedMap([])
    const cardDataMap = new Map<string, ScryfallCard>([['old-card', cardOld]])

    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('removed')
    expect(changes[0].scryfallId).toBe('old-card')
    expect(changes[0].oldQuantity).toBe(3)
    expect(changes[0].newQuantity).toBe(0)
    expect(changes[0].name).toBe('Craw Wurm')
  })

  it('TC-DD-03: quantity changed (same id, different qty) -> one "changed" entry with old/new', () => {
    const current = [makeDeckCard('bolt', 4)]
    const cardBolt = makeCard('bolt', 'Lightning Bolt', 'Instant')
    const resolvedMap = makeResolvedMap([{ card: cardBolt, quantity: 2 }])
    const cardDataMap = new Map<string, ScryfallCard>()

    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('changed')
    expect(changes[0].oldQuantity).toBe(4)
    expect(changes[0].newQuantity).toBe(2)
  })

  it('TC-DD-04: no-op (same id, same qty) -> filtered, no entry returned', () => {
    const current = [makeDeckCard('bolt', 4)]
    const cardBolt = makeCard('bolt', 'Lightning Bolt', 'Instant')
    const resolvedMap = makeResolvedMap([{ card: cardBolt, quantity: 4 }])
    const cardDataMap = new Map<string, ScryfallCard>()

    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    expect(changes).toHaveLength(0)
  })

  it('TC-DD-05: 1-for-1 swap inside a 15-entry / 60-card deck -> exactly 2 changes (one removed + one added)', () => {
    // Build a 60-card deck: 14 unchanged cards (4 copies each) + the card being removed (4 copies)
    const unchanged: Array<{ id: string; name: string }> = Array.from({ length: 14 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
    }))

    const current: DeckCard[] = [
      ...unchanged.map((c) => makeDeckCard(c.id, 4)),
      makeDeckCard('old-id', 4),
    ]

    // resolvedMap: same 14 unchanged + new card replacing old-id
    const newCard = makeCard('new-id', 'Shock', 'Instant')
    const resolvedEntries: Array<{ card: ScryfallCard; quantity: number }> = [
      ...unchanged.map((c) => ({ card: makeCard(c.id, c.name), quantity: 4 })),
      { card: newCard, quantity: 4 },
    ]
    const resolvedMap = makeResolvedMap(resolvedEntries)

    const cardDataMap = new Map<string, ScryfallCard>([
      ['old-id', makeCard('old-id', 'Lightning Bolt', 'Instant')],
    ])

    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    // Exactly 2 changes: one removed (old-id), one added (new-id)
    expect(changes).toHaveLength(2)
    const types = changes.map((c) => c.type).sort()
    expect(types).toEqual(['added', 'removed'])
  })

  it('TC-DD-06: removed card name from cardDataMap; falls back to scryfallId when absent (no crash)', () => {
    const current = [makeDeckCard('unknown-id', 2)]
    const resolvedMap = makeResolvedMap([])
    // cardDataMap does NOT have 'unknown-id'
    const cardDataMap = new Map<string, ScryfallCard>()

    // Must not throw
    expect(() => computeDeckDiff(current, resolvedMap, cardDataMap)).not.toThrow()
    const changes = computeDeckDiff(current, resolvedMap, cardDataMap)

    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('removed')
    // Name falls back to scryfallId when card data is absent
    expect(changes[0].name).toBe('unknown-id')
  })
})

// ─── applyDelta ───────────────────────────────────────────────────────────────

describe('applyDelta', () => {
  it('TC-AD-01: swap — remove "old" (qty 4) + add "new" -> no "old", has "new" at 4; total preserved (pre-trim)', () => {
    // 60-card deck: old at 4, plus 56 other cards in 14 groups of 4
    const others = Array.from({ length: 14 }, (_, i) => makeDeckCard(`other-${i}`, 4))
    const current: DeckCard[] = [...others, makeDeckCard('old-id', 4)]
    // total: 14*4 + 4 = 60

    const oldCardData = makeCard('old-id', 'Old Card')
    const newCardData = makeCard('new-id', 'New Card')
    const cardDataMap = new Map<string, ScryfallCard>([['old-id', oldCardData]])
    const addCards = [{ scryfallId: 'new-id', card: newCardData, quantity: 4, isBasicLand: false }]
    const { resolvedCards } = applyDelta(current, ['old-id'], addCards, cardDataMap)

    const total = resolvedCards.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60) // pre-trim total preserved for swap

    const oldEntry = resolvedCards.find((c) => c.scryfallId === 'old-id')
    expect(oldEntry).toBeUndefined()

    const newEntry = resolvedCards.find((c) => c.scryfallId === 'new-id')
    expect(newEntry).toBeDefined()
    expect(newEntry!.quantity).toBe(4)
  })

  it('TC-AD-02: remove qty-2 card + add "new" — deck total preserved (swap invariant)', () => {
    // 60-card deck: old at 2, plus 58 others
    const others = Array.from({ length: 14 }, (_, i) => makeDeckCard(`other-${i}`, 4))
    const extra = makeDeckCard('extra', 2)
    const current: DeckCard[] = [...others, extra, makeDeckCard('old-id', 2)]
    // total: 14*4 + 2 + 2 = 60

    // Caller provides quantity 2 for the new card (matching the removed qty)
    const newCardData = makeCard('new-id', 'New Card')
    const cardDataMap = new Map<string, ScryfallCard>()
    const addCards = [{ scryfallId: 'new-id', card: newCardData, quantity: 2, isBasicLand: false }]
    const { resolvedCards } = applyDelta(current, ['old-id'], addCards, cardDataMap)

    const total = resolvedCards.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60) // 60 - 2 (removed) + 2 (added) = 60
  })

  it('TC-AD-03: removeId NOT in deck -> no throw; that id removes nothing; rest of deck unchanged', () => {
    const current = [makeDeckCard('bolt', 4), makeDeckCard('island', 10)]
    const cardDataMap = new Map<string, ScryfallCard>([
      ['bolt', makeCard('bolt', 'Lightning Bolt')],
      ['island', makeCard('island', 'Island')],
    ])

    expect(() => applyDelta(current, ['non-existent-id'], [], cardDataMap)).not.toThrow()

    const { resolvedCards } = applyDelta(current, ['non-existent-id'], [], cardDataMap)
    const total = resolvedCards.reduce((s, c) => s + c.quantity, 0)
    // Total should be unchanged (no phantom removal)
    expect(total).toBe(14)
    expect(resolvedCards.find((c) => c.scryfallId === 'bolt')).toBeDefined()
    expect(resolvedCards.find((c) => c.scryfallId === 'island')).toBeDefined()
  })

  it('TC-AD-04: removeId is a basic land -> applyDelta executes it (basic-land protection is caller concern)', () => {
    // applyDelta is PURE and does not distinguish basic lands.
    // The caller is responsible for filtering basic land ids from removeIds if desired.
    const plainId = '4be96696-aff8-4ef9-97dc-8221ef745de9' // Plains (M21)
    const current = [makeDeckCard(plainId, 20), makeDeckCard('bolt', 4)]
    const cardDataMap = new Map<string, ScryfallCard>([
      [plainId, makeCard(plainId, 'Plains', 'Basic Land — Plains')],
      ['bolt', makeCard('bolt', 'Lightning Bolt')],
    ])

    const { resolvedCards } = applyDelta(current, [plainId], [], cardDataMap)

    // applyDelta removes ALL copies mechanically — the plains entry must be gone
    const plainsEntry = resolvedCards.find((c) => c.scryfallId === plainId)
    expect(plainsEntry).toBeUndefined()
    // Non-targeted cards are unaffected
    expect(resolvedCards.find((c) => c.scryfallId === 'bolt')).toBeDefined()
  })

  it('TC-AD-05: locked removeId — caller must pre-filter; applyDelta alone removes it (documents the seam)', () => {
    // The plan says: "skip any ID in lockedCardIds — hard backstop".
    // The seam: applyDelta does NOT receive or check lockedCardIds.
    // The caller is responsible for pre-filtering removeIds.
    //
    // This test shows that if a caller FAILS to pre-filter (passes a locked id),
    // applyDelta will remove it — documenting where the protection must live.
    const lockedCard = makeDeckCard('locked-id', 4)
    lockedCard.locked = true
    const current: DeckCard[] = [lockedCard, makeDeckCard('other', 4)]

    const cardDataMap = new Map<string, ScryfallCard>([
      ['locked-id', makeCard('locked-id', 'Locked Card')],
      ['other', makeCard('other', 'Other Card')],
    ])
    // Caller passes locked-id without pre-filtering — applyDelta removes it
    const { resolvedCards } = applyDelta(current, ['locked-id'], [], cardDataMap)
    const lockedEntry = resolvedCards.find((c) => c.scryfallId === 'locked-id')
    // applyDelta removes it (caller must prevent this by pre-filtering)
    expect(lockedEntry).toBeUndefined()
  })

  it('TC-AD-06: add-only -> total becomes current + addedQty (e.g. 60 -> 61), all originals present', () => {
    const current = Array.from({ length: 15 }, (_, i) => makeDeckCard(`card-${i}`, 4))
    // total: 60

    const newCardData = makeCard('new-card', 'New Card')
    const cardDataMap = new Map<string, ScryfallCard>(
      current.map((c, i) => [c.scryfallId, makeCard(c.scryfallId, `Card ${i}`)]),
    )
    const addCards = [{ scryfallId: 'new-card', card: newCardData, quantity: 1, isBasicLand: false }]
    const { resolvedCards } = applyDelta(current, [], addCards, cardDataMap)

    const total = resolvedCards.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(61) // applyDelta does NOT trim — 60 + 1 = 61

    // All original cards still present
    for (let i = 0; i < 15; i++) {
      expect(resolvedCards.find((c) => c.scryfallId === `card-${i}`)).toBeDefined()
    }
    // New card added
    expect(resolvedCards.find((c) => c.scryfallId === 'new-card')).toBeDefined()
  })

  it('TC-AD-07: remove-only -> total drops by removed copies (e.g. 60 -> 58 for a qty-2 target)', () => {
    // Deck: 14 unchanged at 4 = 56, 1 filler at 2 = 58, target at 2 = 60
    const deck60: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('filler', 2),
      makeDeckCard('target', 2),
    ]
    // total: 56 + 2 + 2 = 60

    const cardDataMap = new Map<string, ScryfallCard>([
      ...Array.from({ length: 14 }, (_, i): [string, ScryfallCard] => [`card-${i}`, makeCard(`card-${i}`, `Card ${i}`)]),
      ['filler', makeCard('filler', 'Filler Card')],
      ['target', makeCard('target', 'Target Card')],
    ])
    const { resolvedCards } = applyDelta(deck60, ['target'], [], cardDataMap)

    const total = resolvedCards.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(58) // 60 - 2 = 58; applyDelta does NOT pad

    expect(resolvedCards.find((c) => c.scryfallId === 'target')).toBeUndefined()
  })

  it('TC-AD-08: untouched cards are reference-preserved across a swap', () => {
    // Build ~59 entry deck: one entry to swap + 58 untouched at various quantities
    const untouched = Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4))
    const oldCard = makeDeckCard('old-id', 4)
    const current: DeckCard[] = [...untouched, oldCard]

    const newCardData = makeCard('new-id', 'New Card')
    const cardDataMap = new Map<string, ScryfallCard>([
      ...untouched.map((c, i): [string, ScryfallCard] => [c.scryfallId, makeCard(c.scryfallId, `Card ${i}`)]),
      ['old-id', makeCard('old-id', 'Old Card')],
    ])
    const addCards = [{ scryfallId: 'new-id', card: newCardData, quantity: 4, isBasicLand: false }]
    const { resolvedCards } = applyDelta(current, ['old-id'], addCards, cardDataMap)

    // All 14 untouched cards must appear in the result
    for (const orig of untouched) {
      const found = resolvedCards.find((c) => c.scryfallId === orig.scryfallId)
      expect(found).toBeDefined()
      expect(found!.quantity).toBe(orig.quantity)
    }
  })

  it('TC-AD-09: add respects 4-copy cap for non-land cards', () => {
    // Existing 2 copies + add 4 more -> capped at 4 (not 6)
    const current = [makeDeckCard('bolt', 2)]
    const boltCard = makeCard('bolt', 'Lightning Bolt', 'Instant')
    const cardDataMap = new Map<string, ScryfallCard>([['bolt', boltCard]])
    const addCards = [{ scryfallId: 'bolt', card: boltCard, quantity: 4, isBasicLand: false }]
    const { resolvedCards } = applyDelta(current, [], addCards, cardDataMap)

    const entry = resolvedCards.find((c) => c.scryfallId === 'bolt')
    expect(entry).toBeDefined()
    expect(entry!.quantity).toBe(4) // capped at 4
  })

  it('TC-AD-10: add basic land bypasses 4-copy cap', () => {
    const plainId = '4be96696-aff8-4ef9-97dc-8221ef745de9'
    const current = [makeDeckCard(plainId, 10)]
    const plainsCard = makeCard(plainId, 'Plains', 'Basic Land — Plains')
    const cardDataMap = new Map<string, ScryfallCard>([[plainId, plainsCard]])
    const addCards = [{ scryfallId: plainId, card: plainsCard, quantity: 8, isBasicLand: true }]
    const { resolvedCards } = applyDelta(current, [], addCards, cardDataMap)

    const entry = resolvedCards.find((c) => c.scryfallId === plainId)
    expect(entry).toBeDefined()
    expect(entry!.quantity).toBe(18) // no cap for basic lands
  })

  it('TC-AD-11: resolvedMap returned contains scryfallId -> { card, quantity } for all resolved entries', () => {
    // resolvedMap shape must be Map<string, { card: ScryfallCard; quantity: number }>
    // This is the unified shape: matches the map computeDeckDiff CONSUMES (useDeckChat.ts:470-491).
    const islandCard = makeCard('island', 'Island', 'Basic Land — Island')
    const counterspellCard = makeCard('counterspell', 'Counterspell', 'Instant')
    const boltCard = makeCard('bolt', 'Lightning Bolt', 'Instant')

    const current = [makeDeckCard('bolt', 4), makeDeckCard('island', 10)]
    const cardDataMap = new Map<string, ScryfallCard>([
      ['bolt', boltCard],
      ['island', islandCard],
    ])
    const addCards = [{ scryfallId: 'counterspell', card: counterspellCard, quantity: 4, isBasicLand: false }]
    const { resolvedCards, resolvedMap } = applyDelta(current, ['bolt'], addCards, cardDataMap)

    // resolvedMap should have entries for untouched + added (not removed)
    expect(resolvedMap.has('bolt')).toBe(false) // removed
    expect(resolvedMap.has('island')).toBe(true)
    expect(resolvedMap.has('counterspell')).toBe(true)

    // Each entry must carry BOTH .card and .quantity
    const islandEntry = resolvedMap.get('island')
    expect(islandEntry).toBeDefined()
    expect(islandEntry!.quantity).toBe(10)
    expect(islandEntry!.card).toBeDefined()
    expect(islandEntry!.card.id).toBe('island') // card.id matches the scryfallId

    const counterspellEntry = resolvedMap.get('counterspell')
    expect(counterspellEntry).toBeDefined()
    expect(counterspellEntry!.quantity).toBe(4)
    expect(counterspellEntry!.card).toBeDefined()
    expect(counterspellEntry!.card.id).toBe('counterspell')

    // resolvedMap qty must match resolvedCards qty for every resolved card
    for (const rc of resolvedCards) {
      const mapEntry = resolvedMap.get(rc.scryfallId)
      expect(mapEntry).toBeDefined()
      expect(mapEntry!.quantity).toBe(rc.quantity)
      expect(mapEntry!.card).toBeDefined() // card must be present, not just quantity
    }
  })
})

// ─── resolveRemoveIds ─────────────────────────────────────────────────────────
//
// Pure helper that maps English card names (from the model response) to deck
// scryfallIds. It owns the locked-card hard backstop.
//
// Signature:
//   resolveRemoveIds(
//     removeNames: Array<{ name: string }>,
//     currentCards: DeckCard[],
//     cardDataMap: Map<string, ScryfallCard>,
//     lockedCardIds: Set<string>
//   ): string[]

describe('resolveRemoveIds', () => {
  it('TC-RRI-01: all-copies — two distinct ids sharing one English name -> both ids returned', () => {
    // Two different printings of the same card in the deck
    const elves1 = makeCard('elves-id-1', 'Llanowar Elves')
    const elves2 = makeCard('elves-id-2', 'Llanowar Elves')
    const bolt = makeCard('bolt-id', 'Lightning Bolt', 'Instant')

    const currentCards: DeckCard[] = [
      makeDeckCard('elves-id-1', 2),
      makeDeckCard('elves-id-2', 2),
      makeDeckCard('bolt-id', 4),
    ]
    const cardDataMap = new Map<string, ScryfallCard>([
      ['elves-id-1', elves1],
      ['elves-id-2', elves2],
      ['bolt-id', bolt],
    ])
    const lockedCardIds = new Set<string>()

    const result = resolveRemoveIds(
      [{ name: 'Llanowar Elves' }],
      currentCards,
      cardDataMap,
      lockedCardIds,
    )

    // Both printings must be returned
    expect(result).toContain('elves-id-1')
    expect(result).toContain('elves-id-2')
    // Bolt is unrelated — must not appear
    expect(result).not.toContain('bolt-id')
  })

  it('TC-RRI-02: unknown name -> returns [] (no off-60 drift)', () => {
    const currentCards = [makeDeckCard('bolt-id', 4)]
    const cardDataMap = new Map<string, ScryfallCard>([
      ['bolt-id', makeCard('bolt-id', 'Lightning Bolt', 'Instant')],
    ])
    const lockedCardIds = new Set<string>()

    const result = resolveRemoveIds(
      [{ name: 'Black Lotus' }], // not in deck
      currentCards,
      cardDataMap,
      lockedCardIds,
    )

    expect(result).toHaveLength(0)
  })

  it('TC-RRI-03: locked exclusion — matching id in lockedCardIds is NOT in the result (hard backstop)', () => {
    const elvesCard = makeCard('elves-locked', 'Llanowar Elves')
    const currentCards: DeckCard[] = [makeDeckCard('elves-locked', 4)]
    const cardDataMap = new Map<string, ScryfallCard>([['elves-locked', elvesCard]])
    // The card is locked
    const lockedCardIds = new Set<string>(['elves-locked'])

    const result = resolveRemoveIds(
      [{ name: 'Llanowar Elves' }],
      currentCards,
      cardDataMap,
      lockedCardIds,
    )

    // Locked id must be excluded — this is the hard backstop
    expect(result).not.toContain('elves-locked')
    expect(result).toHaveLength(0)
  })

  it('TC-RRI-04: DFC/split — name matching a single card_face name still resolves', () => {
    // A DFC card: combined name is "Delver of Secrets // Insectile Aberration"
    // Model returns "Delver of Secrets" (front face name only)
    const dfcCard: ScryfallCard = {
      ...makeCard('delver-id', 'Delver of Secrets // Insectile Aberration', 'Creature'),
      card_faces: [
        { name: 'Delver of Secrets', type_line: 'Creature — Human Wizard', oracle_text: '' },
        { name: 'Insectile Aberration', type_line: 'Creature — Human Insect', oracle_text: '' },
      ],
    }

    const currentCards = [makeDeckCard('delver-id', 4)]
    const cardDataMap = new Map<string, ScryfallCard>([['delver-id', dfcCard]])
    const lockedCardIds = new Set<string>()

    const result = resolveRemoveIds(
      [{ name: 'Delver of Secrets' }], // single face name
      currentCards,
      cardDataMap,
      lockedCardIds,
    )

    // Should resolve via card_faces[].name match
    expect(result).toContain('delver-id')
  })
})

// ─── 60-invariant and enforceDeltaSize ───────────────────────────────────────
//
// applyDelta does NOT trim/pad to 60 — the caller owns that.
// enforceDeltaSize is the pure helper that enforces the 60-card count:
//   - swap case (already 60): returned unchanged.
//   - add-one case (61 cards): trims one basic land copy.
//   - remove-one case (59 cards): pads with one basic land.
//   - remove-N case (57 cards): pads with 3 basic land copies.
//
// The add-one basic-land decrement is NEW code (fillLands only adds; the
// existing over-60 trim skips lands). This helper must handle both directions.

describe("enforceDeckCards — trimPolicy 'rebuild'", () => {
  const FOREST_ID = '3279314f-d639-4489-b2ab-3621bb3ca64b' // Forest (M21)
  const MOUNTAIN_ID = 'b92c8925-ecfc-4ece-b83a-f12e98a938ab' // Mountain (M21)

  const totalOf = (cards: DeckCard[]) => cards.reduce((s, c) => s + c.quantity, 0)
  const qtyOf = (cards: DeckCard[], id: string) =>
    cards.find((c) => c.scryfallId === id)?.quantity ?? 0

  it('TC-EDC-01: pads an undersized deck with basics on the deck colors', () => {
    const cards = [makeDeckCard('spell', 4)]
    const result = enforceDeckCards(cards, { trimPolicy: 'rebuild', colors: ['R'] })
    expect(totalOf(result)).toBe(60)
    expect(qtyOf(result, MOUNTAIN_ID)).toBe(56)
  })

  it('TC-EDC-02: trims spells before lands — the rebuild land count was deliberate', () => {
    // 15 x 4 spells (60) + 4 Mountains = 64. The four excess copies come off
    // the spells, and the mana base the model built survives untouched.
    const cards = [
      ...Array.from({ length: 15 }, (_, i) => makeDeckCard(`spell-${i}`, 4)),
      makeDeckCard(MOUNTAIN_ID, 4),
    ]
    const result = enforceDeckCards(cards, {
      trimPolicy: 'rebuild',
      colors: ['R'],
      isLand: (id) => id === MOUNTAIN_ID,
    })
    expect(totalOf(result)).toBe(60)
    expect(qtyOf(result, MOUNTAIN_ID)).toBe(4)
  })

  it('TC-EDC-03: deletes whole entries once every card sits at one copy', () => {
    const cards = Array.from({ length: 70 }, (_, i) => makeDeckCard(`spell-${i}`, 1))
    const result = enforceDeckCards(cards, { trimPolicy: 'rebuild', colors: ['G'] })
    expect(totalOf(result)).toBe(60)
    expect(result).toHaveLength(60)
  })

  it('TC-EDC-04: never touches a card carrying the locked flag', () => {
    const cards = [
      ...Array.from({ length: 15 }, (_, i) => makeDeckCard(`spell-${i}`, 4)),
      { ...makeDeckCard('pinned', 4), locked: true },
    ]
    const result = enforceDeckCards(cards, { trimPolicy: 'rebuild', colors: ['G'] })
    expect(totalOf(result)).toBe(60)
    expect(qtyOf(result, 'pinned')).toBe(4)
  })

  it('TC-EDC-05: honours lockedIds passed alongside the flag', () => {
    const cards = [
      ...Array.from({ length: 15 }, (_, i) => makeDeckCard(`spell-${i}`, 4)),
      makeDeckCard('pinned', 4),
    ]
    const result = enforceDeckCards(cards, {
      trimPolicy: 'rebuild',
      colors: ['G'],
      lockedIds: new Set(['pinned']),
    })
    expect(totalOf(result)).toBe(60)
    expect(qtyOf(result, 'pinned')).toBe(4)
  })

  it('TC-EDC-06: caps a non-basic at four copies; the model list is untrusted', () => {
    const cards = [makeDeckCard('spell', 9), makeDeckCard(FOREST_ID, 51)]
    const result = enforceDeckCards(cards, { trimPolicy: 'rebuild', colors: ['G'] })
    expect(qtyOf(result, 'spell')).toBe(4)
    expect(totalOf(result)).toBe(60)
  })

  it('TC-EDC-07: carries zone and locked through onto the returned rows', () => {
    const cards = [
      { ...makeDeckCard('pinned', 4), locked: true },
      makeDeckCard('spell', 4),
    ]
    const result = enforceDeckCards(cards, { trimPolicy: 'rebuild', colors: ['G'] })
    expect(result.find((c) => c.scryfallId === 'pinned')?.locked).toBe(true)
    expect(result.every((c) => c.zone === 'main')).toBe(true)
  })
})

describe('enforceDeltaSize', () => {
  const FOREST_ID = '3279314f-d639-4489-b2ab-3621bb3ca64b' // Forest (M21)

  it('TC-EDS-01: swap case — 60 cards in -> exactly 60 out, unchanged', () => {
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('new-card', 4),
    ]
    // total = 60
    const result = enforceDeltaSize(cards, ['G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)
  })

  it('TC-EDS-02: add-one case — 61 cards -> trims one basic land copy -> exactly 60', () => {
    // 59 non-land cards + 2 Forest copies = 61
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('non-land-extra', 3), // 59 non-lands
      makeDeckCard(FOREST_ID, 2),         // 2 Forest = total 61
    ]

    const result = enforceDeltaSize(cards, ['G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)

    // The basic land should have been decremented (1 copy trimmed)
    const forestEntry = result.find((c) => c.scryfallId === FOREST_ID)
    // Either qty is 1 (decremented) or the entry was removed if it reached 0
    const forestQty = forestEntry?.quantity ?? 0
    expect(forestQty).toBe(1)
  })

  it('TC-EDS-03: remove-one case — 59 cards -> pads with one basic land -> exactly 60', () => {
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('odd-card', 3), // total: 59
    ]

    const result = enforceDeltaSize(cards, ['G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)
  })

  it('TC-EDS-04: remove-N case — 57 cards -> pads with 3 basic land copies -> exactly 60', () => {
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('odd-card', 1), // total: 57
    ]

    const result = enforceDeltaSize(cards, ['G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)
  })

  it('TC-EDS-05a: multicolor pad distribution - colors [R,G], deficit 3 -> 2 per-color split with remainder on first color', () => {
    // 57 non-land cards; colors R + G means 2 colors
    // perColor = floor(3/2) = 1; remainder = 1 -> first color (R) gets +1 -> R=2, G=1
    const MOUNTAIN_ID = 'b92c8925-ecfc-4ece-b83a-f12e98a938ab' // Mountain (M21)
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('odd-card', 1), // total: 57
    ]

    const result = enforceDeltaSize(cards, ['R', 'G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)

    const mountainEntry = result.find((c) => c.scryfallId === MOUNTAIN_ID)
    const forestEntry2 = result.find((c) => c.scryfallId === FOREST_ID)
    const mountainQty = mountainEntry?.quantity ?? 0
    const forestQty = forestEntry2?.quantity ?? 0
    // The two land quantities must sum to 3 and each be >= 1
    expect(mountainQty + forestQty).toBe(3)
    expect(mountainQty).toBeGreaterThanOrEqual(1)
    expect(forestQty).toBeGreaterThanOrEqual(1)
    // Remainder (1) is distributed to the first color (R = Mountain)
    expect(mountainQty).toBe(2)
    expect(forestQty).toBe(1)
  })

  it('TC-EDS-05b: multicolor pad - colors [R,G], deficit 1 -> only one land added (single color gets the 1)', () => {
    const MOUNTAIN_ID = 'b92c8925-ecfc-4ece-b83a-f12e98a938ab' // Mountain (M21)
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('odd-card', 3), // total: 59
    ]

    const result = enforceDeltaSize(cards, ['R', 'G'])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)

    const mountainEntry = result.find((c) => c.scryfallId === MOUNTAIN_ID)
    const forestEntry2 = result.find((c) => c.scryfallId === FOREST_ID)
    const mountainQty = mountainEntry?.quantity ?? 0
    const forestQty = forestEntry2?.quantity ?? 0
    // perColor = floor(1/2) = 0; remainder = 1 -> first color only gets the land
    expect(mountainQty + forestQty).toBe(1)
    expect(mountainQty).toBe(1) // first color (R) gets the remainder
    expect(forestQty).toBe(0)
  })

  it('TC-EDS-05c: empty colors [] -> falls back to Forest (G) and pads to exactly 60', () => {
    const cards: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      makeDeckCard('odd-card', 1), // total: 57 -> deficit 3
    ]

    const result = enforceDeltaSize(cards, [])
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)

    // Should have padded with Forest (BASIC_LAND_ID_BY_COLOR['G'])
    const forestEntry = result.find((c) => c.scryfallId === FOREST_ID)
    expect(forestEntry).toBeDefined()
    expect(forestEntry!.quantity).toBe(3)
  })

  it('TC-EDS-05: add-one at 61 cards with ZERO basic lands -> trims a deterministic non-locked card -> exactly 60', () => {
    // Implementer rule: reduce the last non-locked, non-just-added card by 1 copy.
    // The "surface a visible removed-change" requirement from AC5 is satisfied DOWNSTREAM
    // by computeDeckDiff (diffs current->final; whatever enforceDeltaSize trimmed appears
    // as a removed row in the ledger). No special return channel needed here.
    //
    // This deck has NO basic lands — only non-land cards. After add-one the total is 61.
    // enforceDeltaSize must still return exactly 60 (DeckCard[], not widened).
    const cards: DeckCard[] = [
      ...Array.from({ length: 15 }, (_, i) => makeDeckCard(`card-${i}`, 4)),
      // total: 15 * 4 = 60 ... add one extra copy to simulate add-one scenario:
    ]
    // Manually produce a 61-card list with no basic lands:
    // 15 entries at 4 = 60, then bump one to 5 to get 61
    const cards61: DeckCard[] = [
      ...Array.from({ length: 14 }, (_, i) => makeDeckCard(`card-${i}`, 4)), // 56
      makeDeckCard('card-14', 5), // 5 copies — total 61; no basic lands present
    ]

    const result = enforceDeltaSize(cards61, ['G'])
    // Must return exactly 60
    const total = result.reduce((s, c) => s + c.quantity, 0)
    expect(total).toBe(60)
    // The return type is DeckCard[] — not a tuple, not an object with extra fields
    expect(Array.isArray(result)).toBe(true)
  })
})
