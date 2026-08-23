import { describe, expect, it } from 'vitest'
import { resolveCombat } from '../simulation/combat'
import { nonCreature, permanent, simCard, stateWith } from './sim-fixtures'

describe('resolveCombat', () => {
  it('[R] leaves non-creature permanents alive through the first-strike step', () => {
    // The first-strike damage step runs its own SBA sweep over both boards.
    // Gated on `cardType !== 'land'`, it marked every 0/0 artifact, enchantment,
    // and planeswalker for death as soon as any first striker attacked.
    const attacker = permanent(
      simCard({ id: 'knight', power: 2, toughness: 2, keywords: new Set(['first_strike']) }),
    )
    const rock = permanent(nonCreature('rock', 'artifact'))
    const shrine = permanent(nonCreature('shrine', 'enchantment'))
    const state = stateWith([attacker, rock], [shrine])

    resolveCombat([0], new Map(), state)

    expect(rock.markedForDeath).toBe(false)
    expect(shrine.markedForDeath).toBe(false)
    expect(state.players[1].life).toBe(18)
  })

  it('[R] still marks a blocker that took lethal first-strike damage', () => {
    const attacker = permanent(
      simCard({ id: 'knight', power: 3, toughness: 3, keywords: new Set(['first_strike']) }),
    )
    const blocker = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))
    const state = stateWith([attacker], [blocker])

    resolveCombat([0], new Map([[0, [0]]]), state)

    expect(blocker.markedForDeath).toBe(true)
    expect(attacker.damage).toBe(0)
  })
})
