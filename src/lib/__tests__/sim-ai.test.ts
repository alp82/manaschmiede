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

    const assignments = chooseBlockers([rock, shrine], [{ permanent: attacker, index: 0 }], 20)

    expect(assignments.size).toBe(0)
  })

  it('[R] blocks with a creature that survives and kills', () => {
    const wall = permanent(simCard({ id: 'wall', power: 3, toughness: 4 }))
    const attacker = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    const assignments = chooseBlockers([wall], [{ permanent: attacker, index: 0 }], 20)

    expect(assignments.get(0)).toEqual([0])
  })

  it('[R] chump-blocks an attacker that would otherwise be lethal', () => {
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))
    const giant = permanent(simCard({ id: 'giant', power: 20, toughness: 20 }))

    const assignments = chooseBlockers([chump], [{ permanent: giant, index: 0 }], 5)

    expect(assignments.get(0)).toEqual([0])
  })

  it('[R] keeps the chump back when the same attack is survivable', () => {
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))
    const giant = permanent(simCard({ id: 'giant', power: 20, toughness: 20 }))

    const assignments = chooseBlockers([chump], [{ permanent: giant, index: 0 }], 40)

    expect(assignments.size).toBe(0)
  })

  it('[R] chumps with the cheapest creature it has', () => {
    const squire = permanent(
      simCard({ id: 'squire', power: 1, toughness: 1, cost: cost(0, { G: 1 }) }),
    )
    const angel = permanent(
      simCard({ id: 'angel', power: 4, toughness: 4, cost: cost(4, { G: 1 }) }),
    )
    const giant = permanent(simCard({ id: 'giant', power: 20, toughness: 20 }))

    const assignments = chooseBlockers([angel, squire], [{ permanent: giant, index: 0 }], 5)

    expect(assignments.get(0)).toEqual([1])
  })

  it('[R] chumps the biggest attacker first when one block is enough', () => {
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))
    const ogre = permanent(simCard({ id: 'ogre', power: 5, toughness: 5 }))
    const bear = permanent(simCard({ id: 'bear', power: 3, toughness: 3 }))

    const assignments = chooseBlockers(
      [chump],
      [
        { permanent: bear, index: 0 },
        { permanent: ogre, index: 1 },
      ],
      4,
    )

    expect(assignments.get(1)).toEqual([0])
    expect(assignments.has(0)).toBe(false)
  })

  it('[R] does not throw away a creature on a block that still loses', () => {
    // A 1/1 in front of a 20/20 trampler absorbs one point. The defender dies
    // either way, so it keeps the creature.
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))
    const giant = permanent(
      simCard({ id: 'giant', power: 20, toughness: 20, keywords: new Set(['trample']) }),
    )

    const assignments = chooseBlockers([chump], [{ permanent: giant, index: 0 }], 5)

    expect(assignments.size).toBe(0)
  })

  it('[R] does not chump-block a flier with a ground creature', () => {
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))
    const drake = permanent(
      simCard({ id: 'drake', power: 20, toughness: 20, keywords: new Set(['flying']) }),
    )

    const assignments = chooseBlockers([chump], [{ permanent: drake, index: 0 }], 5)

    expect(assignments.size).toBe(0)
  })

  it('[R] blocks when a first-striking creature kills the attacker outright', () => {
    // The value pass declines this block - the blocker costs four more than
    // what it kills. But first strike kills the ogre before it deals damage,
    // so the block turns off all six points, trample included.
    const knight = permanent(
      simCard({
        id: 'knight',
        power: 2,
        toughness: 1,
        cost: cost(4, { G: 1 }),
        keywords: new Set(['first_strike']),
      }),
    )
    const ogre = permanent(
      simCard({ id: 'ogre', power: 6, toughness: 2, keywords: new Set(['trample']) }),
    )

    const assignments = chooseBlockers([knight], [{ permanent: ogre, index: 0 }], 5)

    expect(assignments.get(0)).toEqual([0])
  })

  it('[R] counts a deathtouch trampler as trampling over the whole blocker', () => {
    // A deathtouch attacker only assigns 1 to each blocker, so the wall stops
    // one point, not eight. Reading the wall's full toughness as absorbed made
    // the AI block and die anyway.
    const wall = permanent(simCard({ id: 'wall', power: 0, toughness: 8 }))
    const serpent = permanent(
      simCard({
        id: 'serpent',
        power: 20,
        toughness: 20,
        keywords: new Set(['trample', 'deathtouch']),
      }),
    )

    const assignments = chooseBlockers([wall], [{ permanent: serpent, index: 0 }], 15)

    expect(assignments.size).toBe(0)
  })

  it('[R] pairs two chumps onto a lethal menace attacker', () => {
    const first = permanent(simCard({ id: 'first', power: 1, toughness: 1 }))
    const second = permanent(simCard({ id: 'second', power: 1, toughness: 1 }))
    const brute = permanent(
      simCard({ id: 'brute', power: 20, toughness: 20, keywords: new Set(['menace']) }),
    )

    const assignments = chooseBlockers([first, second], [{ permanent: brute, index: 0 }], 5)

    expect(assignments.get(0)).toEqual([0, 1])
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
