import { describe, expect, it } from 'vitest'
import { chooseAttackers, chooseBlockers, chooseCasts } from '../simulation/ai'
import { emptyPool } from '../simulation/mana'
import type { ManaPool } from '../simulation/types'
import { cost, nonCreature, permanent, simCard } from './sim-fixtures'

function pool(colors: Partial<ManaPool['colors']>): ManaPool {
  return { colors: { ...emptyPool().colors, ...colors }, colorless: 0 }
}

describe('chooseCasts', () => {
  it('[R] reports the mana left after the cards it picked', () => {
    const hand = [simCard({ id: 'bear', cost: cost(0, { G: 1 }) })]

    const { indices, remaining } = chooseCasts(hand, pool({ G: 3 }), [], [])

    expect(indices).toEqual([0])
    expect(remaining).toEqual(pool({ G: 2 }))
  })

  it('[R] reports an untouched pool when it casts nothing', () => {
    const hand = [simCard({ id: 'giant', cost: cost(5, { G: 1 }) })]

    const { indices, remaining } = chooseCasts(hand, pool({ G: 1 }), [], [])

    expect(indices).toEqual([])
    expect(remaining).toEqual(pool({ G: 1 }))
  })

  it('[R] leaves the pool it was handed alone', () => {
    const available = pool({ G: 2 })
    const hand = [simCard({ id: 'bear', cost: cost(0, { G: 1 }) })]

    chooseCasts(hand, available, [], [])

    expect(available).toEqual(pool({ G: 2 }))
  })
})

describe('chooseBlockers', () => {
  it('[R] never blocks with a non-creature permanent', () => {
    // Once non-creature permanents survive their own resolution, an artifact
    // left in the blocker pool becomes an unkillable wall: it has no toughness
    // to exceed, so it absorbs every point of damage forever.
    const rock = permanent(nonCreature('rock', 'artifact'))
    const shrine = permanent(nonCreature('shrine', 'enchantment'))
    const attacker = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    const assignments = chooseBlockers([rock, shrine], [{ permanent: attacker, index: 0 }])

    expect(assignments.size).toBe(0)
  })

  it('[R] blocks with a creature that survives and kills', () => {
    const wall = permanent(simCard({ id: 'wall', power: 3, toughness: 4 }))
    const attacker = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    const assignments = chooseBlockers([wall], [{ permanent: attacker, index: 0 }])

    expect(assignments.get(0)).toEqual([0])
  })
})

describe('chooseAttackers', () => {
  it('[R] does not count a non-creature permanent as a potential blocker', () => {
    // A menace attacker is safe as long as the defender has fewer than two
    // creatures. Counting artifacts toward that pool made it stay home.
    const raider = permanent(
      simCard({ id: 'raider', power: 2, toughness: 2, keywords: new Set(['menace']) }),
    )
    const guard = permanent(simCard({ id: 'guard', power: 3, toughness: 3 }))
    const rock = permanent(nonCreature('rock', 'artifact'))

    expect(chooseAttackers([raider], [guard, rock], 20)).toEqual([0])
  })

  it('[R] holds back a menace attacker facing two creatures that kill it', () => {
    const raider = permanent(
      simCard({ id: 'raider', power: 2, toughness: 2, keywords: new Set(['menace']) }),
    )
    const guard = () => permanent(simCard({ id: 'guard', power: 3, toughness: 3 }))

    expect(chooseAttackers([raider], [guard(), guard()], 20)).toEqual([])
  })

  it('[R] never attacks with a non-creature permanent', () => {
    const rock = permanent(nonCreature('rock', 'artifact'))

    expect(chooseAttackers([rock], [], 20)).toEqual([])
  })

  it('[R] attacks with a creature nothing can block', () => {
    const bear = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    expect(chooseAttackers([bear], [], 20)).toEqual([0])
  })
})
