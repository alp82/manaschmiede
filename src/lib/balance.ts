import type { ScryfallCard } from './scryfall/types'
import type { DeckCard, DeckFormat } from './deck-utils'
import { FORMAT_RULES, getTotalCards, isBasicLand } from './deck-utils'

export interface BalanceWarning {
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface ManaCurveEntry {
  cmc: number
  count: number
}

export interface ColorCount {
  color: string
  count: number
}

export interface BalanceAnalysis {
  totalCards: number
  maindeckSize: number
  sideboardSize: number
  landCount: number
  nonLandCount: number
  averageCmc: number
  manaCurve: ManaCurveEntry[]
  colorDistribution: ColorCount[]
  landColorDistribution: ColorCount[]
  cardTypeBreakdown: { type: string; count: number }[]
  warnings: BalanceWarning[]
  suggestions: string[]
}

const LAND_TARGETS: Record<DeckFormat, [number, number]> = {
  standard: [22, 26],
  modern: [20, 25],
  casual: [22, 26],
}

const AVG_CMC_TARGETS: Record<DeckFormat, [number, number]> = {
  standard: [2.0, 3.5],
  modern: [1.5, 3.0],
  casual: [2.0, 3.5],
}

export function analyzeDeck(
  cards: DeckCard[],
  cardData: Map<string, ScryfallCard>,
  format: DeckFormat,
): BalanceAnalysis {
  const rules = FORMAT_RULES[format]
  const mainCards = cards.filter((c) => c.zone === 'main')
  const sideCards = cards.filter((c) => c.zone === 'sideboard')

  const maindeckSize = getTotalCards(mainCards)
  const sideboardSize = getTotalCards(sideCards)
  const totalCards = maindeckSize + sideboardSize

  let landCount = 0
  let nonLandCount = 0
  const cmcCounts = new Map<number, number>()
  const colorCounts = new Map<string, number>()
  const landColorCounts = new Map<string, number>()
  const typeCounts = new Map<string, number>()

  for (const dc of mainCards) {
    const card = cardData.get(dc.scryfallId)
    if (!card) continue

    const isLand = card.type_line.toLowerCase().includes('land')

    if (isLand) {
      landCount += dc.quantity
      for (const color of card.color_identity) {
        landColorCounts.set(color, (landColorCounts.get(color) || 0) + dc.quantity)
      }
    } else {
      nonLandCount += dc.quantity
      const cmc = Math.min(Math.floor(card.cmc), 7)
      cmcCounts.set(cmc, (cmcCounts.get(cmc) || 0) + dc.quantity)
    }

    if (!isLand && card.colors) {
      for (const color of card.colors) {
        colorCounts.set(color, (colorCounts.get(color) || 0) + dc.quantity)
      }
    }

    const mainType = getMainType(card.type_line)
    typeCounts.set(mainType, (typeCounts.get(mainType) || 0) + dc.quantity)
  }

  const manaCurve: ManaCurveEntry[] = []
  for (let i = 0; i <= 7; i++) {
    manaCurve.push({ cmc: i, count: cmcCounts.get(i) || 0 })
  }

  let totalCmc = 0
  let totalNonLandCards = 0
  for (const dc of mainCards) {
    const card = cardData.get(dc.scryfallId)
    if (!card || card.type_line.toLowerCase().includes('land')) continue
    totalCmc += card.cmc * dc.quantity
    totalNonLandCards += dc.quantity
  }
  const averageCmc = totalNonLandCards > 0 ? totalCmc / totalNonLandCards : 0

  const colorDistribution = Array.from(colorCounts.entries())
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)

