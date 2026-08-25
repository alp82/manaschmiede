/**
 * The card browser's filter registry.
 *
 * The registry exists so that adding a filter is one entry file instead of 22
 * edits, three of which used to fail silently. These tests cover the two halves
 * that used to be untestable because they only existed inside components: each
 * entry's URL codec, and the invariants that hold the registry together.
 */
import { describe, it, expect } from 'vitest'
import {
  FILTERS,
  addFilterPatch,
  clearFiltersPatch,
  decodeActiveFilters,
  decodeFilterState,
  encodeActiveFilters,
  filterById,
  filterResetPatch,
  filtersInQueryOrder,
  isFilterId,
  neutralFilterState,
  removeFilterPatch,
  type FilterId,
} from '../../components/card-filters'
import { filterParsers } from '../../components/card-filters/params'
import type { RawFilterParams } from '../../components/card-filters/params'
import { decodeRarities, encodeRarities } from '../../components/card-filters/entries/rarity'
import { RARITIES } from '../rarity'
import { en } from '../i18n/en'

const NEUTRAL_PARAMS: RawFilterParams = {
  type: '',
  cmc: '',
  rarity: '',
  keyword: '',
  bmin: null,
  bmax: null,
  pmin: null,
  pmax: null,
  tmin: null,
  tmax: null,
  set: '',
}

function raw(overrides: Partial<RawFilterParams> = {}): RawFilterParams {
  return { ...NEUTRAL_PARAMS, ...overrides }
}

