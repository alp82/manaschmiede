import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCardPoolBlock } from '../generateDeck'
import { HARD_FILTER_SCRYFALL_QUERY } from '../lib/cardFilters'

/**
 * The card pool is the block of real card names the model is told to prefer.
 * It used to be built from unfiltered Scryfall, so it could offer the model
 * exactly the cards the app rejects downstream - burning a retry each time.
 */

/** A Scryfall search hit, with the hard-filter fields it really carries. */
function hit(overrides: Record<string, unknown>) {
  return {
    oracle_text: '',
    cmc: 2,
    color_identity: ['U'],
    layout: 'normal',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    set_type: 'core',
    legalities: { modern: 'legal' },
    games: ['paper'],
    ...overrides,
  }
}

const JACE = hit({
  name: 'Jace Beleren',
  type_line: 'Legendary Planeswalker — Jace',
  mana_cost: '{1}{U}{U}',
  cmc: 3,
})

const COUNTERSPELL = hit({
  name: 'Counterspell',
  type_line: 'Instant',
  mana_cost: '{U}{U}',
})

/**
 * Stands in for a Scryfall that ignored the filter in the query, so what the
 * pool does about it is the pass in `scryfallSearch`, not the fake's courtesy.
 */
function fakeScryfall() {
  const queries: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    queries.push(new URL(url).searchParams.get('q') ?? '')
    return { ok: true, json: async () => ({ data: [JACE, COUNTERSPELL] }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return { queries }
}

describe('buildCardPoolBlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks Scryfall for the hard filter, over the whole query', async () => {
    const { queries } = fakeScryfall()
    await buildCardPoolBlock(['t:elf OR t:goblin'], 50)
    expect(queries).toHaveLength(1)
    // Parenthesized: Scryfall binds implicit AND tighter than OR, so an
    // unparenthesized left branch would escape the filter entirely.
    expect(queries[0]).toBe(`(t:elf OR t:goblin) ${HARD_FILTER_SCRYFALL_QUERY}`)
  })

  it('offers the model no planeswalker even when Scryfall returns one', async () => {
    fakeScryfall()
    const pool = await buildCardPoolBlock(['c:u'], 50)
    expect(pool.block).toContain('Counterspell')
    expect(pool.block).not.toContain('Jace Beleren')
    expect(pool.cardTypes).not.toHaveProperty('Jace Beleren')
  })

  it('returns an empty pool for no queries without calling Scryfall', async () => {
    const { queries } = fakeScryfall()
    const pool = await buildCardPoolBlock([], 50)
    expect(pool).toEqual({ block: '', cardTypes: {} })
    expect(queries).toHaveLength(0)
  })
})
