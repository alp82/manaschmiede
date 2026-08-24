import type { ManaColor, ManaCost, ManaPip, ManaSource, Permanent } from './types'

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
const SYMBOL_RE = /\{([^}]+)\}/g

/**
 * The pip a hybrid symbol's parts describe, or `null` when none of them names
 * anything the model has.
 *
 * `{W/P}` is its color; `{W/U}` is both; `{2/W}` is its color plus the generic
 * alternative the number gives it. A `P` or `C` part contributes nothing.
 */
function hybridPip(parts: readonly string[]): ManaPip | null {
  const colors = parts.filter((p): p is ManaColor => MANA_COLORS.includes(p as ManaColor))
  if (colors.length === 0) return null

  const generic = parts.map((p) => parseInt(p, 10)).find((n) => !isNaN(n))
  return generic === undefined
    ? { kind: 'color', colors }
    : { kind: 'color', colors, genericAlternative: generic }
}

/**
 * The cost a printed mana cost string describes.
 *
 * Every symbol becomes either generic mana or one pip, and `cmc` is the mana
 * value the card is printed with - which for `{2/W}` is 2, not 1.
 */
export function parseCost(costString: string): ManaCost {
  const pips: ManaPip[] = []
  let generic = 0
  let cmc = 0

  for (const match of costString.matchAll(SYMBOL_RE)) {
    const inner = match[1]

    if (inner === 'X') continue

    if (inner.includes('/')) {
      const pip = hybridPip(inner.split('/'))
      if (pip === null) continue
      pips.push(pip)
      cmc += pip.kind === 'color' ? (pip.genericAlternative ?? 1) : 1
      continue
    }

    const num = parseInt(inner, 10)
    if (!isNaN(num)) {
      generic += num
      cmc += num
      continue
    }

    if (MANA_COLORS.includes(inner as ManaColor)) {
      pips.push({ kind: 'color', colors: [inner as ManaColor] })
      cmc += 1
      continue
    }

    if (inner === 'C' || inner === 'S') {
      pips.push({ kind: inner === 'C' ? 'colorless' : 'snow' })
      cmc += 1
    }
  }

  return { generic, pips, cmc }
}

/**
 * Colors that would bring `cost` closer to castable, given what the battlefield
 * already makes.
 *
 * A pip one of `available` already pays asks for nothing. A pip none of them
 * pays asks for every color that would pay it, because any one of them is
 * enough - which is what makes a hybrid pip two answers rather than one.
 *
 * A monocolor hybrid asks for nothing either way: `{2/W}` is castable off any
 * two lands, so a hand holding one is not waiting on a Plains. Counting it
 * would send `chooseLand` after a color the card doesn't need.
 */
export function missingColors(
  cost: ManaCost,
  available: ReadonlySet<ManaColor>,
): ManaColor[] {
  const missing = new Set<ManaColor>()
  for (const pip of cost.pips) {
    if (pip.kind !== 'color' || pip.genericAlternative !== undefined) continue
    if (pip.colors.some((color) => available.has(color))) continue
    for (const color of pip.colors) missing.add(color)
  }
  return [...missing]
}

/** The mana sources an untapped battlefield offers. */
export function manaSources(battlefield: Permanent[]): ManaSource[] {
  const sources: ManaSource[] = []
  for (const p of battlefield) {
    if (p.card.cardType !== 'land' || p.tapped) continue
    sources.push({ permanent: p, colors: p.card.producesColors, snow: p.card.isSnow })
  }
  return sources
}

/** Whether this one source can pay this one pip. */
function canPay(source: ManaSource, pip: ManaPip): boolean {
  switch (pip.kind) {
    case 'colorless':
      return source.colors.length === 0
    case 'snow':
      return source.snow
    case 'color':
      return pip.colors.some((color) => source.colors.includes(color))
  }
}

/** Source indices, least flexible first - the order a player spends them in. */
function bySpendPreference(sources: readonly ManaSource[]): number[] {
  return sources
    .map((_, i) => i)
    .sort((a, b) => sources[a].colors.length - sources[b].colors.length || a - b)
}

/**
 * Assigns one source to each pip, or returns `null` if no assignment covers
 * them all.
 *
 * Handing each pip the first source that fits is not enough: a Forest and a
 * Forest-or-Island paying {G}{U} fails that way, because the dual gets spent on
 * the green pip. This is an augmenting-path matching instead, so a pip can take
 * a source from an earlier pip as long as that pip can be re-housed.
 */
function matchPips(
  sources: readonly ManaSource[],
  pips: readonly ManaPip[],
  order: readonly number[],
): number[] | null {
  const pipOfSource: number[] = new Array(sources.length).fill(-1)
  const sourceOfPip: number[] = new Array(pips.length).fill(-1)

  function assign(pip: number, visited: boolean[]): boolean {
    for (const s of order) {
      if (visited[s] || !canPay(sources[s], pips[pip])) continue
      visited[s] = true
      if (pipOfSource[s] === -1 || assign(pipOfSource[s], visited)) {
        pipOfSource[s] = pip
        sourceOfPip[pip] = s
        return true
      }
    }
    return false
  }

  for (let pip = 0; pip < pips.length; pip++) {
    if (!assign(pip, new Array(sources.length).fill(false))) return null
  }
  return sourceOfPip
}