describe('registry invariants', () => {
  it('[R] gives every filter a unique id', () => {
    const ids = FILTERS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('[R] gives every filter a unique query rank', () => {
    const ranks = FILTERS.map((f) => f.queryRank)
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it('[R] gives every param an owner, and no param two owners', () => {
    const owned = FILTERS.flatMap((f) => f.params)
    expect(new Set(owned).size).toBe(owned.length)
    expect([...owned].sort()).toEqual(Object.keys(filterParsers).sort())
  })

  it('[R] carries translations for every label it renders', () => {
    for (const filter of FILTERS) {
      expect(en[filter.labelKey], filter.id).toBeTruthy()
      expect(en[filter.ariaLabelKey], filter.id).toBeTruthy()
    }
  })

  it('[R] orders the query by rank, which is not the picker order', () => {
    expect(FILTERS.map((f) => f.id)).toEqual([
      'type',
      'cmc',
      'keyword',
      'rarity',
      'budget',
      'stats',
      'set',
    ])
    expect(filtersInQueryOrder().map((f) => f.id)).toEqual([
      'type',
      'cmc',
      'budget',
      'rarity',
      'keyword',
      'stats',
      'set',
    ])
  })

  it('[R] leaves every filter neutral and inactive for an empty URL', () => {
    const state = decodeFilterState(raw())

    expect(state).toEqual(neutralFilterState())
    for (const filter of FILTERS) {
      expect(filter.isActive(state), filter.id).toBe(false)
      expect(filter.toQuery(state), filter.id).toEqual([])
    }
  })
})

describe('decode / encode round-trip', () => {
  const cases: { id: FilterId; params: Partial<RawFilterParams> }[] = [
    { id: 'type', params: { type: 'creature' } },
    { id: 'cmc', params: { cmc: '7+' } },
    { id: 'keyword', params: { keyword: 'flying' } },
    { id: 'rarity', params: { rarity: 'rm' } },
    { id: 'budget', params: { bmin: 5, bmax: 40 } },
    { id: 'stats', params: { pmin: 2, pmax: 6, tmin: 1, tmax: 4 } },
    { id: 'set', params: { set: 'dsk' } },
  ]

  for (const { id, params } of cases) {
    it(`[R] round-trips ${id} through the URL`, () => {
      const filter = filterById(id)
      const state = decodeFilterState(raw(params))

      expect(filter.encode(filter.decode(raw(params)))).toEqual(params)
      expect(filter.isActive(state)).toBe(true)
    })

    it(`[R] encodes a neutral ${id} back to nulls, not empty strings`, () => {
      const filter = filterById(id)

      const patch = filter.encode(filter.decode(raw()))

      expect(Object.keys(patch).sort()).toEqual([...filter.params].sort())
      expect(Object.values(patch).every((v) => v === null)).toBe(true)
    })
  }

  it('[R] drops rarity letters it does not know', () => {
    expect(Array.from(decodeRarities('rxm'))).toEqual(['rare', 'mythic'])
  })

  it('[R] keeps the rarity initials unique, which is what lets them be derived', () => {
    const initials = RARITIES.map((r) => r[0])
    expect(new Set(initials).size).toBe(RARITIES.length)
    expect(encodeRarities(new Set(RARITIES))).toBe('curm')
  })
})

describe('toQuery', () => {
  function fragmentsFor(params: Partial<RawFilterParams>): string[] {
    const state = decodeFilterState(raw(params))
    return filtersInQueryOrder().flatMap((f) => f.toQuery(state))
  }

  it('[R] emits a plain type term', () => {
    expect(fragmentsFor({ type: 'creature' })).toEqual(['t:creature'])
  })

  it('[R] turns the open-ended mana bucket into a range', () => {
    expect(fragmentsFor({ cmc: '7+' })).toEqual(['cmc>=7'])
    expect(fragmentsFor({ cmc: '3' })).toEqual(['cmc=3'])
  })

  it('[R] prices budget bounds to two decimals, as Scryfall wants', () => {
    expect(fragmentsFor({ bmin: 5, bmax: 40 })).toEqual(['usd>=5.00', 'usd<=40.00'])
    expect(fragmentsFor({ bmax: 3 })).toEqual(['usd<=3.00'])
  })

  it('[R] ORs a partial rarity selection', () => {
    expect(fragmentsFor({ rarity: 'rm' })).toEqual(['(r:rare OR r:mythic)'])
  })

  it('[R] emits nothing when every rarity is selected, because that narrows nothing', () => {
    const state = decodeFilterState(raw({ rarity: 'curm' }))

    expect(filterById('rarity').toQuery(state)).toEqual([])
    expect(filterById('rarity').isActive(state)).toBe(true)
  })

  it('[R] emits a keyword term', () => {
    expect(fragmentsFor({ keyword: 'first_strike' })).toEqual(['keyword:first_strike'])
  })

  it('[R] emits power and toughness bounds independently', () => {
    expect(fragmentsFor({ pmin: 2, tmax: 4 })).toEqual(['pow>=2', 'tou<=4'])
    expect(fragmentsFor({ pmin: 2, pmax: 6, tmin: 1, tmax: 4 })).toEqual([
      'pow>=2',
      'pow<=6',
      'tou>=1',
      'tou<=4',
    ])
  })

  it('[R] lowercases the set code', () => {
    expect(fragmentsFor({ set: 'DSK' })).toEqual(['s:dsk'])
  })
})

describe('the `filters` param', () => {
  it('[R] keeps the order the user added filters in', () => {
    const value = 'stats,type'

    expect(Array.from(decodeActiveFilters(value))).toEqual(['stats', 'type'])
    expect(encodeActiveFilters(decodeActiveFilters(value))).toBe(value)
  })

  it('[R] drops ids the registry no longer knows, so old links still open', () => {
    expect(Array.from(decodeActiveFilters('type,format,set'))).toEqual(['type', 'set'])
    expect(isFilterId('format')).toBe(false)
  })

  it('[R] strips the param rather than writing an empty one', () => {
    expect(encodeActiveFilters(new Set())).toBeNull()
    expect(decodeActiveFilters('')).toEqual(new Set())
  })
})

describe('reset patches', () => {
  it('[R] nulls exactly the params a filter owns', () => {
    expect(filterResetPatch('stats')).toEqual({ pmin: null, pmax: null, tmin: null, tmax: null })
    expect(filterResetPatch('budget')).toEqual({ bmin: null, bmax: null })
    expect(filterResetPatch('type')).toEqual({ type: null })
  })

  it('[R] shows a filter without touching any value', () => {
    expect(addFilterPatch(new Set<FilterId>(['type']), 'set')).toEqual({ filters: 'type,set' })
  })

  it('[R] hides a filter and clears what it owned', () => {
    const patch = removeFilterPatch(new Set<FilterId>(['type', 'stats']), 'stats')

    expect(patch).toEqual({
      pmin: null,
      pmax: null,
      tmin: null,
      tmax: null,
      filters: 'type',
    })
  })

  it('[R] clears every active filter at once', () => {
    const patch = clearFiltersPatch(new Set<FilterId>(['budget', 'set']))

    expect(patch).toEqual({ filters: null, bmin: null, bmax: null, set: null })
  })

  it('[R] leaves an inactive filter alone when clearing', () => {
    expect(clearFiltersPatch(new Set<FilterId>(['type']))).not.toHaveProperty('bmin')
  })
})
