import { describe, expect, it } from 'vitest'
import { MAX_ROUNDS, runGame, runTurn, stateBasedActions } from '../simulation/game-state'
import type { CardEffect, Permanent, SimCard } from '../simulation/types'
import {
  RIGGED_RNG,
  cost,
  deckOf,
  forest,
  nonCreature,
  permanent,
  simCard,
  stateWith,
} from './sim-fixtures'

describe('runGame with a non-creature win condition', () => {
  // A 0/0 artifact carrying an 'upkeep' drain. Before the SBA was gated on
  // creatures it was binned the instant it resolved, so the drain never ticked
  // and the game ran to the 50-round cap.
  const drainRock = nonCreature('drain-rock', 'artifact', [
    { trigger: 'upkeep', action: { type: 'lose_life', target: 'opponent', amount: 7 } },
  ])

  it('[R] lets an upkeep trigger on an artifact win the game', () => {
    const opening = [forest(), forest(), forest(), forest(), drainRock, drainRock, drainRock]
    const artifactDeck = deckOf(
      opening.map((c) => ({ ...c, cost: c.cardType === 'land' ? null : cost(2) })),
      forest(),
    )
    const landsOnly = deckOf([], forest())

    const result = runGame(artifactDeck, landsOnly, RIGGED_RNG)

    expect(result.winner).toBe(0)
    expect(result.winCondition).toBe('life')
    expect(result.rounds).toBeLessThan(10)
  })
})

describe('stateBasedActions', () => {
  it('[R] leaves non-creature permanents on the battlefield', () => {
    const rock = permanent(nonCreature('rock', 'artifact'))
    const shrine = permanent(nonCreature('shrine', 'enchantment'))
    const walker = permanent(nonCreature('walker', 'planeswalker'))
    const state = stateWith([rock, shrine, walker], [])

    stateBasedActions(state)

    expect(state.players[0].battlefield).toEqual([rock, shrine, walker])
    expect(state.players[0].graveyard).toEqual([])
  })

  it('[R] moves a lethally damaged creature to the graveyard', () => {
    const bear = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }), { damage: 2 })
    const rock = permanent(nonCreature('rock', 'artifact'))
    const state = stateWith([bear, rock], [])

    stateBasedActions(state)

    expect(state.players[0].battlefield).toEqual([rock])
    expect(state.players[0].graveyard).toEqual([bear.card])
  })

  it('[R] fires a death trigger only for the permanent that died', () => {
    const bear = permanent(
      simCard({
        id: 'bear',
        power: 2,
        toughness: 2,
        effects: [
          { trigger: 'death', action: { type: 'lose_life', target: 'opponent', amount: 3 } },
        ],
      }),
      { damage: 2 },
    )
    const rock = permanent(
      nonCreature('rock', 'artifact', [
        { trigger: 'death', action: { type: 'lose_life', target: 'opponent', amount: 5 } },
      ]),
    )
    const state = stateWith([bear, rock], [])

    stateBasedActions(state)

    expect(state.players[1].life).toBe(17)
  })
})

describe('mana within a single turn', () => {
  const oneDrop = (id: string, effects: CardEffect[] = []) =>
    simCard({ id, cost: cost(0, { G: 1 }), power: 1, toughness: 1, effects })

  it('[R] does not refill the mana pool for main phase 2', () => {
    const state = stateWith([permanent(forest())], [])
    state.players[0].hand = [oneDrop('bear-1'), oneDrop('bear-2')]

    runTurn(state, RIGGED_RNG)

    const creatures = state.players[0].battlefield.filter(
      (p) => p.card.cardType === 'creature',
    )
    expect(creatures.map((p) => p.card.id)).toEqual(['bear-1'])
    expect(state.players[0].hand.map((c) => c.id)).toEqual(['bear-2'])
  })

  it('[R] taps only the land whose mana paid for the spell', () => {
    const state = stateWith([permanent(forest('a')), permanent(forest('b'))], [])
    state.players[0].hand = [oneDrop('bear-1')]

    runTurn(state, RIGGED_RNG)

    const lands = state.players[0].battlefield.filter((p) => p.card.cardType === 'land')
    expect(lands.map((p) => p.tapped)).toEqual([true, false])
  })

  it('[R] still casts in main phase 2 with the mana that is left', () => {
    const drawer = oneDrop('drawer', [
      { trigger: 'etb', action: { type: 'draw', count: 1 } },
    ])
    const state = stateWith([permanent(forest('a')), permanent(forest('b'))], [])
    state.players[0].hand = [drawer]
    state.players[0].library = [oneDrop('bear-1')]

    runTurn(state, RIGGED_RNG)

    const creatures = state.players[0].battlefield.filter(
      (p) => p.card.cardType === 'creature',
    )
    expect(creatures.map((p) => p.card.id)).toEqual(['drawer', 'bear-1'])
  })
})

