import { describe, expect, it } from 'vitest'
import { isDestroyedBySba } from '../simulation/state-based-actions'
import type { CardType } from '../simulation/types'
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

  it.each<CardType>(['creature', 'artifact', 'enchantment', 'planeswalker'])(
    '[R] destroys a %s marked for death',
    (cardType) => {
      const marked = permanent(simCard({ id: 'doomed', cardType }), { markedForDeath: true })
      expect(isDestroyedBySba(marked)).toBe(true)
    },
  )
})
