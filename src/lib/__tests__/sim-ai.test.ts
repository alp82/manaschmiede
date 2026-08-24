import { describe, expect, it } from 'vitest'
import {
  chooseAttackers,
  chooseBlockers,
  chooseCasts,
  chooseLand,
  shouldMulligan,
} from '../simulation/ai'
import {
  cost,
  forest,
  land,
  nonCreature,
  permanent,
  simCard,
  sourceNames,
  sourcesOf,
} from './sim-fixtures'

describe('chooseCasts', () => {
  it('[R] reports the lands that paid for what it picked', () => {
    const hand = [simCard({ id: 'bear', cost: cost(0, { G: 1 }) })]
    const sources = sourcesOf(forest('a'), forest('b'), forest('c'))

    const { indices, spent } = chooseCasts(hand, sources, [])

    expect(indices).toEqual([0])
    expect(spent.map((p) => p.card.name)).toEqual(['a'])
  })

  it('[R] reports no lands spent when it casts nothing', () => {
    const hand = [simCard({ id: 'giant', cost: cost(5, { G: 1 }) })]

    const { indices, spent } = chooseCasts(hand, sourcesOf(forest('a')), [])

    expect(indices).toEqual([])
    expect(spent).toEqual([])
  })

  it('[R] leaves the sources it was handed alone', () => {
    const sources = sourcesOf(forest('a'), forest('b'))
    const hand = [simCard({ id: 'bear', cost: cost(0, { G: 1 }) })]

    chooseCasts(hand, sources, [])

    expect(sourceNames(sources)).toEqual(['a', 'b'])
  })

  it('[R] casts a spell of either color off a single dual land', () => {
    const dual = land('gainland', ['W', 'U'], false)

    const wizard = chooseCasts(
      [simCard({ id: 'wizard', cost: cost(0, { U: 1 }) })],
      sourcesOf(dual),
      [],
    )
    const cleric = chooseCasts(
      [simCard({ id: 'cleric', cost: cost(0, { W: 1 }) })],
      sourcesOf(dual),
      [],
    )

    expect(wizard.indices).toEqual([0])
    expect(cleric.indices).toEqual([0])
  })

  it('[R] spends a dual land on the spell that needs it', () => {
    // The bear can be paid either way, so a Forest-first allocation would leave
    // the wizard uncastable and the dual is the only blue source there is.
    const hand = [
      simCard({ id: 'bear', cost: cost(0, { G: 1 }) }),
      simCard({ id: 'wizard', cost: cost(0, { U: 1 }) }),
    ]

    const { indices } = chooseCasts(hand, sourcesOf(forest('a'), land('dual', ['G', 'U'], false)), [])

    expect([...indices].sort()).toEqual([0, 1])
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

  it('[R] declines an even trade while the life is affordable', () => {
    // A 2/2 stopping a 2/2 costs one creature and kills one, and buys two life
    // out of twenty. Taking that deal every turn is what made attacking into an
    // equal board pointless, and a mirror match came down to the extra card the
    // player on the draw sees rather than to who moved first.
    const blocker = permanent(simCard({ id: 'blocker', power: 2, toughness: 2 }))
    const attacker = permanent(simCard({ id: 'attacker', power: 2, toughness: 2 }))

    const assignments = chooseBlockers([blocker], [{ permanent: attacker, index: 0 }], 20)

    expect(assignments.size).toBe(0)
  })

  it('[R] takes the same even trade once it is within two swings of dying', () => {
    const blocker = permanent(simCard({ id: 'blocker', power: 2, toughness: 2 }))
    const attacker = permanent(simCard({ id: 'attacker', power: 2, toughness: 2 }))

    const assignments = chooseBlockers([blocker], [{ permanent: attacker, index: 0 }], 3)

    expect(assignments.get(0)).toEqual([0])
  })

  it('[R] takes a trade that is ahead on value at any life total', () => {
    const blocker = permanent(
      simCard({ id: 'squire', power: 2, toughness: 2, cost: cost(0, { G: 1 }) }),
    )
    const attacker = permanent(
      simCard({ id: 'angel', power: 2, toughness: 2, cost: cost(4, { G: 1 }) }),
    )

    const assignments = chooseBlockers([blocker], [{ permanent: attacker, index: 0 }], 20)

    expect(assignments.get(0)).toEqual([0])
  })

  it('[R] blocks for free with a creature that survives and kills nothing', () => {
    const wall = permanent(simCard({ id: 'wall', power: 0, toughness: 5 }))
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

  it('[R] attacks when the attackers outnumber the blockers', () => {
    // Judging each attacker against every untapped blocker counts the one
    // blocker against all three, so all three stayed home. At most one of them
    // can actually be blocked, and the other two are four damage.
    const bear = () => permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))
    const mine = [bear(), bear(), bear()]

    expect(chooseAttackers(mine, [bear()], 20)).toEqual([0, 1, 2])
  })

  it('[R] attacks into an equal board the defender will not block', () => {
    const bear = () => permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    expect(chooseAttackers([bear()], [bear()], 20)).toEqual([0])
  })

  it('[R] holds back a creature that dies for nothing', () => {
    const squire = permanent(simCard({ id: 'squire', power: 1, toughness: 1 }))
    const wall = permanent(simCard({ id: 'wall', power: 4, toughness: 4 }))

    expect(chooseAttackers([squire], [wall], 20)).toEqual([])
  })

  it('[R] swings for the win even into blockers that eat the attack', () => {
    const bear = () => permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))
    const mine = [bear(), bear()]

    expect(chooseAttackers(mine, [bear()], 2)).toEqual([0, 1])
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

describe('shouldMulligan', () => {
  /** A hand of `size` cards, `lands` of them Forests and the rest one-drops. */
  const hand = (size: number, lands: number) => [
    ...Array.from({ length: lands }, (_, i) => forest(`forest-${i}`)),
    ...Array.from({ length: size - lands }, (_, i) =>
      simCard({ id: `bear-${i}`, cost: cost(0, { G: 1 }) }),
    ),
  ]

  describe('an opening seven', () => {
    it.each([2, 3, 4, 5])('[R] keeps a seven with %i lands', (lands) => {
      expect(shouldMulligan(hand(7, lands), 0)).toBe(false)
    })

    it.each([0, 1, 6, 7])('[R] ships a seven with %i lands', (lands) => {
      // Too few to cast anything, or too few spells to cast.
      expect(shouldMulligan(hand(7, lands), 0)).toBe(true)
    })
  })

  describe('a six after one mulligan', () => {
    it('[R] ships a six with no lands', () => {
      expect(shouldMulligan(hand(6, 0), 1)).toBe(true)
    })

    it.each([1, 2, 3, 4, 5])('[R] keeps a six with %i lands', (lands) => {
      // One land is enough at six: the next mulligan costs a card either way,
      // and there is only one left to take.
      expect(shouldMulligan(hand(6, lands), 1)).toBe(false)
    })

    it('[R] ships a six that is all lands', () => {
      expect(shouldMulligan(hand(6, 6), 1)).toBe(true)
    })
  })

  it('[R] keeps any hand once two mulligans have been taken', () => {
    // `createPlayer` loops on this predicate, so a hand that always wants a
    // mulligan is an infinite loop. The count is the only thing stopping it -
    // a five-card hand of nothing but spells would otherwise ship forever.
    expect(shouldMulligan(hand(5, 0), 2)).toBe(false)
    expect(shouldMulligan(hand(5, 5), 2)).toBe(false)
    expect(shouldMulligan(hand(4, 0), 3)).toBe(false)
  })

  it('[R] keeps a hand that is neither seven nor six cards', () => {
    // Only the two sizes the mulligan loop can produce have thresholds.
    expect(shouldMulligan(hand(5, 0), 0)).toBe(false)
    expect(shouldMulligan(hand(0, 0), 0)).toBe(false)
  })

  it('[R] counts lands by card type, not by whether they are basic', () => {
    const duals = Array.from({ length: 2 }, (_, i) => land(`dual-${i}`, ['G', 'U'], false))
    const spells = Array.from({ length: 5 }, (_, i) =>
      simCard({ id: `bear-${i}`, cost: cost(0, { G: 1 }) }),
    )

    expect(shouldMulligan([...duals, ...spells], 0)).toBe(false)
  })
})

describe('chooseLand', () => {
  const bear = (color: 'G' | 'U') =>
    simCard({ id: `bear-${color}`, cost: cost(0, { [color]: 1 }) })

  it('[R] reports -1 when the hand holds no land', () => {
    expect(chooseLand([bear('G')], [])).toBe(-1)
  })

  it('[R] plays the only land in hand', () => {
    expect(chooseLand([bear('G'), forest('a')], [])).toBe(1)
  })

  it('[R] plays a land for a color the board cannot make yet', () => {
    const hand = [forest('a'), land('island', ['U']), bear('U')]

    expect(chooseLand(hand, [permanent(forest('in-play'))])).toBe(1)
  })

  it('[R] ignores a color the board already makes', () => {
    // Green is covered, so the Forest is not the land this hand needs.
    const hand = [forest('a'), land('island', ['U']), bear('G'), bear('U')]

    expect(chooseLand(hand, [permanent(forest('in-play'))])).toBe(1)
  })

  it('[R] falls back to the first land when no color is missing', () => {
    const hand = [land('island', ['U']), forest('a'), bear('G')]

    expect(chooseLand(hand, [permanent(forest('in-play'))])).toBe(0)
  })

  it('[R] reads a dual land as covering either color it needs', () => {
    const hand = [forest('a'), land('dual', ['U', 'B'], false), bear('U')]

    expect(chooseLand(hand, [])).toBe(1)
  })

  it('[R] ignores non-land permanents when reading the board colors', () => {
    // Only lands produce mana in the model, so a mana creature on the
    // battlefield must not make blue look covered. The Forest comes first in
    // hand, so dropping the card-type filter picks it instead of the Island.
    const manaElf = permanent(
      simCard({ id: 'elf', producesColors: ['U'] }),
    )
    const hand = [forest('a'), land('island', ['U']), bear('U')]

    expect(chooseLand(hand, [manaElf, permanent(forest('in-play'))])).toBe(1)
  })
})
