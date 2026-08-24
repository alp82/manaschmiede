/**
 * The two label tables that used to live in five component files.
 *
 * The tuple and its labels ship from one module each, so the thing these tests
 * guard is the join: a rarity or color with no label, or a label naming a key
 * the catalogs don't carry, is the failure the copies used to hide.
 */
import { describe, it, expect } from 'vitest'
import { RARITIES, RARITY_KEYS } from '../rarity'
import { COLOR_KEYS, MANA_COLORS, isManaColor } from '../mana-colors'
import { en } from '../i18n/en'

describe('RARITY_KEYS', () => {
  it('[R] labels every rarity', () => {
    expect(Object.keys(RARITY_KEYS).sort()).toEqual([...RARITIES].sort())
  })

  it('[R] names only keys the catalogs carry', () => {
    for (const key of Object.values(RARITY_KEYS)) {
      expect(en, key).toHaveProperty(key)
    }
  })
})

describe('COLOR_KEYS', () => {
  it('[R] labels every color', () => {
    expect(Object.keys(COLOR_KEYS).sort()).toEqual([...MANA_COLORS].sort())
  })

  it('[R] names only keys the catalogs carry', () => {
    for (const key of Object.values(COLOR_KEYS)) {
      expect(en, key).toHaveProperty(key)
    }
  })
})

describe('isManaColor', () => {
  it('[R] accepts each of the five colors', () => {
    for (const color of MANA_COLORS) {
      expect(isManaColor(color)).toBe(true)
    }
  })

  it('[R] rejects anything else Scryfall can put in a color list', () => {
    // Scryfall types `colors` as string[], and a colorless or unrecognised
    // entry is what `balance.ts` used to guard against with a table typed on
    // `string`.
    expect(isManaColor('C')).toBe(false)
    expect(isManaColor('')).toBe(false)
    expect(isManaColor('w')).toBe(false)
  })
})
