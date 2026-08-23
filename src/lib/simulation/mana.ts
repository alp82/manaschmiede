import type { ManaColor, ManaCost, ManaSource, Permanent } from './types'

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
const SYMBOL_RE = /\{([^}]+)\}/g

export function parseCost(costString: string): ManaCost {
  const colored: Partial<Record<ManaColor, number>> = {}
  let generic = 0
  let cmc = 0

  for (const match of costString.matchAll(SYMBOL_RE)) {
    const inner = match[1]

    if (inner === 'X') continue

    if (inner.includes('/P')) {
      const color = inner[0] as ManaColor
      if (MANA_COLORS.includes(color)) {
        colored[color] = (colored[color] ?? 0) + 1
        cmc += 1
      }
      continue
    }

    if (inner.includes('/')) {
      const parts = inner.split('/')
      for (const p of parts) {
        if (MANA_COLORS.includes(p as ManaColor)) {
          colored[p as ManaColor] = (colored[p as ManaColor] ?? 0) + 1
          cmc += 1
          break
        }
      }
      continue
    }

    const num = parseInt(inner, 10)
    if (!isNaN(num)) {
      generic += num
      cmc += num
      continue
    }

    if (MANA_COLORS.includes(inner as ManaColor)) {
      const color = inner as ManaColor
      colored[color] = (colored[color] ?? 0) + 1
      cmc += 1
    }
  }

  return { generic, colored, cmc }
}

/** The mana sources an untapped battlefield offers. */
export function manaSources(battlefield: Permanent[]): ManaSource[] {
  const sources: ManaSource[] = []
  for (const p of battlefield) {
    if (p.card.cardType !== 'land' || p.tapped) continue
    sources.push({ permanent: p, colors: p.card.producesColors })
  }
  return sources
}

/** One entry per colored pip in `cost`, in `MANA_COLORS` order. */
function coloredPips(cost: ManaCost): ManaColor[] {
  const pips: ManaColor[] = []
  for (const color of MANA_COLORS) {
    for (let i = 0; i < (cost.colored[color] ?? 0); i++) pips.push(color)
  }
  return pips
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
  pips: readonly ManaColor[],
  order: readonly number[],
): number[] | null {
  const pipOfSource: number[] = new Array(sources.length).fill(-1)
  const sourceOfPip: number[] = new Array(pips.length).fill(-1)

  function assign(pip: number, visited: boolean[]): boolean {
    for (const s of order) {
      if (visited[s] || !sources[s].colors.includes(pips[pip])) continue
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
 * The sources that pay `cost`, or `null` when they can't.
 *
 * Colored pips are matched first because they are the constrained half; the
 * generic part then takes whatever is left, cheapest land first, so the duals
 * survive to pay for something only they can.
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
  const matched = matchPips(sources, coloredPips(cost), order)
  if (matched === null) return null

  const spent = matched.map((i) => sources[i])
  const used = new Set(matched)

  let generic = cost.generic
  for (const i of order) {
    if (generic <= 0) break
    if (used.has(i)) continue
    spent.push(sources[i])
    generic--
  }
  if (generic > 0) return null

  return spent
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
