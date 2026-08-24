import { describe, expect, it } from 'vitest'
import { isDestroyedBySba, isLethalTo } from '../simulation/state-based-actions'
import type { CardType, Keyword } from '../simulation/types'
import { forest, nonCreature, permanent, simCard } from './sim-fixtures'

const NON_CREATURE_TYPES: Array<'artifact' | 'enchantment' | 'planeswalker'> = [
  'artifact',
  'enchantment',
  'planeswalker',
]

describe('isDestroyedBySba', () => {
  it.each(NON_CREATURE_TYPES)(
    '[R] keeps an undamaged %s on the battlefield',
    (cardType) => {
      expect(isDestroyedBySba(permanent(nonCreature('permanent', cardType)))).toBe(false)
    },
  )

  it.each(NON_CREATURE_TYPES)('[R] keeps a damaged %s on the battlefield', (cardType) => {
    const damaged = permanent(nonCreature('permanent', cardType), { damage: 5 })
    expect(isDestroyedBySba(damaged)).toBe(false)
  })

  it('[R] keeps a land on the battlefield', () => {
    expect(isDestroyedBySba(permanent(forest()))).toBe(false)
  })

  it('[R] destroys a creature whose damage reaches its toughness', () => {
    const bear = simCard({ id: 'bear', power: 2, toughness: 2 })
    expect(isDestroyedBySba(permanent(bear, { damage: 2 }))).toBe(true)
    expect(isDestroyedBySba(permanent(bear, { damage: 1 }))).toBe(false)
  })

  it('[R] destroys a 0-toughness creature', () => {
    const zero = simCard({ id: 'zero', power: 0, toughness: 0 })
    expect(isDestroyedBySba(permanent(zero))).toBe(true)
  })

  it('[R] spares an indestructible creature with lethal damage', () => {
    const wall = simCard({ id: 'wall', toughness: 2, keywords: new Set(['indestructible']) })
    expect(isDestroyedBySba(permanent(wall, { damage: 9 }))).toBe(false)
  })

  it('[R] destroys a creature dealt any damage by a deathtouch source', () => {
    // Issue #35. Lethality is decided here, so a deathtouch attacker that
    // assigns a single point kills what it hit.
    const giant = simCard({ id: 'giant', power: 5, toughness: 5 })
    expect(isDestroyedBySba(permanent(giant, { damage: 1, deathtouched: true }))).toBe(true)
  })

  it('[R] spares a creature marked as deathtouched that took no damage', () => {
    const giant = simCard({ id: 'giant', power: 5, toughness: 5 })
    expect(isDestroyedBySba(permanent(giant, { damage: 0, deathtouched: true }))).toBe(false)
  })

  it('[R] spares an indestructible creature dealt deathtouch damage', () => {
    const wall = simCard({ id: 'wall', toughness: 8, keywords: new Set(['indestructible']) })
    expect(isDestroyedBySba(permanent(wall, { damage: 1, deathtouched: true }))).toBe(false)
  })

  it.each<CardType>(['creature', 'artifact', 'enchantment', 'planeswalker'])(
    '[R] destroys a %s marked for death',
    (cardType) => {
      const marked = permanent(simCard({ id: 'doomed', cardType }), { markedForDeath: true })
      expect(isDestroyedBySba(marked)).toBe(true)
    },
  )
})

describe('isLethalTo', () => {
  const bear = permanent(simCard({ id: 'bear', power: 2, toughness: 4 }))

  it('[R] compares the damage against the remaining toughness', () => {
    expect(isLethalTo(bear, 3, false)).toBe(false)
    expect(isLethalTo(bear, 4, false)).toBe(true)
  })

  it('[R] makes any nonzero damage from a deathtouch source lethal', () => {
    expect(isLethalTo(bear, 1, true)).toBe(true)
    expect(isLethalTo(bear, 0, true)).toBe(false)
  })

  it('[R] spares an indestructible target either way', () => {
    const wall = permanent(
      simCard({ id: 'wall', power: 0, toughness: 4, keywords: new Set<Keyword>(['indestructible']) }),
    )

    expect(isLethalTo(wall, 99, false)).toBe(false)
    expect(isLethalTo(wall, 1, true)).toBe(false)
  })
})
