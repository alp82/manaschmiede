import { describe, expect, it } from 'vitest'
import { forecastCombat, resolveCombat } from '../simulation/combat'
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

  describe('first strike and double strike', () => {
    it('[R] lets a first-strike blocker hit a vanilla attacker', () => {
      // The first-strike step used to iterate attackers only, so a first-strike
      // blocker facing an attacker without first strike never got to swing.
      const attacker = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))
      const blocker = permanent(
        simCard({ id: 'knight', power: 3, toughness: 3, keywords: new Set(['first_strike']) }),
      )
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(attacker.damage).toBe(3)
      expect(attacker.markedForDeath).toBe(true)
      // The attacker died to first-strike damage, so it never deals its own.
      expect(blocker.damage).toBe(0)
    })

    it('[R] lets a surviving vanilla blocker hit back at a first-strike attacker', () => {
      // The attacker skipped the whole normal step, and the blocker retaliation
      // loop lived inside it - so the blocker never dealt damage.
      const attacker = permanent(
        simCard({ id: 'lancer', power: 2, toughness: 4, keywords: new Set(['first_strike']) }),
      )
      const blocker = permanent(simCard({ id: 'giant', power: 5, toughness: 5 }))
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(blocker.damage).toBe(2)
      expect(blocker.markedForDeath).toBe(false)
      expect(attacker.damage).toBe(5)
    })

    it('[R] trades two first strikers simultaneously', () => {
      const attacker = permanent(
        simCard({ id: 'knight-a', power: 2, toughness: 2, keywords: new Set(['first_strike']) }),
      )
      const blocker = permanent(
        simCard({ id: 'knight-b', power: 2, toughness: 2, keywords: new Set(['first_strike']) }),
      )
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(attacker.damage).toBe(2)
      expect(blocker.damage).toBe(2)
    })

    it('[R] trades two vanilla creatures simultaneously', () => {
      const attacker = permanent(simCard({ id: 'bear-a', power: 2, toughness: 2 }))
      const blocker = permanent(simCard({ id: 'bear-b', power: 2, toughness: 2 }))
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(attacker.damage).toBe(2)
      expect(blocker.damage).toBe(2)
    })

    it('[R] deals unblocked double-strike damage twice', () => {
      // The normal step re-checked "does this attacker have first strike?" and
      // skipped, so an unblocked double striker hit the player only once.
      const attacker = permanent(
        simCard({ id: 'twin', power: 2, toughness: 2, keywords: new Set(['double_strike']) }),
      )
      const state = stateWith([attacker], [])

      resolveCombat([0], new Map(), state)

      expect(state.players[1].life).toBe(16)
    })

    it('[R] gains life twice for an unblocked double-strike lifelinker', () => {
      const attacker = permanent(
        simCard({
          id: 'twin-cleric',
          power: 3,
          toughness: 3,
          keywords: new Set(['double_strike', 'lifelink']),
        }),
      )
      const state = stateWith([attacker], [])

      resolveCombat([0], new Map(), state)

      expect(state.players[1].life).toBe(14)
      expect(state.players[0].life).toBe(26)
    })

    it('[R] lets a blocked double striker deal damage in both steps', () => {
      const attacker = permanent(
        simCard({ id: 'twin', power: 2, toughness: 4, keywords: new Set(['double_strike']) }),
      )
      const blocker = permanent(simCard({ id: 'wall', power: 1, toughness: 5 }))
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(blocker.damage).toBe(4)
      expect(attacker.damage).toBe(1)
    })

    it('[R] stops a first striker that died in the first-strike step', () => {
      // A 2/2 double-striking blocker kills a 3/2 attacker in the first-strike
      // step. The attacker deals no damage at all, and the blocker has nothing
      // left to hit in the normal step.
      const attacker = permanent(simCard({ id: 'brute', power: 3, toughness: 2 }))
      const blocker = permanent(
        simCard({ id: 'twin', power: 2, toughness: 2, keywords: new Set(['double_strike']) }),
      )
      const state = stateWith([attacker], [blocker])

      resolveCombat([0], new Map([[0, [0]]]), state)

      expect(attacker.markedForDeath).toBe(true)
      expect(attacker.damage).toBe(2)
      expect(blocker.damage).toBe(0)
    })
  })
})

describe('forecastCombat', () => {
  it('[R] reports damage without touching the real battlefields', () => {
    const bear = permanent(simCard({ id: 'bear', power: 2, toughness: 2 }))

    const forecast = forecastCombat([0], new Map(), [bear], [])

    expect(forecast.defenderLifeChange).toBe(-2)
    expect(forecast.attackersLost).toEqual([])
    expect(forecast.blockersLost).toEqual([])
    expect(bear.tapped).toBe(false)
  })

  it('[R] reports both creatures lost on an even trade', () => {
    const attacker = permanent(simCard({ id: 'attacker', power: 2, toughness: 2 }))
    const blocker = permanent(simCard({ id: 'blocker', power: 2, toughness: 2 }))

    const forecast = forecastCombat([0], new Map([[0, [0]]]), [attacker], [blocker])

    expect(forecast.defenderLifeChange).toBe(0)
    expect(forecast.attackersLost.map((p) => p.card.id)).toEqual(['attacker'])
    expect(forecast.blockersLost.map((p) => p.card.id)).toEqual(['blocker'])
  })

  it('[R] counts the life a lifelink attacker gains', () => {
    const vampire = permanent(
      simCard({ id: 'vampire', power: 3, toughness: 3, keywords: new Set(['lifelink']) }),
    )

    const forecast = forecastCombat([0], new Map(), [vampire], [])

    expect(forecast.attackerLifeChange).toBe(3)
    expect(forecast.defenderLifeChange).toBe(-3)
  })

  it('[R] sends trample damage past the blocker it kills', () => {
    const giant = permanent(
      simCard({ id: 'giant', power: 6, toughness: 6, keywords: new Set(['trample']) }),
    )
    const chump = permanent(simCard({ id: 'chump', power: 1, toughness: 1 }))

    const forecast = forecastCombat([0], new Map([[0, [0]]]), [giant], [chump])

    expect(forecast.defenderLifeChange).toBe(-5)
    expect(forecast.blockersLost.map((p) => p.card.id)).toEqual(['chump'])
    expect(forecast.attackersLost).toEqual([])
  })
})
