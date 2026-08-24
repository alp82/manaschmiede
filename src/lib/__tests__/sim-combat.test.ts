import { describe, expect, it } from 'vitest'
import {
  canBlock,
  damageToCreature,
  forecastCombat,
  killedBeforeDealingDamage,
  lethalDamage,
  resolveCombat,
} from '../simulation/combat'
import type { Keyword } from '../simulation/types'
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

describe('canBlock', () => {
  const ground = () => permanent(simCard({ id: 'ground', power: 2, toughness: 2 }))
  const withKeyword = (id: string, ...keywords: Keyword[]) =>
    permanent(simCard({ id, power: 2, toughness: 2, keywords: new Set(keywords) }))

  it('[R] stops a ground creature from blocking a flier', () => {
    expect(canBlock(ground(), withKeyword('drake', 'flying'))).toBe(false)
  })

  it('[R] lets a flier block a flier', () => {
    expect(canBlock(withKeyword('hawk', 'flying'), withKeyword('drake', 'flying'))).toBe(true)
  })

  it('[R] lets reach block a flier', () => {
    expect(canBlock(withKeyword('spider', 'reach'), withKeyword('drake', 'flying'))).toBe(true)
  })

  it('[R] lets a flier block a ground creature', () => {
    expect(canBlock(withKeyword('hawk', 'flying'), ground())).toBe(true)
  })

  it('[R] lets a tapped creature block', () => {
    // Tapped blockers are filtered out by `chooseBlockers`, not here. Anything
    // reading `canBlock` as the whole legality check will let one through.
    expect(canBlock(permanent(ground().card, { tapped: true }), ground())).toBe(true)
  })

  /**
   * Every keyword the model has, and whether `canBlock` reads it on the
   * *attacker* as evasion. Flying is the only one.
   *
   * The type is the point: this is a full `Record<Keyword, boolean>`, so a
   * keyword added to `Keyword` fails to compile until it is classified here.
   * A future evasion keyword gets a home rather than passing unnoticed.
   */
  const IS_EVASION: Record<Keyword, boolean> = {
    flying: true,
    // Enforced by `chooseBlockers`, which needs two blockers before it assigns
    // any - `canBlock` is asked about one blocker at a time and can't see that.
    menace: false,
    // Answers flying on the blocker; on an attacker it means nothing.
    reach: false,
    first_strike: false,
    double_strike: false,
    deathtouch: false,
    trample: false,
    lifelink: false,
    vigilance: false,
    indestructible: false,
    // Keeps a creature from attacking, never from blocking.
    defender: false,
    haste: false,
    flash: false,
    hexproof: false,
  }

  const keywordsWhere = (evasive: boolean) =>
    (Object.entries(IS_EVASION) as Array<[Keyword, boolean]>)
      .filter(([, isEvasion]) => isEvasion === evasive)
      .map(([keyword]) => keyword)

  it.each(keywordsWhere(true))(
    '[R] keeps a ground creature from blocking a %s attacker',
    (keyword) => {
      expect(canBlock(ground(), withKeyword('attacker', keyword))).toBe(false)
    },
  )

  it.each(keywordsWhere(false))(
    '[R] lets a ground creature block a %s attacker',
    (keyword) => {
      expect(canBlock(ground(), withKeyword('attacker', keyword))).toBe(true)
    },
  )

  it('[R] lets a defender block', () => {
    expect(canBlock(withKeyword('wall', 'defender'), ground())).toBe(true)
  })
})

describe('damageToCreature', () => {
  it('[R] is the power of a creature without deathtouch', () => {
    expect(damageToCreature(permanent(simCard({ id: 'bear', power: 2, toughness: 2 })))).toBe(2)
  })

  it('[R] exceeds any toughness the model can hold for a deathtouch creature', () => {
    // Deathtouch is damage here, not a flag `isDestroyedBySba` reads, so the
    // number has to out-run the largest printed toughness. The three callers -
    // `killedBeforeDealingDamage`, `damageStep`, and the AI's `blockersKill` -
    // all price a kill through this one function so they can't disagree.
    const mouse = permanent(
      simCard({ id: 'mouse', power: 1, toughness: 1, keywords: new Set<Keyword>(['deathtouch']) }),
    )

    expect(damageToCreature(mouse)).toBeGreaterThan(100)
  })
})

describe('lethalDamage', () => {
  const bear = (toughness: number) => simCard({ id: 'bear', power: 2, toughness })

  it('[R] is the blocker toughness for a plain attacker', () => {
    expect(lethalDamage(permanent(bear(2)), permanent(bear(4)))).toBe(4)
  })

  it('[R] subtracts damage the blocker already has', () => {
    expect(lethalDamage(permanent(bear(2)), permanent(bear(4), { damage: 3 }))).toBe(1)
  })

  it('[R] never goes below zero', () => {
    expect(lethalDamage(permanent(bear(2)), permanent(bear(2), { damage: 9 }))).toBe(0)
  })

  it('[R] is one for a deathtouch attacker', () => {
    // This is what lets a deathtouch trampler send the rest at the player.
    const serpent = simCard({
      id: 'serpent',
      power: 9,
      toughness: 9,
      keywords: new Set<Keyword>(['deathtouch']),
    })

    expect(lethalDamage(permanent(serpent), permanent(bear(8)))).toBe(1)
  })
})

describe('killedBeforeDealingDamage', () => {
  const attacker = (toughness: number, ...keywords: Keyword[]) =>
    permanent(simCard({ id: 'attacker', power: 3, toughness, keywords: new Set(keywords) }))
  const blocker = (power: number, ...keywords: Keyword[]) =>
    permanent(simCard({ id: 'blocker', power, toughness: 2, keywords: new Set(keywords) }))

  it('[R] reports a first-strike blocker that kills the attacker outright', () => {
    expect(killedBeforeDealingDamage(attacker(2), [blocker(2, 'first_strike')])).toBe(true)
  })

  it('[R] reports a double-strike blocker the same way', () => {
    expect(killedBeforeDealingDamage(attacker(2), [blocker(2, 'double_strike')])).toBe(true)
  })

  it('[R] ignores a blocker without first strike', () => {
    // A vanilla blocker deals its damage in the same step the attacker does,
    // so the attacker still connects.
    expect(killedBeforeDealingDamage(attacker(2), [blocker(9)])).toBe(false)
  })

  it('[R] spares an attacker that fights in the first-strike step itself', () => {
    expect(killedBeforeDealingDamage(attacker(2, 'first_strike'), [blocker(9, 'first_strike')]))
      .toBe(false)
    expect(killedBeforeDealingDamage(attacker(2, 'double_strike'), [blocker(9, 'first_strike')]))
      .toBe(false)
  })

  it('[R] adds up several first strikers', () => {
    expect(killedBeforeDealingDamage(attacker(4), [blocker(2, 'first_strike')])).toBe(false)
    expect(
      killedBeforeDealingDamage(attacker(4), [
        blocker(2, 'first_strike'),
        blocker(2, 'first_strike'),
      ]),
    ).toBe(true)
  })

  it('[R] counts a first-striking deathtouch blocker as lethal at any power', () => {
    expect(killedBeforeDealingDamage(attacker(20), [blocker(0, 'first_strike', 'deathtouch')]))
      .toBe(true)
  })

  it('[R] counts damage the attacker already has', () => {
    const wounded = permanent(simCard({ id: 'wounded', power: 3, toughness: 4 }), { damage: 3 })

    expect(killedBeforeDealingDamage(wounded, [blocker(1, 'first_strike')])).toBe(true)
  })
})
