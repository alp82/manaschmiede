import type { ScryfallCard } from './scryfall/types'
import type { DeckCard } from './deck-utils'
import { getTotalCards, isBasicLand } from './deck-utils'
import {
  LAND_COUNT_RANGE,
  MAX_COPIES,
  TARGET_DECK_SIZE,
  checkLandCount,
  isAverageManaValueTooHigh,
} from '../../convex/lib/deckRules'
import type { TFn } from './i18n/types'
import { COLOR_KEYS, MANA_COLORS, isManaColor } from './mana-colors'

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
  maindeckSize: number
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

export function analyzeDeck(
  cards: DeckCard[],
  cardData: Map<string, ScryfallCard>,
  t: TFn,
): BalanceAnalysis {
  const mainCards = cards.filter((c) => c.zone === 'main')

  const maindeckSize = getTotalCards(mainCards)

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
  if (maindeckSize < TARGET_DECK_SIZE) {
    warnings.push({
      severity: 'error',
      message: t('balance.warning.tooFewCards', { count: maindeckSize, min: TARGET_DECK_SIZE }),
    })
  }

  // Land count. The band is the same one the section plan allocates against
  // and the generator prompt names — see convex/lib/deckRules.ts.
  const { min: minLand, max: maxLand } = LAND_COUNT_RANGE
  if (maindeckSize >= TARGET_DECK_SIZE * 0.5) {
    const verdict = checkLandCount(landCount)
    if (verdict === 'too-few') {
      warnings.push({
        severity: 'warning',
        message: t('balance.warning.tooFewLands', { count: landCount, min: minLand, max: maxLand }),
      })
    } else if (verdict === 'too-many') {
      warnings.push({
        severity: 'warning',
        message: t('balance.warning.tooManyLands', { count: landCount, min: minLand, max: maxLand }),
      })
    }
  }

  // Average mana value
  if (nonLandCount >= 10 && isAverageManaValueTooHigh(averageCmc)) {
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
    if (qty > MAX_COPIES) {
      const card = cardData.get(scryfallId)
      const name = card?.printed_name || card?.name || scryfallId
      warnings.push({
        severity: 'error',
        message: t('balance.warning.tooManyCopies', { name, count: qty, max: MAX_COPIES }),
      })
    }
  }

  // Color mismatch
  for (const { color, count } of colorDistribution) {
    const landSupport = landColorCounts.get(color) || 0
    if (count >= 8 && landSupport < 3) {
      const colorName = isManaColor(color) ? t(COLOR_KEYS[color]) : color
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
    maindeckSize,
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
  if (ANY_COLOR_PATTERN.test(text)) return [...MANA_COLORS]
  const colors: string[] = []
  for (const [color, re] of Object.entries(SPECIFIC_MANA_PATTERNS)) {
    if (re.test(text)) colors.push(color)
  }
  return colors
}
