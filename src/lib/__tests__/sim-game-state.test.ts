import { describe, expect, it } from 'vitest'
import { runGame, runTurn, stateBasedActions } from '../simulation/game-state'
import type { CardEffect, SimCard } from '../simulation/types'
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
    expect(result.turns).toBeLessThan(10)
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
