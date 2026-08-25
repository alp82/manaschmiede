import { describe, it, expect } from 'vitest'
import { mergeCardsIntoDeck, type DeckCard } from '../deck-utils'

// Helper: never a basic land
const noBasic = (_id: string) => false
// Helper: always a basic land
const alwaysBasic = (_id: string) => true
// Helper: basic only for a specific id
const basicIf = (basicId: string) => (id: string) => id === basicId

function makeCard(
  scryfallId: string,
  quantity: number,
  zone: DeckCard['zone'] = 'main',
  locked?: boolean,
): DeckCard {
  const c: DeckCard = { scryfallId, quantity, zone }
  if (locked !== undefined) c.locked = locked
  return c
}

describe('mergeCardsIntoDeck', () => {
  it('new card appends with requested qty and id appears in addedIds', () => {
    const existing: DeckCard[] = []
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'abc', quantity: 2 }],
      noBasic,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ scryfallId: 'abc', quantity: 2, zone: 'main' })
    expect(addedIds).toContain('abc')
  })

  it('existing non-basic at qty 2 + 2 more = single entry at 4 (merged, not duplicated)', () => {
    const existing = [makeCard('bolt', 2)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: 2 }],
      noBasic,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ scryfallId: 'bolt', quantity: 4 })
    expect(addedIds).toContain('bolt')
  })

  it('non-basic already at 4 + any = unchanged, id NOT in addedIds', () => {
    const existing = [makeCard('bolt', 4)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: 2 }],
      noBasic,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].quantity).toBe(4)
    expect(addedIds).not.toContain('bolt')
  })

  it('non-basic at 2 + 3 caps at 4 (not 5), id in addedIds (qty did rise)', () => {
    const existing = [makeCard('bolt', 2)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: 3 }],
      noBasic,
    )
    expect(merged[0].quantity).toBe(4)
    expect(addedIds).toContain('bolt')
  })

  it('entry with locked:true is not increased, id NOT in addedIds', () => {
    const existing = [makeCard('bolt', 2, 'main', true)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: 2 }],
      noBasic,
    )
    expect(merged[0].quantity).toBe(2)
    expect(addedIds).not.toContain('bolt')
  })

  it('basic land (isBasicLandId true) bypasses cap: 4 + 12 = 16, id in addedIds', () => {
    const existing = [makeCard('plains', 4)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'plains', quantity: 12 }],
      alwaysBasic,
    )
    expect(merged[0].quantity).toBe(16)
    expect(addedIds).toContain('plains')
  })

  it('quantity <= 0 is ignored; deck unchanged', () => {
    const existing = [makeCard('bolt', 2)]
    const { merged, addedIds } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: 0 }],
      noBasic,
    )
    expect(merged[0].quantity).toBe(2)
    expect(addedIds).toHaveLength(0)

    const { merged: m2, addedIds: a2 } = mergeCardsIntoDeck(
      existing,
      [{ scryfallId: 'bolt', quantity: -1 }],
      noBasic,
    )
    expect(m2[0].quantity).toBe(2)
    expect(a2).toHaveLength(0)
  })
})