  const landColorDistribution = Array.from(landColorCounts.entries())
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)

  const cardTypeBreakdown = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  const warnings: BalanceWarning[] = []
  const suggestions: string[] = []

  // Deck size
  if (maindeckSize < rules.minDeckSize) {
    warnings.push({
      severity: 'error',
      message: 'Your deck has only ' + maindeckSize + ' cards - at least ' + rules.minDeckSize + ' are required.',
    })
  }

  // Land count
  const [minLand, maxLand] = LAND_TARGETS[format]
  if (maindeckSize >= rules.minDeckSize * 0.5) {
    if (landCount < minLand) {
      warnings.push({
        severity: 'warning',
        message: 'You have only ' + landCount + ' lands - recommended is ' + minLand + '-' + maxLand + '.',
      })
    } else if (landCount > maxLand) {
      warnings.push({
        severity: 'warning',
        message: 'You have ' + landCount + ' lands - recommended is ' + minLand + '-' + maxLand + '.',
      })
    }
  }

  // Average CMC
  const [, maxCmc] = AVG_CMC_TARGETS[format]
  if (nonLandCount >= 10 && averageCmc > maxCmc) {
    warnings.push({
      severity: 'warning',
      message: 'Your average mana cost is ' + averageCmc.toFixed(1) + ' - consider adding cheaper cards.',
    })
  }

  // Max copies check
  const counts = new Map<string, number>()
  for (const dc of mainCards) {
    const card = cardData.get(dc.scryfallId)
    if (card && isBasicLand(card)) continue
    const current = counts.get(dc.scryfallId) || 0
    counts.set(dc.scryfallId, current + dc.quantity)
  }
  for (const [scryfallId, qty] of counts) {
    if (qty > rules.maxCopies) {
      const card = cardData.get(scryfallId)
      const name = card?.printed_name || card?.name || scryfallId
      warnings.push({
        severity: 'error',
        message: '"' + name + '" appears ' + qty + 'x - maximum ' + rules.maxCopies + ' allowed.',
      })
    }
  }

  // Sideboard check
  if (sideboardSize > rules.sideboardSize) {
    warnings.push({
      severity: 'error',
      message: 'Sideboard has ' + sideboardSize + ' cards - maximum ' + rules.sideboardSize + ' allowed.',
    })
  }

  // Color mismatch
  for (const { color, count } of colorDistribution) {
    const landSupport = landColorCounts.get(color) || 0
    if (count >= 8 && landSupport < 3) {
      const colorName = COLOR_NAMES[color] || color
      warnings.push({
        severity: 'warning',
        message: 'You have ' + count + ' ' + colorName + ' cards but only ' + landSupport + ' matching lands.',
      })
    }
  }

  // Suggestions
  if (nonLandCount >= 20) {
    let hasRemoval = false
    let hasCardDraw = false

    for (const dc of mainCards) {
      const card = cardData.get(dc.scryfallId)
      if (!card) continue
      const text = (card.printed_text || card.oracle_text || '').toLowerCase()
      if (text.includes('destroy') || text.includes('exile')) hasRemoval = true
      if (text.includes('draw')) hasCardDraw = true
    }

    if (!hasRemoval) {
      suggestions.push('Consider adding removal spells to handle opponent threats.')
    }
    if (!hasCardDraw) {
      suggestions.push('Consider adding card draw to maintain hand advantage.')
    }

    // Tribal detection
    const creatureTypes = new Map<string, number>()
    for (const dc of mainCards) {
      const card = cardData.get(dc.scryfallId)
      if (!card || !card.type_line.toLowerCase().includes('creature')) continue
      const parts = card.type_line.split(' - ')
      if (parts[1]) {
        for (const t of parts[1].split(' ')) {
          const trimmed = t.trim()
          if (trimmed.length > 2) {
            creatureTypes.set(trimmed, (creatureTypes.get(trimmed) || 0) + dc.quantity)
          }
        }
      }
    }
    for (const [type, typeCount] of creatureTypes) {
      if (typeCount >= 5) {
        suggestions.push('You have ' + typeCount + ' ' + type + ' - consider tribal synergy cards.')
      }
    }
  }

  return {
    totalCards,
    maindeckSize,
    sideboardSize,
    landCount,
    nonLandCount,
    averageCmc,
    manaCurve,
    colorDistribution,
    landColorDistribution,
    cardTypeBreakdown,
    warnings,
    suggestions,
  }
}

function getMainType(typeLine: string): string {
  const lower = typeLine.toLowerCase()
  if (lower.includes('creature')) return 'Creature'
  if (lower.includes('instant')) return 'Instant'
  if (lower.includes('sorcery')) return 'Sorcery'
  if (lower.includes('enchantment')) return 'Enchantment'
  if (lower.includes('artifact')) return 'Artifact'
  if (lower.includes('planeswalker')) return 'Planeswalker'
  if (lower.includes('land')) return 'Land'
  return 'Other'
}

const COLOR_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
}
