/**
 * Scryfall query assembly for the card browser.
 *
 * This used to live inside `CardSearch`, reachable only by rendering it. It is
 * now a pure function over a decoded state, so the exact query a given URL
 * produces is pinned here - including the color block's two forms, which stay
 * outside the filter registry because ALL vs ANY is a mode between values
 * rather than a value.
 */
import { describe, it, expect } from 'vitest'
import {
  buildScryfallQuery,
  decodeColors,
  decodeFilterState,
  encodeColors,
  hasAnyFilter,
  neutralFilterState,
} from '../../components/card-filters'
import type { RawFilterParams } from '../../components/card-filters/params'
import type { ManaColor } from '../mana-colors'

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

function query(input: {
  search?: string
  colors?: string
  colorMode?: 'all' | 'any'
  params?: Partial<RawFilterParams>
}): string {
  return buildScryfallQuery({
    search: input.search ?? '',
    colors: decodeColors(input.colors ?? ''),
    colorMode: input.colorMode ?? 'all',
    filters: decodeFilterState({ ...NEUTRAL_PARAMS, ...input.params }),
  })
}

describe('buildScryfallQuery', () => {
  it('[R] is empty when nothing is set, which is what suppresses the request', () => {
    expect(query({})).toBe('')
  })

  it('[R] searches name and oracle text together', () => {
    expect(query({ search: 'bolt' })).toBe('(bolt or o:bolt)')
  })

  it('[R] strips parentheses out of free text so they cannot break the grouping', () => {
    expect(query({ search: 'ajani (x)' })).toBe('(ajani x or o:ajani x)')
  })

  it('[R] reads ALL as "contains every selected color"', () => {
    expect(query({ colors: 'WU', colorMode: 'all' })).toBe('c>=wu')
  })

  it('[R] reads ANY as an OR chain, since Scryfall has no "any of" operator', () => {
    expect(query({ colors: 'WU', colorMode: 'any' })).toBe('(c:w OR c:u)')
  })

  it('[R] ignores a color mode when no color is picked', () => {
    expect(query({ colors: '', colorMode: 'any' })).toBe('')
  })

  it('[R] puts search first, then colors, then the filters in rank order', () => {
    expect(
      query({
        search: 'angel',
        colors: 'W',
        params: {
          type: 'creature',
          cmc: '4',
          rarity: 'rm',
          keyword: 'flying',
          bmin: 1,
          bmax: 20,
          pmin: 3,
          tmax: 5,
          set: 'DSK',
        },
      }),
    ).toBe(
      '(angel or o:angel) c>=w t:creature cmc=4 usd>=1.00 usd<=20.00 ' +
        '(r:rare OR r:mythic) keyword:flying pow>=3 tou<=5 s:dsk',
    )
  })
})

describe('color codec', () => {
  it('[R] round-trips a color selection', () => {
    expect(encodeColors(decodeColors('gw'))).toBe('GW')
  })

  it('[R] sorts, so the same selection always yields the same URL', () => {
    expect(encodeColors(new Set<ManaColor>(['U', 'B', 'G']))).toBe('BGU')
  })

  it('[R] ignores letters that are not colors', () => {
    expect(Array.from(decodeColors('WxU'))).toEqual(['W', 'U'])
  })
})

describe('hasAnyFilter', () => {
  it('[R] is false for an untouched browser', () => {
    expect(hasAnyFilter(new Set(), neutralFilterState())).toBe(false)
  })

  it('[R] counts a color selection', () => {
    expect(hasAnyFilter(decodeColors('R'), neutralFilterState())).toBe(true)
  })

  it('[R] counts a filter that narrows nothing but is visibly set', () => {
    const allRarities = decodeFilterState({ ...NEUTRAL_PARAMS, rarity: 'curm' })

    expect(hasAnyFilter(new Set(), allRarities)).toBe(true)
  })

  it('[R] counts every filter, including one bound of a range', () => {
    for (const params of [
      { type: 'land' },
      { cmc: '0' },
      { keyword: 'ward' },
      { rarity: 'c' },
      { bmax: 1 },
      { tmin: 1 },
      { set: 'dsk' },
    ]) {
      expect(hasAnyFilter(new Set(), decodeFilterState({ ...NEUTRAL_PARAMS, ...params }))).toBe(true)
    }
  })
})
