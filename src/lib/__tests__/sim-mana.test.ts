import { describe, expect, it } from 'vitest'
import {
  manaSources,
  missingColors,
  parseCost,
  parseLandColors,
  payCost,
} from '../simulation/mana'
import type { ManaColor } from '../simulation/types'
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
  const colorPip = (...colors: ManaColor[]) => ({ kind: 'color', colors })

  it('[R] reads an empty cost as free', () => {
    expect(parseCost('')).toEqual({ generic: 0, pips: [], cmc: 0 })
  })

  it('[R] reads a generic-and-colored cost', () => {
    expect(parseCost('{2}{G}')).toEqual({ generic: 2, pips: [colorPip('G')], cmc: 3 })
  })

  it('[R] counts repeated pips of the same color', () => {
    expect(parseCost('{G}{G}{G}')).toEqual({
      generic: 0,
      pips: [colorPip('G'), colorPip('G'), colorPip('G')],
      cmc: 3,
    })
  })

  it('[R] counts pips of several colors', () => {
    expect(parseCost('{1}{W}{U}')).toEqual({
      generic: 1,
      pips: [colorPip('W'), colorPip('U')],
      cmc: 3,
    })
  })

  it('[R] reads a generic cost of ten as one symbol', () => {
    expect(parseCost('{10}')).toEqual({ generic: 10, pips: [], cmc: 10 })
  })

  it('[R] counts X as zero', () => {
    // X is 0 everywhere except on the stack, and a card in hand or library is
    // the only place the sim reads a cost.
    expect(parseCost('{X}{R}')).toEqual({ generic: 0, pips: [colorPip('R')], cmc: 1 })
  })

  it('[R] counts a Phyrexian pip as one mana of its color', () => {
    // Paying two life instead isn't modelled, so the mana half is the whole
    // card as far as the sim is concerned.
    expect(parseCost('{2}{W/P}')).toEqual({ generic: 2, pips: [colorPip('W')], cmc: 3 })
  })

  it('[R] counts a hybrid pip as one mana', () => {
    expect(parseCost('{W/U}').cmc).toBe(1)
  })

  it('[R] reads a hybrid pip as payable by either color', () => {
    // Issue #37. The pip carries the alternative, because a count per color
    // cannot say "either".
    expect(parseCost('{W/U}')).toEqual({ generic: 0, pips: [colorPip('W', 'U')], cmc: 1 })
  })

  it('[R] reads a monocolor hybrid pip as one colored or two generic', () => {
    // Issue #37. {2/W} has a mana value of 2, and the AI sorts its casts by
    // `cmc` - reading it as 1 made the card look a turn cheaper than it is.
    expect(parseCost('{2/W}')).toEqual({
      generic: 0,
      pips: [{ kind: 'color', colors: ['W'], genericAlternative: 2 }],
      cmc: 2,
    })
  })

  it('[R] reads a colorless pip', () => {
    // Issue #37. {C} is one mana only a colorless source pays; it used to
    // parse to nothing, so an Eldrazi read as partly free.
    expect(parseCost('{2}{C}')).toEqual({
      generic: 2,
      pips: [{ kind: 'colorless' }],
      cmc: 3,
    })
  })

  it('[R] reads a snow pip', () => {
    // Issue #37. {S} is one mana from a snow source. Same shape of gap as {C}.
    expect(parseCost('{1}{S}')).toEqual({ generic: 1, pips: [{ kind: 'snow' }], cmc: 2 })
  })

  it('[R] ignores text outside the symbol braces', () => {
    expect(parseCost('2G')).toEqual({ generic: 0, pips: [], cmc: 0 })
  })
})

