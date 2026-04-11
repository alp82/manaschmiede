import type { ScryfallCard } from './scryfall/types'
import type { DeckCard, DeckFormat } from './deck-utils'
import { FORMAT_RULES, getTotalCards, isBasicLand } from './deck-utils'

type Translate = (key: string, params?: Record<string, string | number>) => string

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
  t: Translate,
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
      // Artifact mana sources count toward color fixing so goodstuff decks
      // with Chromatic Lantern / signets don't trip the land-mismatch warning.
      for (const color of getArtifactManaColors(card)) {
        landColorCounts.set(color, (landColorCounts.get(color) || 0) + dc.quantity)
      }
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
      message: t('balance.warning.tooFewCards', { count: maindeckSize, min: rules.minDeckSize }),
    })
  }

  // Land count
  const [minLand, maxLand] = LAND_TARGETS[format]
  if (maindeckSize >= rules.minDeckSize * 0.5) {
    if (landCount < minLand) {
      warnings.push({
        severity: 'warning',
        message: t('balance.warning.tooFewLands', { count: landCount, min: minLand, max: maxLand }),
      })
    } else if (landCount > maxLand) {
      warnings.push({
        severity: 'warning',
        message: t('balance.warning.tooManyLands', { count: landCount, min: minLand, max: maxLand }),
      })
    }
  }

  // Average CMC
  const [, maxCmc] = AVG_CMC_TARGETS[format]
  if (nonLandCount >= 10 && averageCmc > maxCmc) {
    warnings.push({
      severity: 'warning',
      message: t('balance.warning.highCmc', { cmc: averageCmc.toFixed(1) }),
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
        message: t('balance.warning.tooManyCopies', { name, count: qty, max: rules.maxCopies }),
      })
    }
  }

  // Sideboard check
  if (sideboardSize > rules.sideboardSize) {
    warnings.push({
      severity: 'error',
      message: t('balance.warning.sideboardTooLarge', { count: sideboardSize, max: rules.sideboardSize }),
    })
  }

  // Color mismatch
  for (const { color, count } of colorDistribution) {
    const landSupport = landColorCounts.get(color) || 0
    if (count >= 8 && landSupport < 3) {
      const colorName = COLOR_KEYS[color] ? t(COLOR_KEYS[color]) : color
      warnings.push({
        severity: 'warning',
        message: t('balance.warning.colorLandMismatch', {
          spells: count,
          color: colorName,
          lands: landSupport,
        }),
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
      suggestions.push(t('balance.suggestion.addRemoval'))
    }
    if (!hasCardDraw) {
      suggestions.push(t('balance.suggestion.addCardDraw'))
    }

    // Tribal detection
    const creatureTypes = new Map<string, number>()
    for (const dc of mainCards) {
      const card = cardData.get(dc.scryfallId)
      if (!card || !card.type_line.toLowerCase().includes('creature')) continue
      const parts = card.type_line.split(' - ')
      if (parts[1]) {
        for (const token of parts[1].split(' ')) {
          const trimmed = token.trim()
          if (trimmed.length > 2) {
            creatureTypes.set(trimmed, (creatureTypes.get(trimmed) || 0) + dc.quantity)
          }
        }
      }
    }
    for (const [type, typeCount] of creatureTypes) {
      if (typeCount >= 5) {
        suggestions.push(t('balance.suggestion.tribalSynergy', { count: typeCount, type }))
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

const COLOR_KEYS: Record<string, string> = {
  W: 'color.white',
  U: 'color.blue',
  B: 'color.black',
  R: 'color.red',
  G: 'color.green',
}

const ANY_COLOR_PATTERN = /add one mana of any color|add \{w\}\{u\}\{b\}\{r\}\{g\}/i
const SPECIFIC_MANA_PATTERNS: Record<string, RegExp> = {
  W: /add \{w\}/i,
  U: /add \{u\}/i,
  B: /add \{b\}/i,
  R: /add \{r\}/i,
  G: /add \{g\}/i,
}

function getArtifactManaColors(card: ScryfallCard): string[] {
  const text = (card.oracle_text || '').toLowerCase()
  if (!text || !card.type_line.toLowerCase().includes('artifact')) return []
  if (ANY_COLOR_PATTERN.test(text)) return ['W', 'U', 'B', 'R', 'G']
  const colors: string[] = []
  for (const [color, re] of Object.entries(SPECIFIC_MANA_PATTERNS)) {
    if (re.test(text)) colors.push(color)
  }
  return colors
}
