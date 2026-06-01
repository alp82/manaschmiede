/**
 * RED tests — projectLocked and deriveLockedIds do not exist yet.
 * They must be exported from src/lib/deck-utils.ts.
 *
 * Asserted signatures:
 *   projectLocked(cards: DeckCard[], lockedIds: Set<string>): DeckCard[]
 *   deriveLockedIds(cards: DeckCard[]): Set<string>
 */
import { describe, it, expect } from 'vitest'
import { projectLocked, deriveLockedIds } from '../deck-utils'
import type { DeckCard } from '../deck-utils'

function makeCard(
  scryfallId: string,
  quantity: number = 2,
  locked?: boolean,
): DeckCard {
  const c: DeckCard = { scryfallId, quantity, zone: 'main' }
  if (locked !== undefined) c.locked = locked
  return c
}

describe('projectLocked', () => {
  it('stamps locked:true strictly from set membership', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const result: DeckCard[] = projectLocked(cards, new Set(['a']))
    const a = result.find((c) => c.scryfallId === 'a')!
    const b = result.find((c) => c.scryfallId === 'b')!
    expect(a.locked).toBe(true)
    expect(b.locked).toBeFalsy()
  })

  it('clears locked when id is absent from the set', () => {
    const cards = [makeCard('a', 2, true), makeCard('b', 2, true)]
    // only 'a' is in the new set — 'b' should lose its lock
    const result: DeckCard[] = projectLocked(cards, new Set(['a']))
    expect(result.find((c) => c.scryfallId === 'b')!.locked).toBeFalsy()
    expect(result.find((c) => c.scryfallId === 'a')!.locked).toBe(true)
  })

  it('is idempotent: calling twice produces the same result', () => {
    const cards = [makeCard('x'), makeCard('y', 3, true)]
    const ids = new Set(['x'])
    const once = projectLocked(cards, ids)
    const twice = projectLocked(once, ids)
    expect(twice).toEqual(once)
  })

  it('round-trips: deriveLockedIds(projectLocked(cards, ids)) deep-equals ids', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c', 1, true)]
    const ids = new Set(['a', 'b'])
    const projected: DeckCard[] = projectLocked(cards, ids)
    const recovered: Set<string> = deriveLockedIds(projected)
    expect(recovered).toEqual(ids)
  })

  it('empty set clears all locks', () => {
    const cards = [makeCard('a', 2, true), makeCard('b', 2, true)]
    const result: DeckCard[] = projectLocked(cards, new Set())
    expect(result.every((c) => !c.locked)).toBe(true)
  })

  it('does not mutate the input array or its entries', () => {
    const original = [makeCard('a', 2, false)]
    const copy = JSON.parse(JSON.stringify(original))
    projectLocked(original, new Set(['a']))
    expect(original).toEqual(copy)
  })
})

describe('deriveLockedIds', () => {
  it('collects exactly the ids whose card.locked is truthy', () => {
    const cards = [
      makeCard('x', 2, true),
      makeCard('y', 2, false),
      makeCard('z', 2, true),
    ]
    const result: Set<string> = deriveLockedIds(cards)
    expect(result).toEqual(new Set(['x', 'z']))
  })

  it('returns empty set when no cards are locked', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const result: Set<string> = deriveLockedIds(cards)
    expect(result.size).toBe(0)
  })

  it('ignores cards with locked:undefined (falsy)', () => {
    const cards: DeckCard[] = [
      { scryfallId: 'a', quantity: 2, zone: 'main' },
    ]
    const result: Set<string> = deriveLockedIds(cards)
    expect(result.size).toBe(0)
  })

  it('returns empty set for empty input', () => {
    const result: Set<string> = deriveLockedIds([])
    expect(result.size).toBe(0)
  })
})