describe('ramp', () => {
  // Only the first test reproduces issue #4; the rest guard behaviour the
  // buggy version already had. See `parseDeck` in sim-parser.test.ts for the
  // aliasing invariant that made the identity filter wrong.
  const rampSpell = simCard({
    id: 'rampant-growth',
    cardType: 'sorcery',
    cost: cost(1, { G: 1 }),
    effects: [{ trigger: 'cast', action: { type: 'ramp', count: 1 } }],
  })

  const threeLandRamp = simCard({
    id: 'three-land-ramp',
    cardType: 'sorcery',
    cost: cost(1, { G: 1 }),
    effects: [{ trigger: 'cast', action: { type: 'ramp', count: 3 } }],
  })

  /** Player 0 holds `spell`, with a library of `count` references to one Forest. */
  function stateWithAliasedForests(spell: SimCard, count: number) {
    const state = stateWith([permanent(forest('a')), permanent(forest('b'))], [])
    const shared = forest('library-forest')
    state.players[0].library = Array.from({ length: count }, () => shared)
    state.players[0].hand = [spell]
    return state
  }

  it('[R] removes exactly one copy of the fetched basic land from the library', () => {
    const state = stateWithAliasedForests(rampSpell, 20)

    runTurn(state, RIGGED_RNG)

    expect(state.players[0].library).toHaveLength(19)
    expect(state.players[0].library.every((c) => c.id === 'library-forest')).toBe(true)
  })

  it('[R] puts the fetched basic land onto the battlefield', () => {
    const state = stateWithAliasedForests(rampSpell, 20)

    runTurn(state, RIGGED_RNG)

    const lands = state.players[0].battlefield.filter((p) => p.card.cardType === 'land')
    expect(lands.map((p) => p.card.id)).toEqual(['a', 'b', 'library-forest'])
  })

  it('[R] fetches one land per count and stops when the library runs dry', () => {
    const state = stateWithAliasedForests(threeLandRamp, 2)

    runTurn(state, RIGGED_RNG)

    expect(state.players[0].library).toHaveLength(0)
    const lands = state.players[0].battlefield.filter((p) => p.card.cardType === 'land')
    expect(lands.map((p) => p.card.id)).toEqual([
      'a',
      'b',
      'library-forest',
      'library-forest',
    ])
  })
})

describe('running out of cards', () => {
  /** Seven cards, so the opening hand is the whole deck and the library is empty. */
  const emptyLibrary = () => [
    forest(),
    forest(),
    forest(),
    forest(),
    simCard({ id: 'bear', cost: cost(1, { G: 1 }), power: 2, toughness: 2 }),
    simCard({ id: 'bear', cost: cost(1, { G: 1 }), power: 2, toughness: 2 }),
    simCard({ id: 'bear', cost: cost(1, { G: 1 }), power: 2, toughness: 2 }),
  ]

  it('[R] does not lose the game for holding an empty library', () => {
    // Player 0 skips the first draw step, so an empty library survives a whole
    // round. Ending the game the moment a library hits zero took that round
    // away and, in a stalled mirror, handed the win to the wrong player.
    const result = runGame(emptyLibrary(), deckOf([], forest()), RIGGED_RNG)

    expect(result.rounds).toBe(2)
  })

  it('[R] reports the loss as a mill', () => {
    const result = runGame(emptyLibrary(), deckOf([], forest()), RIGGED_RNG)

    expect(result.winner).toBe(1)
    expect(result.winCondition).toBe('mill')
  })
})

