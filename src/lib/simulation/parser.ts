import type { ScryfallCard } from '../scryfall/types'
import type { DeckCard } from '../deck-utils'
import type { CardType, Keyword, SimCard } from './types'
import { isBasicLand } from '../deck-utils'
import { isBasicLandId } from '../../../convex/lib/basicLands'
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

/**
 * The body a creature gets when its printed power or toughness is variable.
 *
 * Not the real value - that comes from a characteristic-defining ability
 * ("equal to the number of creatures you control") the model has no way to
 * evaluate. It is a floor, chosen because 0 is the one answer that is always
 * wrong: a 0/0 is destroyed by state-based actions the instant it resolves, so
 * the card is a guaranteed blank in every game and drags the deck's measured
 * win rate down (#38). 1 is wrong by a bounded amount, in the direction that
 * lets the card be played.
 */
const VARIABLE_PT_FLOOR = 1

/**
 * Read a printed power or toughness.
 *
 * An ABSENT value is 0 - a noncreature has no power, and 0 is the right answer
 * there. A value that is PRESENT but not a plain number is variable, and takes
 * `VARIABLE_PT_FLOOR`. Scryfall prints those as a bare star, star arithmetic
 * (`1+` star), a superscript star, or `?`; star arithmetic reaches its constant
 * through parseInt, which stops at the `+`, and the rest are NaN.
 */
function parsePT(value: string | undefined): number {
  if (!value) return 0
  // A plain integer is printed exactly as it plays - including a real 0, which
  // is what a 0/1 wall has and which the floor must not touch.
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  const constant = parseInt(value, 10)
  return isNaN(constant) ? VARIABLE_PT_FLOOR : Math.max(constant, VARIABLE_PT_FLOOR)
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
    isBasicLand: isBasicLand(card) || isBasicLandId(card.id),
    isSnow: typeLine.toLowerCase().includes('snow'),
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
