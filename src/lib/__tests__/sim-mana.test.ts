import { describe, expect, it } from 'vitest'
import { manaSources, parseCost, parseLandColors, payCost } from '../simulation/mana'
import {
  cost,
  forest,
  land,
  permanent,
  simCard,
  sourceNames as names,
  sourcesOf,
} from './sim-fixtures'

describe('manaSources', () => {
  it('[R] reports one source per untapped land', () => {
    const battlefield = [permanent(forest('a')), permanent(forest('b'))]

    expect(names(manaSources(battlefield))).toEqual(['a', 'b'])
  })

  it('[R] skips tapped lands', () => {
    const battlefield = [
      permanent(forest('a'), { tapped: true }),
      permanent(forest('b')),
    ]

    expect(names(manaSources(battlefield))).toEqual(['b'])
  })

  it('[R] ignores non-land permanents', () => {
    const battlefield = [permanent(simCard({ id: 'bear' })), permanent(forest('a'))]

    expect(names(manaSources(battlefield))).toEqual(['a'])
  })

  it('[R] reports every color a land can produce', () => {
    const battlefield = [permanent(land('gainland', ['W', 'U'], false))]

    expect(manaSources(battlefield)[0].colors).toEqual(['W', 'U'])
  })

  it('[R] reports a colorless land as a source with no colors', () => {
    const battlefield = [permanent(land('waste', []))]

    expect(manaSources(battlefield)[0].colors).toEqual([])
  })
})

describe('payCost', () => {
  it('[R] pays a colored pip from a land that makes that color', () => {
    const sources = sourcesOf(land('mountain', ['R']), forest('a'))

    expect(names(payCost(sources, cost(0, { G: 1 })))).toEqual(['a'])
  })

  it('[R] refuses a color no land can make', () => {
    const sources = sourcesOf(forest('a'))

    expect(payCost(sources, cost(0, { U: 1 }))).toBeNull()
  })

  it('[R] refuses a cost the lands cannot cover', () => {
    const sources = sourcesOf(forest('a'))

    expect(payCost(sources, cost(2, { G: 1 }))).toBeNull()
  })

  it('[R] pays generic mana with any land', () => {
    const sources = sourcesOf(land('waste', []), forest('a'))

    expect(names(payCost(sources, cost(2)))?.sort()).toEqual(['a', 'waste'])
  })

  it('[R] taps a dual land for the color the cost asks for', () => {
    const sources = sourcesOf(land('gainland', ['W', 'U'], false))

    expect(names(payCost(sources, cost(0, { U: 1 })))).toEqual(['gainland'])
    expect(names(payCost(sources, cost(0, { W: 1 })))).toEqual(['gainland'])
  })

  it('[R] leaves a dual land to the pip only it can pay', () => {
    // Greedy assignment spends the dual on {G} and then has nothing for {U}.
    const sources = sourcesOf(forest('a'), land('gainland', ['G', 'U'], false))

    expect(names(payCost(sources, cost(0, { G: 1, U: 1 })))?.sort()).toEqual([
      'a',
      'gainland',
    ])
  })

  it('[R] spends the least flexible land on generic mana', () => {
    const sources = sourcesOf(land('gainland', ['W', 'U'], false), forest('a'))

    expect(names(payCost(sources, cost(1)))).toEqual(['a'])
  })

  it('[R] needs a separate source per pip of the same color', () => {
    expect(payCost(sourcesOf(land('dual', ['G', 'U'], false)), cost(0, { G: 2 }))).toBeNull()
  })

  it('[R] re-houses across a ring of duals', () => {
    // W/U, U/B, and B/W paying {W}{U}{B}: every pip displaces an earlier one.
    const sources = sourcesOf(
      land('wu', ['W', 'U'], false),
      land('ub', ['U', 'B'], false),
      land('bw', ['B', 'W'], false),
    )

    expect(names(payCost(sources, cost(0, { W: 1, U: 1, B: 1 })))?.sort()).toEqual([
      'bw',
      'ub',
      'wu',
    ])
  })

  it('[R] keeps a dual for its pip and pays the generic elsewhere', () => {
    const sources = sourcesOf(forest('a'), land('dual', ['G', 'U'], false))

    expect(names(payCost(sources, cost(1, { U: 1 })))?.sort()).toEqual(['a', 'dual'])
  })

  it('[R] leaves the sources it was handed alone', () => {
    const sources = sourcesOf(forest('a'), forest('b'))

    payCost(sources, cost(0, { G: 1 }))

    expect(names(sources)).toEqual(['a', 'b'])
  })
})