describe('mana metrics', () => {
  const bear = () => simCard({ id: 'bear', cost: cost(1, { G: 1 }), power: 2, toughness: 2 })

  it('[R] reports no curve hit for a player who cast nothing on turns 2 to 4', () => {
    // A board check reports a curve hit for a player who cast one creature on
    // turn 2 and then nothing again - the creature is still standing. The
    // question is whether the player used the turn, not whether the turn left
    // a mark.
    const oneSpell = deckOf([forest(), forest(), bear(), forest(), forest(), forest(), forest()], forest())

    const result = runGame(oneSpell, deckOf([], forest()), RIGGED_RNG)

    expect(result.curveHit[0]).toBe(false)
  })

  it('[R] reports a curve hit for a player who cast on each of turns 2, 3 and 4', () => {
    const onCurve = deckOf(
      [forest(), forest(), forest(), forest(), bear(), bear(), bear()],
      forest(),
    )

    const result = runGame(onCurve, deckOf([], forest()), RIGGED_RNG)

    expect(result.curveHit[0]).toBe(true)
  })

  it('[R] reports no reading at all for a game that ended before the sample turn', () => {
    // Screw is read on turn 4 and flood on turn 8. A game decided on turn 2
    // sampled neither, and calling that "not screwed, not flooded" is how game
    // length gets back into a metric that is supposed to be about draws:
    // `runSimulation` leaves a null out of that metric's denominator.
    const sevenCards = [
      forest(),
      forest(),
      forest(),
      forest(),
      bear(),
      bear(),
      bear(),
    ]

    const result = runGame(sevenCards, deckOf([], forest()), RIGGED_RNG)

    expect(result.rounds).toBe(2)
    expect(result.manaScrew[0]).toBeNull()
    expect(result.manaFlood[0]).toBeNull()
    expect(result.curveHit[0]).toBeNull()
  })

  it('[R] reports no reading for the player who never took the deciding turn', () => {
    // Player 0 loses on their own turn-2 draw, so player 1 never takes turn 2.
    // Both sides are unsampled, but for different reasons - one ran out of
    // game, the other out of turns.
    const sevenCards = [forest(), forest(), forest(), forest(), bear(), bear(), bear()]

    const result = runGame(sevenCards, deckOf([], forest()), RIGGED_RNG)

    expect(result.manaScrew[1]).toBeNull()
    expect(result.curveHit[1]).toBeNull()
  })

  it('[R] reports mana screw for a player still under three lands on turn 4', () => {
    const oneLand = deckOf([forest(), bear(), bear(), bear(), bear(), bear(), bear()], bear())

    const result = runGame(oneLand, deckOf([], forest()), RIGGED_RNG)

    expect(result.manaScrew[0]).toBe(true)
    expect(result.manaScrew[1]).toBe(false)
  })
})