describe('payCost with the pips of issue #37', () => {
  it('[R] pays a hybrid pip from either of its colors', () => {
    expect(names(payCost(sourcesOf(land('island', ['U'])), parseCost('{W/U}')))).toEqual([
      'island',
    ])
    expect(names(payCost(sourcesOf(land('plains', ['W'])), parseCost('{W/U}')))).toEqual([
      'plains',
    ])
  })

  it('[R] refuses a hybrid pip no source can make', () => {
    expect(payCost(sourcesOf(forest('a')), parseCost('{W/U}'))).toBeNull()
  })

  it('[R] pays a colorless pip only from a colorless source', () => {
    expect(names(payCost(sourcesOf(land('waste', [])), parseCost('{C}')))).toEqual(['waste'])
    expect(payCost(sourcesOf(forest('a')), parseCost('{C}'))).toBeNull()
  })

  it('[R] keeps a colorless source for the pip only it can pay', () => {
    // Greedy spending would put the colorless land on the {1} - it is the
    // least flexible source - and leave nothing for {C}.
    const sources = sourcesOf(land('waste', []), forest('a'))

    expect(names(payCost(sources, parseCost('{1}{C}')))?.sort()).toEqual(['a', 'waste'])
  })

  it('[R] pays a snow pip only from a snow source', () => {
    const snow = land('snow-forest', ['G'], true, true)

    expect(names(payCost(sourcesOf(snow), parseCost('{S}')))).toEqual(['snow-forest'])
    expect(payCost(sourcesOf(forest('a')), parseCost('{S}'))).toBeNull()
  })

  it('[R] pays a monocolor hybrid pip with its color when it can', () => {
    expect(names(payCost(sourcesOf(land('plains', ['W'])), parseCost('{2/W}')))).toEqual([
      'plains',
    ])
  })

  it('[R] falls back to paying a monocolor hybrid pip generically', () => {
    const sources = sourcesOf(forest('a'), forest('b'))

    expect(names(payCost(sources, parseCost('{2/W}')))?.sort()).toEqual(['a', 'b'])
  })

  it('[R] refuses a monocolor hybrid pip when neither way is covered', () => {
    expect(payCost(sourcesOf(forest('a')), parseCost('{2/W}'))).toBeNull()
  })

  it('[R] converts the hybrid pip that costs the least mana', () => {
    // {3/U}{2/U} off one Island and three Wastes. Only one pip can keep the
    // Island, so the other goes generic - and paying the {2/U} that way costs
    // three lands where paying the {3/U} that way costs four. Ordering the
    // attempts by how many pips get converted can't tell those apart, because
    // both convert exactly one.
    const sources = sourcesOf(
      land('island', ['U']),
      land('waste-a', []),
      land('waste-b', []),
      land('waste-c', []),
    )

    expect(names(payCost(sources, parseCost('{3/U}{2/U}')))?.sort()).toEqual([
      'island',
      'waste-a',
      'waste-b',
    ])
  })

  it('[R] spends the one white source on the pip that needs it', () => {
    // {2/W}{W} off a Plains and two Forests: the flexible pip has to go
    // generic so the plain {W} keeps the Plains. Paying the pips in order and
    // stopping at the first assignment that works gets this wrong.
    const sources = sourcesOf(land('plains', ['W']), forest('a'), forest('b'))

    expect(names(payCost(sources, parseCost('{2/W}{W}')))?.sort()).toEqual([
      'a',
      'b',
      'plains',
    ])
  })
})

describe('missingColors', () => {
  const available = (...colors: ManaColor[]) => new Set(colors)

  it('[R] reports a color the battlefield cannot make', () => {
    expect(missingColors(parseCost('{1}{U}'), available('G'))).toEqual(['U'])
  })

  it('[R] reports nothing for a pip the battlefield already pays', () => {
    expect(missingColors(parseCost('{1}{G}'), available('G'))).toEqual([])
  })

  it('[R] reports both halves of an unpayable hybrid pip', () => {
    // Either one would do, so the land picker gets both to choose from.
    expect(missingColors(parseCost('{W/U}'), available('G')).sort()).toEqual(['U', 'W'])
  })

  it('[R] reports nothing for a hybrid pip one available color pays', () => {
    expect(missingColors(parseCost('{W/U}'), available('U'))).toEqual([])
  })

  it('[R] reports nothing for a monocolor hybrid pip', () => {
    // {2/W} is castable off any two lands, so a hand holding one is not
    // waiting on a Plains.
    expect(missingColors(parseCost('{2/W}'), available('G'))).toEqual([])
  })

  it('[R] ignores colorless and snow pips, which no color pays', () => {
    expect(missingColors(parseCost('{C}{S}'), available('G'))).toEqual([])
  })
})