describe('parseLandColors', () => {
  it('[R] reads the colors of a basic land subtype', () => {
    expect(parseLandColors('', 'Basic Land — Forest')).toEqual(['G'])
    expect(parseLandColors('', 'Land — Plains Island')).toEqual(['W', 'U'])
  })

  it('[R] reads both colors of an "Add {W} or {U}" ability', () => {
    expect(parseLandColors('{T}: Add {W} or {U}.', 'Land')).toEqual(['W', 'U'])
  })

  it('[R] reads all three colors of a tri-land', () => {
    expect(parseLandColors('{T}: Add {W}, {U}, or {B}.', 'Land')).toEqual([
      'W',
      'U',
      'B',
    ])
  })

  it('[R] reads both colors of a filter land', () => {
    const text = '{1}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.'

    expect(parseLandColors(text, 'Land')).toEqual(['W', 'U'])
  })

  it('[R] reads each of several separate add abilities', () => {
    const text = '{T}: Add {C}.\n{T}, Pay 1 life: Add {B} or {R}.'

    expect(parseLandColors(text, 'Land')).toEqual(['B', 'R'])
  })

  it('[R] reads a land that adds one mana of any color as all five', () => {
    expect(parseLandColors('{T}: Add one mana of any color.', 'Land')).toEqual([
      'W',
      'U',
      'B',
      'R',
      'G',
    ])
  })

  it('[R] reads a land that adds any combination of colors as all five', () => {
    const text = '{4}, {T}: Add five mana in any combination of colors.'

    expect(parseLandColors(text, 'Land')).toEqual(['W', 'U', 'B', 'R', 'G'])
  })

  it('[R] reads a colorless land as producing no color', () => {
    expect(parseLandColors('{T}: Add {C}.', 'Land')).toEqual([])
  })

  it('[R] ignores color words outside the add ability', () => {
    const text = '{T}: Add {G}. {T}: Target creature gains {U} protection.'

    expect(parseLandColors(text, 'Land')).toEqual(['G'])
  })
})

describe('parseCost', () => {
  it('[R] reads an empty cost as free', () => {
    expect(parseCost('')).toEqual({ generic: 0, colored: {}, cmc: 0 })
  })

  it('[R] reads a generic-and-colored cost', () => {
    expect(parseCost('{2}{G}')).toEqual({ generic: 2, colored: { G: 1 }, cmc: 3 })
  })

  it('[R] counts repeated pips of the same color', () => {
    expect(parseCost('{G}{G}{G}')).toEqual({ generic: 0, colored: { G: 3 }, cmc: 3 })
  })

  it('[R] counts pips of several colors', () => {
    expect(parseCost('{1}{W}{U}')).toEqual({ generic: 1, colored: { W: 1, U: 1 }, cmc: 3 })
  })

  it('[R] reads a generic cost of ten as one symbol', () => {
    expect(parseCost('{10}')).toEqual({ generic: 10, colored: {}, cmc: 10 })
  })

  it('[R] counts X as zero', () => {
    // X is 0 everywhere except on the stack, and a card in hand or library is
    // the only place the sim reads a cost.
    expect(parseCost('{X}{R}')).toEqual({ generic: 0, colored: { R: 1 }, cmc: 1 })
  })

  it('[R] counts a Phyrexian pip as one mana of its color', () => {
    expect(parseCost('{2}{W/P}')).toEqual({ generic: 2, colored: { W: 1 }, cmc: 3 })
  })

  it('[R] counts a hybrid pip as one mana', () => {
    expect(parseCost('{W/U}').cmc).toBe(1)
  })

  it('[C] pins a hybrid pip to the first color it names', () => {
    // Issue #37.
    // A {W/U} spell is castable off either color, but the cost carries one W
    // pip, so a mono-blue board reads it as uncastable. Widening this means
    // `ManaCost.colored` growing a notion of alternatives - `payCost` matches
    // pips to sources, so the alternative belongs on the pip, not the source.
    expect(parseCost('{W/U}')).toEqual({ generic: 0, colored: { W: 1 }, cmc: 1 })
  })

  it('[C] reads a monocolor hybrid pip as costing one, not two', () => {
    // Issue #37.
    // {2/W} is "two generic or one white", and its mana value is 2. Reading it
    // as 1 makes such a card look a turn cheaper than it is, and the AI sorts
    // its casts by `cmc`. The `/P` branch runs first, then the generic `/`
    // branch takes the first part that names a color - the `2` is dropped.
    expect(parseCost('{2/W}')).toEqual({ generic: 0, colored: { W: 1 }, cmc: 1 })
  })

  it('[C] drops a colorless pip entirely', () => {
    // Issue #37.
    // {C} is one mana that only a colorless source can pay. It parses to
    // nothing, so an Eldrazi reads as free. Modelling it needs a colorless pip
    // in `ManaCost` and a matching branch in `payCost`.
    expect(parseCost('{2}{C}')).toEqual({ generic: 2, colored: {}, cmc: 2 })
  })

  it('[C] drops a snow pip entirely', () => {
    // Issue #37.
    // {S} is one mana from a snow source. Same shape of gap as {C}.
    expect(parseCost('{1}{S}')).toEqual({ generic: 1, colored: {}, cmc: 1 })
  })

  it('[R] ignores text outside the symbol braces', () => {
    expect(parseCost('2G')).toEqual({ generic: 0, colored: {}, cmc: 0 })
  })
})