describe('effects that resolve during a turn', () => {
  /** A sorcery player 0 can cast off one Forest. */
  const spell = (id: string, ...effects: CardEffect[]): SimCard =>
    simCard({
      id,
      cardType: 'sorcery',
      cost: cost(0, { G: 1 }),
      power: 0,
      toughness: 0,
      effects,
    })

  /** Player 0 with one untapped Forest and `hand`, facing `opponentBoard`. */
  function castingState(hand: SimCard[], opponentBoard: Permanent[] = []) {
    const state = stateWith([permanent(forest())], opponentBoard)
    state.players[0].hand = hand
    return state
  }

  it('[R] puts a token onto the battlefield ready to attack', () => {
    const summon = spell('summon', {
      trigger: 'cast',
      action: { type: 'create_token', count: 2, power: 1, toughness: 1 },
    })
    const state = castingState([summon])

    runTurn(state, RIGGED_RNG)

    const tokens = state.players[0].battlefield.filter((p) => p.card.name === 'Token')
    expect(tokens).toHaveLength(2)
    expect(tokens.every((p) => !p.summoningSick)).toBe(true)
    // A token has no mana cost, so nothing can read its value off `cost`.
    expect(tokens.every((p) => p.card.cost === null)).toBe(true)
  })

  it('[R] mills the opponent from the top of their library', () => {
    const millSpell = spell('mill', { trigger: 'cast', action: { type: 'mill', count: 3 } })
    const state = castingState([millSpell])
    state.players[1].library = Array.from({ length: 5 }, (_, i) => forest(`card-${i}`))

    runTurn(state, RIGGED_RNG)

    expect(state.players[1].library.map((c) => c.id)).toEqual(['card-0', 'card-1'])
    expect(state.players[1].graveyard.map((c) => c.id)).toEqual(['card-4', 'card-3', 'card-2'])
  })

  it('[R] stops milling when the library runs out', () => {
    const millSpell = spell('mill', { trigger: 'cast', action: { type: 'mill', count: 9 } })
    const state = castingState([millSpell])
    state.players[1].library = [forest('only')]

    runTurn(state, RIGGED_RNG)

    expect(state.players[1].library).toEqual([])
    expect(state.players[1].graveyard.map((c) => c.id)).toEqual(['only'])
  })

  it('[R] bounces the most expensive creature the opponent has', () => {
    const bounce = spell('bounce', {
      trigger: 'cast',
      action: { type: 'bounce', target: 'creature' },
    })
    const cheap = permanent(simCard({ id: 'squire', cost: cost(0, { G: 1 }) }))
    const expensive = permanent(simCard({ id: 'angel', cost: cost(4, { G: 1 }) }))
    const state = castingState([bounce], [cheap, expensive])

    runTurn(state, RIGGED_RNG)

    expect(state.players[1].battlefield.map((p) => p.card.id)).toEqual(['squire'])
    expect(state.players[1].hand.map((c) => c.id)).toEqual(['angel'])
  })

  it('[R] destroys the biggest creature the opponent has', () => {
    const kill = spell('kill', {
      trigger: 'cast',
      action: { type: 'destroy', target: 'creature' },
    })
    const small = permanent(simCard({ id: 'squire', power: 1, toughness: 1 }))
    const big = permanent(simCard({ id: 'ogre', power: 5, toughness: 5 }))
    const state = castingState([kill], [small, big])

    runTurn(state, RIGGED_RNG)

    expect(state.players[1].graveyard.map((c) => c.id)).toEqual(['ogre'])
    expect(state.players[1].battlefield.map((p) => p.card.id)).toEqual(['squire'])
  })

  it('[R] leaves an indestructible creature alone', () => {
    const kill = spell('kill', {
      trigger: 'cast',
      action: { type: 'destroy', target: 'creature' },
    })
    const wall = permanent(
      simCard({ id: 'wall', power: 5, toughness: 5, keywords: new Set(['indestructible']) }),
    )
    const state = castingState([kill], [wall])

    runTurn(state, RIGGED_RNG)

    expect(state.players[1].battlefield.map((p) => p.card.id)).toEqual(['wall'])
  })

  it('[R] burns the opponent', () => {
    const bolt = spell('bolt', {
      trigger: 'cast',
      action: { type: 'damage', target: 'opponent', amount: 3 },
    })

    const state = castingState([bolt])
    runTurn(state, RIGGED_RNG)

    expect(state.players[1].life).toBe(17)
  })

  it('[R] gains life', () => {
    const heal = spell('heal', { trigger: 'cast', action: { type: 'gain_life', amount: 4 } })

    const state = castingState([heal])
    runTurn(state, RIGGED_RNG)

    expect(state.players[0].life).toBe(24)
  })

  it('[R] draws what is left rather than losing on an effect', () => {
    // Only a missed draw step loses the game. An effect that asks for more
    // cards than the library holds takes what there is.
    const dig = spell('dig', { trigger: 'cast', action: { type: 'draw', count: 3 } })
    const state = castingState([dig])
    state.players[0].library = [forest('last')]

    const outcome = runTurn(state, RIGGED_RNG)

    expect(outcome.kind).toBe('continue')
    expect(state.players[0].hand.map((c) => c.id)).toEqual(['last'])
  })
})

