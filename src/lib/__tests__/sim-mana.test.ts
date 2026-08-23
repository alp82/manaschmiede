import { describe, expect, it } from 'vitest'
import { emptyPool, poolFromLands, poolSpent, tapSpentLands } from '../simulation/mana'
import type { ManaPool } from '../simulation/types'
import { forest, land, permanent, simCard } from './sim-fixtures'

function pool(colors: Partial<ManaPool['colors']>, colorless = 0): ManaPool {
  return { colors: { ...emptyPool().colors, ...colors }, colorless }
}

describe('poolFromLands', () => {
  it('[R] counts one mana per untapped land', () => {
    const battlefield = [permanent(forest('a')), permanent(forest('b'))]

    expect(poolFromLands(battlefield)).toEqual(pool({ G: 2 }))
  })

  it('[R] skips tapped lands', () => {
    const battlefield = [
      permanent(forest('a'), { tapped: true }),
      permanent(forest('b')),
    ]

    expect(poolFromLands(battlefield)).toEqual(pool({ G: 1 }))
  })

  it('[R] counts a colorless land as colorless mana', () => {
    const battlefield = [permanent(land('waste', []))]

    expect(poolFromLands(battlefield)).toEqual(pool({}, 1))
  })

  it('[R] ignores non-land permanents', () => {
    const battlefield = [permanent(simCard({ id: 'bear' })), permanent(forest('a'))]

    expect(poolFromLands(battlefield)).toEqual(pool({ G: 1 }))
  })
})

describe('poolSpent', () => {
  it('[R] reports the difference between the two pools', () => {
    const before = pool({ G: 2, R: 1 }, 2)
    const after = pool({ G: 1, R: 1 }, 0)

    expect(poolSpent(before, after)).toEqual(pool({ G: 1 }, 2))
  })

  it('[R] reports nothing when the pool is untouched', () => {
    const before = pool({ G: 2 }, 1)

    expect(poolSpent(before, before)).toEqual(emptyPool())
  })
})

describe('tapSpentLands', () => {
  it('[R] taps one land per mana spent', () => {
    const battlefield = [permanent(forest('a')), permanent(forest('b'))]

    tapSpentLands(battlefield, pool({ G: 1 }))

    expect(battlefield.map((p) => p.tapped)).toEqual([true, false])
  })

  it('[R] leaves every land untapped when nothing was spent', () => {
    const battlefield = [permanent(forest('a')), permanent(forest('b'))]

    tapSpentLands(battlefield, emptyPool())

    expect(battlefield.map((p) => p.tapped)).toEqual([false, false])
  })

  it('[R] taps the land that produced the spent color', () => {
    const battlefield = [permanent(land('mountain', ['R'])), permanent(forest('a'))]

    tapSpentLands(battlefield, pool({ G: 1 }))

    expect(battlefield.map((p) => p.tapped)).toEqual([false, true])
  })

  it('[R] never counts an already-tapped land toward the spend', () => {
    const battlefield = [
      permanent(forest('a'), { tapped: true }),
      permanent(forest('b')),
    ]

    tapSpentLands(battlefield, pool({ G: 1 }))

    expect(battlefield.map((p) => p.tapped)).toEqual([true, true])
  })

  it('[R] taps colorless and colored sources for their own mana', () => {
    const battlefield = [permanent(forest('a')), permanent(land('waste', []))]

    tapSpentLands(battlefield, pool({}, 1))

    expect(battlefield.map((p) => p.tapped)).toEqual([false, true])
  })
})
