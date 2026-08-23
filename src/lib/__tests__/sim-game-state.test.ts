import { describe, expect, it } from 'vitest'
import { runGame, stateBasedActions } from '../simulation/game-state'
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