/**
 * Every set of monocolor-hybrid pips to pay generically instead, cheapest first.
 *
 * `{2/W}` is one white mana or two of anything, and which is cheaper depends on
 * the rest of the board: the white source may be the only one another pip can
 * use. No single ordering gets that right, so each combination is tried,
 * starting with the one that spends the least mana - which is the extra mana
 * each conversion costs, summed, not the number of conversions. A cost mixing
 * `{2/W}` with `{3/G}` orders those two differently.
 *
 * A printed cost holds a handful of these at most - Reaper King's five is the
 * outlier - so the enumeration is bounded by the card, not by the board.
 */
function genericConversions(
  pips: readonly ManaPip[],
  flexible: readonly number[],
): Set<number>[] {
  const extraMana = (chosen: readonly number[]) =>
    chosen.reduce((sum, i) => {
      const pip = pips[i]
      return sum + (pip.kind === 'color' ? (pip.genericAlternative ?? 1) - 1 : 0)
    }, 0)

  const subsets: { chosen: Set<number>; cost: number }[] = []
  for (let mask = 0; mask < 1 << flexible.length; mask++) {
    const chosen = flexible.filter((_, i) => mask & (1 << i))
    subsets.push({ chosen: new Set(chosen), cost: extraMana(chosen) })
  }
  return subsets.sort((a, b) => a.cost - b.cost).map((s) => s.chosen)
}

/**
 * The sources that pay `cost` once `convertedToGeneric` names the flexible pips
 * being paid the generic way, or `null` when they can't.
 *
 * Colored pips are matched first because they are the constrained half; the
 * generic part then takes whatever is left, cheapest land first, so the duals
 * survive to pay for something only they can.
 */
function payWith(
  sources: readonly ManaSource[],
  cost: ManaCost,
  order: readonly number[],
  convertedToGeneric: ReadonlySet<number>,
): ManaSource[] | null {
  const pips: ManaPip[] = []
  let generic = cost.generic

  cost.pips.forEach((pip, i) => {
    if (pip.kind === 'color' && convertedToGeneric.has(i)) {
      generic += pip.genericAlternative ?? 0
    } else {
      pips.push(pip)
    }
  })

  const matched = matchPips(sources, pips, order)
  if (matched === null) return null

  const spent = matched.map((i) => sources[i])
  const used = new Set(matched)

  for (const i of order) {
    if (generic <= 0) break
    if (used.has(i)) continue
    spent.push(sources[i])
    generic--
  }
  if (generic > 0) return null

  return spent
}

/**
 * The sources that pay `cost`, or `null` when they can't.
 *
 * `sources` is left untouched, and the returned entries are the very objects it
 * held - a caller subtracting the spend from its own list can compare them by
 * identity.
 */
export function payCost(
  sources: readonly ManaSource[],
  cost: ManaCost,
): ManaSource[] | null {
  const order = bySpendPreference(sources)
  const flexible = cost.pips.flatMap((pip, i) =>
    pip.kind === 'color' && pip.genericAlternative !== undefined ? [i] : [],
  )

  for (const converted of genericConversions(cost.pips, flexible)) {
    const spent = payWith(sources, cost, order, converted)
    if (spent !== null) return spent
  }
  return null
}

const BASIC_LAND_TYPES: Record<string, ManaColor> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
}

const ANY_COLOR_PATTERN =
  /add one mana of any color|add \{w\}\{u\}\{b\}\{r\}\{g\}|in any combination of colors/i

/**
 * Everything an "add" ability adds, up to the end of its sentence.
 *
 * A land's colors can't be read off single `add {x}` matches: `"Add {W} or
 * {U}."` names its second color three words after the word `add`, and a filter
 * land names its colors in pairs. Reading the whole clause catches every form,
 * and stopping at the sentence keeps the colors mentioned by an unrelated
 * ability further down the card out of it.
 */
const ADD_CLAUSE_RE = /\badd\b([^.;\n]*)/gi
const SYMBOL_COLOR_RE = /\{([wubrg])\}/gi

export function parseLandColors(oracleText: string, typeLine: string): ManaColor[] {
  const colors = new Set<ManaColor>()
  const lowerType = typeLine.toLowerCase()

  for (const [landType, color] of Object.entries(BASIC_LAND_TYPES)) {
    if (lowerType.includes(landType)) colors.add(color)
  }

  const text = oracleText || ''
  if (ANY_COLOR_PATTERN.test(text)) {
    return ['W', 'U', 'B', 'R', 'G']
  }

  for (const clause of text.matchAll(ADD_CLAUSE_RE)) {
    for (const symbol of clause[1].matchAll(SYMBOL_COLOR_RE)) {
      colors.add(symbol[1].toUpperCase() as ManaColor)
    }
  }

  return [...colors]
}