describe('the start of a turn', () => {
  it('[R] untaps, clears summoning sickness, and wipes damage', () => {
    // Both boards are walls, so nothing attacks and the only thing that moves
    // the damage counters is the untap step itself.
    const mine = permanent(
      simCard({ id: 'mine', power: 0, toughness: 3, keywords: new Set(['defender']) }),
      { tapped: true, summoningSick: true, damage: 2 },
    )
    const theirs = permanent(simCard({ id: 'wall', power: 0, toughness: 9 }), { damage: 4 })
    const state = stateWith([mine], [theirs])

    runTurn(state, RIGGED_RNG)

    expect(mine.tapped).toBe(false)
    expect(mine.summoningSick).toBe(false)
    expect(mine.damage).toBe(0)
    // Damage wears off on both boards, so a creature that survived last combat
    // does not carry the wound into this one.
    expect(theirs.damage).toBe(0)
  })

  it('[R] plays one land a turn and no more', () => {
    const state = stateWith([], [])
    state.players[0].hand = [forest('a'), forest('b'), forest('c')]

    runTurn(state, RIGGED_RNG)

    expect(state.players[0].battlefield).toHaveLength(1)
    expect(state.players[0].hand).toHaveLength(2)
  })
})

describe('the end of a turn', () => {
  /** An uncastable spell, so the hand survives the main phases intact. */
  const brick = (id: string, cmc: number) =>
    simCard({ id, cardType: 'sorcery', cost: cost(cmc), power: 0, toughness: 0 })

  it('[R] discards down to seven, most expensive first', () => {
    const state = stateWith([], [])
    // Turn 2 so the draw step runs - player 0 skips it only on turn 1.
    state.round = 2
    state.players[0].library = [brick('drawn', 1)]
    state.players[0].hand = [
      brick('one', 1),
      brick('nine', 9),
      brick('two', 2),
      brick('eight', 8),
      brick('three', 3),
      brick('four', 4),
      brick('five', 5),
      brick('six', 6),
    ]

    runTurn(state, RIGGED_RNG)

    expect(state.players[0].hand).toHaveLength(7)
    expect(state.players[0].graveyard.map((c) => c.id)).toEqual(['nine', 'eight'])
  })

  it('[R] leaves a hand of seven alone', () => {
    const state = stateWith([], [])
    state.players[0].hand = Array.from({ length: 7 }, (_, i) => brick(`brick-${i}`, 9))

    runTurn(state, RIGGED_RNG)

    expect(state.players[0].hand).toHaveLength(7)
    expect(state.players[0].graveyard).toEqual([])
  })
})

describe('runGame', () => {
  const bear = () => simCard({ id: 'bear', cost: cost(1, { G: 1 }), power: 2, toughness: 2 })
  const AGGRO = deckOf([forest(), forest(), forest(), bear(), bear(), bear(), bear()], bear())

  it('[R] leaves the deck arrays it was handed untouched', () => {
    // `runSimulation` replays the same two arrays thousands of times.
    const deckA = structuredClone(AGGRO)
    const deckB = deckOf([], forest())
    const before = [structuredClone(deckA), structuredClone(deckB)]

    runGame(deckA, deckB, RIGGED_RNG)

    expect(deckA).toEqual(before[0])
    expect(deckB).toEqual(before[1])
  })

  it('[R] reports a winner, a condition, and a round count that agree', () => {
    const result = runGame(AGGRO, deckOf([], forest()), RIGGED_RNG)

    expect(result.winner).toBe(0)
    expect(result.winCondition).toBe('life')
    expect(result.rounds).toBeGreaterThanOrEqual(1)
    expect(result.rounds).toBeLessThanOrEqual(MAX_ROUNDS)
  })

  it('[R] reports one flag per player for each mana metric', () => {
    const result = runGame(AGGRO, deckOf([], forest()), RIGGED_RNG)

    expect(result.manaScrew).toHaveLength(2)
    expect(result.manaFlood).toHaveLength(2)
    expect(result.curveHit).toHaveLength(2)
  })
})
