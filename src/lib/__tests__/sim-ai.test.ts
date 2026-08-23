import { describe, expect, it } from 'vitest'
import { chooseAttackers, chooseBlockers } from '../simulation/ai'
import { nonCreature, permanent, simCard } from './sim-fixtures'

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
