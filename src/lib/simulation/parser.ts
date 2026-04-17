import type { ScryfallCard } from '../scryfall/types'
import type { DeckCard } from '../deck-utils'
import type { CardType, Keyword, SimCard } from './types'
import { isBasicLand } from '../deck-utils'
import { BASIC_LAND_ID_SET } from '../basic-lands'
import { parseCost, parseLandColors } from './mana'
import { parseEffects } from './effects'

const KEYWORD_MAP: Record<string, Keyword> = {
  flying: 'flying',
  reach: 'reach',
  'first strike': 'first_strike',
  'double strike': 'double_strike',
  deathtouch: 'deathtouch',
  trample: 'trample',
  lifelink: 'lifelink',
  menace: 'menace',
  vigilance: 'vigilance',
  indestructible: 'indestructible',
  defender: 'defender',
  haste: 'haste',
  flash: 'flash',
  hexproof: 'hexproof',
}

function getMainType(typeLine: string): CardType {
  const lower = typeLine.toLowerCase()
  if (lower.includes('creature')) return 'creature'
  if (lower.includes('instant')) return 'instant'
  if (lower.includes('sorcery')) return 'sorcery'
  if (lower.includes('enchantment')) return 'enchantment'
  if (lower.includes('artifact')) return 'artifact'
  if (lower.includes('planeswalker')) return 'planeswalker'
  if (lower.includes('land')) return 'land'
  return 'other'
}

function parsePT(value: string | undefined): number {
  if (!value) return 0
  if (value === '*') return 0
  const num = parseInt(value, 10)
  return isNaN(num) ? 0 : num
}

export function parseScryfallCard(card: ScryfallCard): SimCard {
  const face = card.card_faces?.[0]
  const typeLine = face?.type_line ?? card.type_line
  const manaCost = face?.mana_cost ?? card.mana_cost ?? ''
  const oracleText = face?.oracle_text ?? card.oracle_text ?? ''
  const power = face?.power ?? card.power
  const toughness = face?.toughness ?? card.toughness
  const cardType = getMainType(typeLine)
  const isLand = cardType === 'land'

  const keywords = new Set<Keyword>()
  if (card.keywords) {
    for (const kw of card.keywords) {
      const mapped = KEYWORD_MAP[kw.toLowerCase()]
      if (mapped) keywords.add(mapped)
    }
  }

  const producesColors = isLand ? parseLandColors(oracleText, typeLine) : []

  return {
    id: card.id,
    name: card.name,
    cardType,
    cost: isLand ? null : parseCost(manaCost),
    power: parsePT(power),
    toughness: parsePT(toughness),
    keywords,
    producesColors,
    effects: parseEffects(oracleText, cardType),
    isBasicLand: isBasicLand(card) || BASIC_LAND_ID_SET.has(card.id),
  }
}

export function parseDeck(
  cards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
): SimCard[] {
  const result: SimCard[] = []

  for (const dc of cards) {
    if (dc.zone !== 'main') continue
    const card = cardDataMap.get(dc.scryfallId)
    if (!card) continue
    const simCard = parseScryfallCard(card)
    for (let i = 0; i < dc.quantity; i++) {
      result.push(simCard)
    }
  }

  return result
}
