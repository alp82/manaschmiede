import type { ManaCost, ManaColor, ManaPool, Permanent, SimCard } from './types'

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

export function emptyPool(): ManaPool {
  return {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    colorless: 0,
  }
}

export function canPay(pool: ManaPool, cost: ManaCost): boolean {
  for (const color of MANA_COLORS) {
    const needed = cost.colored[color] ?? 0
    if (pool.colors[color] < needed) return false
  }

  let totalAvailable = pool.colorless
  for (const color of MANA_COLORS) {
    totalAvailable += Math.max(0, pool.colors[color] - (cost.colored[color] ?? 0))
  }

  return totalAvailable >= cost.generic
}

export function payMana(pool: ManaPool, cost: ManaCost): boolean {
  if (!canPay(pool, cost)) return false

  for (const color of MANA_COLORS) {
    const needed = cost.colored[color] ?? 0
    pool.colors[color] -= needed
  }

  let genericLeft = cost.generic
  const sorted = [...MANA_COLORS].sort((a, b) => pool.colors[b] - pool.colors[a])
  for (const color of sorted) {
    if (genericLeft <= 0) break
    const pay = Math.min(pool.colors[color], genericLeft)
    pool.colors[color] -= pay
    genericLeft -= pay
  }
  if (genericLeft > 0) {
    pool.colorless -= genericLeft
  }

  return true
}

/**
 * The one mana an untapped land adds to the pool, or `null` for colorless.
 *
 * Every land is worth exactly one mana. That invariant is what lets
 * `tapSpentLands` read a quantity of spent mana back as a set of lands.
 */
function landOutput(card: SimCard): ManaColor | null {
  return card.producesColors.length > 0 ? card.producesColors[0] : null
}

/** The mana available from every untapped land on `battlefield`. */
export function poolFromLands(battlefield: Permanent[]): ManaPool {
  const pool = emptyPool()
  for (const p of battlefield) {
    if (p.card.cardType !== 'land' || p.tapped) continue
    const color = landOutput(p.card)
    if (color === null) {
      pool.colorless += 1
    } else {
      pool.colors[color] += 1
    }
  }
  return pool
}

/** The mana that `before` held and `after` doesn't - what the player spent. */
export function poolSpent(before: ManaPool, after: ManaPool): ManaPool {
  const spent = emptyPool()
  spent.colorless = before.colorless - after.colorless
  for (const color of MANA_COLORS) {
    spent.colors[color] = before.colors[color] - after.colors[color]
  }
  return spent
}

/**
 * Taps the lands that produced `spent`, longest-serving lands first.
 *
 * One land is worth one mana, so a spend of two green is two green lands.
 * Lands already tapped are left alone - their mana was never in the pool.
 */
export function tapSpentLands(battlefield: Permanent[], spent: ManaPool): void {
  const owed: ManaPool = { colors: { ...spent.colors }, colorless: spent.colorless }

  for (const p of battlefield) {
    if (p.card.cardType !== 'land' || p.tapped) continue
    const color = landOutput(p.card)

    if (color === null) {
      if (owed.colorless <= 0) continue
      owed.colorless -= 1
    } else {
      if (owed.colors[color] <= 0) continue
      owed.colors[color] -= 1
    }
    p.tapped = true
  }
}

const BASIC_LAND_TYPES: Record<string, ManaColor> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
}

const ANY_COLOR_PATTERN = /add one mana of any color|add \{w\}\{u\}\{b\}\{r\}\{g\}/i
const SPECIFIC_MANA_PATTERNS: Record<string, RegExp> = {
  W: /add \{w\}/i,
  U: /add \{u\}/i,
  B: /add \{b\}/i,
  R: /add \{r\}/i,
  G: /add \{g\}/i,
}

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

  for (const [color, re] of Object.entries(SPECIFIC_MANA_PATTERNS)) {
    if (re.test(text)) colors.add(color as ManaColor)
  }

  return [...colors]
}
