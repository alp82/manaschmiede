import type { ScryfallCard } from './scryfall/types'

/**
 * Deterministic synergy validator.
 *
 * Catches the "dead card" failure mode where the AI suggests cards whose
 * primary triggered abilities reference a tribe, card type, or keyword that
 * the deck cannot satisfy. Example: "Dragon Tempest" in a deck with no
 * Dragons and no flyers — both triggered abilities are dead, the card is
 * suggested anyway because it pattern-matches "red enchantment".
 *
 * The validator runs against the deck composition the card would join. It
 * does NOT judge ranking or card quality — only structural deadness. If
 * any single referenced tribe/type/keyword is satisfied, the card passes.
 */

/** Composition of a deck used to evaluate whether a card's text references resolve. */
export interface DeckComposition {
  /** Creature subtype → number of card copies with that subtype. */
  creatureTypes: Map<string, number>
  /** Top-level card type (creature/artifact/instant/...) → number of copies. */
  cardTypes: Map<string, number>
  /** Keyword → number of card copies that have it as an innate ability. */
  keywords: Map<string, number>
  /** Total card count in the composition. */
  totalCards: number
}

export interface SynergyIssue {
  reason: string
}

export interface ValidatorOptions {
  /** Minimum tribal members required before tribal-payoff cards are allowed. Default 4. */
  tribalThreshold?: number
  /** Minimum cards of a referenced type (artifact, instant, ...). Default 4. */
  cardTypeThreshold?: number
  /** Minimum creatures with a referenced keyword. Default 1. */
  keywordThreshold?: number
}

/**
 * Creature types frequently used by tribal payoff cards. Restricting to a
 * curated list avoids false positives from common English words that happen
 * to also be Magic creature types.
 */
const TRIBAL_TYPES = [
  'Dragon', 'Goblin', 'Elf', 'Zombie', 'Vampire', 'Angel', 'Demon',
  'Knight', 'Beast', 'Dinosaur', 'Merfolk', 'Spirit', 'Faerie', 'Elemental',
  'Wizard', 'Warrior', 'Soldier', 'Cleric', 'Rogue', 'Shaman', 'Druid',
  'Pirate', 'Skeleton', 'Giant', 'Hydra', 'Sphinx', 'Werewolf', 'Sliver',
  'Eldrazi', 'Treefolk', 'Ally', 'Ninja', 'Samurai', 'Monk', 'Assassin',
  'Phyrexian', 'Saproling', 'Spider', 'Snake', 'Cat', 'Bird',
  'Wolf', 'Hound', 'Horror',
] as const

/**
 * Card-type matters references. Maps the lowercased keyword in oracle text
 * to the deck composition key it should be checked against.
 */
const CARD_TYPE_REFERENCES = [
  'artifact', 'enchantment', 'instant', 'sorcery', 'equipment', 'aura',
] as const

/** Keywords that show up in conditional clauses like "creatures you control with X". */
const CONDITIONAL_KEYWORDS = [
  'flying', 'trample', 'deathtouch', 'lifelink', 'first strike',
  'double strike', 'vigilance', 'haste', 'hexproof', 'menace', 'reach',
  'indestructible', 'flash', 'defender',
] as const

/**
 * Build a composition snapshot from a list of resolved cards. The validator
 * uses this to decide whether oracle-text references can resolve.
 */
export function analyzeComposition(
  entries: Array<{ card: ScryfallCard; quantity: number }>,
): DeckComposition {
  const creatureTypes = new Map<string, number>()
  const cardTypes = new Map<string, number>()
  const keywords = new Map<string, number>()
  let totalCards = 0

  for (const { card, quantity } of entries) {
    totalCards += quantity
    const tl = (card.type_line || '').toLowerCase()

    if (tl.includes('creature')) bump(cardTypes, 'creature', quantity)
    if (tl.includes('artifact')) bump(cardTypes, 'artifact', quantity)
    if (tl.includes('enchantment')) bump(cardTypes, 'enchantment', quantity)
    if (tl.includes('instant')) bump(cardTypes, 'instant', quantity)
    if (tl.includes('sorcery')) bump(cardTypes, 'sorcery', quantity)
    if (tl.includes('land')) bump(cardTypes, 'land', quantity)
    if (tl.includes('planeswalker')) bump(cardTypes, 'planeswalker', quantity)
    if (tl.includes('equipment')) bump(cardTypes, 'equipment', quantity)
    if (tl.includes('aura')) bump(cardTypes, 'aura', quantity)

    // Creature subtypes appear after the em-dash separator: "Creature — Human Wizard".
    // Double-faced and modal cards split faces with "//", e.g.
    // "Creature — Human Werewolf // Creature — Werewolf". We process each face
    // independently and dedupe subtypes across faces so a single werewolf card
    // isn't counted as 2× Werewolf just because both faces share the type.
    if (tl.includes('creature')) {
      const faces = tl.split('//')
      const subtypesInCard = new Set<string>()
      for (const face of faces) {
        const faceTrimmed = face.trim()
        if (!faceTrimmed.includes('creature')) continue
        const dashIdx = faceTrimmed.indexOf('—')
        if (dashIdx < 0) continue
        const subtypeWords = faceTrimmed.slice(dashIdx + 1).trim().split(/\s+/)
        for (const word of subtypeWords) {
          const normalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          // Only count subtypes from our curated list to avoid noise.
          if ((TRIBAL_TYPES as readonly string[]).includes(normalized)) {
            subtypesInCard.add(normalized)
          }
        }
      }
      for (const type of subtypesInCard) {
        bump(creatureTypes, type, quantity)
      }
    }

    // Innate keywords from Scryfall's keywords array. We only count keywords
    // when the card actually has them as abilities, not when oracle text
    // mentions them in another context (e.g. "destroy target creature with flying").
    if (card.keywords && card.keywords.length > 0) {
      for (const kw of card.keywords) {
        bump(keywords, kw.toLowerCase(), quantity)
      }
    }
  }

  return { creatureTypes, cardTypes, keywords, totalCards }
}

function bump(map: Map<string, number>, key: string, n: number) {
  map.set(key, (map.get(key) ?? 0) + n)
}

/**
 * Check whether a card's oracle text references tribes, card types, or
 * keywords that the deck composition cannot satisfy.
 *
 * Returns null if the card has no references OR at least one referenced
 * thing is satisfied. Returns a rejection reason only when ALL conditional
 * references are dead in the given composition.
 */
export function findSynergyIssue(
  card: ScryfallCard,
  composition: DeckComposition,
  options: ValidatorOptions = {},
): SynergyIssue | null {
  const tribalThreshold = options.tribalThreshold ?? 4
  const cardTypeThreshold = options.cardTypeThreshold ?? 4
  const keywordThreshold = options.keywordThreshold ?? 1

  // Double-faced and modal cards carry their text on each face rather than
  // at the top level. Fall back to concatenating face oracle text so the
  // validator doesn't silently pass every DFC tribal payoff.
  let rawText = card.oracle_text || ''
  if (!rawText.trim() && card.card_faces && card.card_faces.length > 0) {
    rawText = card.card_faces
      .map((f) => f.oracle_text ?? '')
      .filter((t) => t.length > 0)
      .join('\n')
  }
  if (!rawText.trim()) return null

  const tl = (card.type_line || '').toLowerCase()
  // Lands and basic vanilla creatures rarely have conditional payoff text.
  if (tl.includes('basic land')) return null

  // Strip the card's own name from oracle text. Names that contain a tribal
  // word ("Dragon's Approach", "Goblin Piledriver") would otherwise produce
  // a false-positive tribal reference on every line.
  const nameStripped = card.name
    ? rawText.replace(new RegExp(escapeRegex(card.name), 'gi'), '')
    : rawText
  const text = nameStripped.toLowerCase()

  type Condition = { kind: 'tribal' | 'cardtype' | 'keyword'; label: string; satisfied: boolean }
  const conditions: Condition[] = []

  // ─── Tribal references ─────────────────────────────────────
  for (const type of TRIBAL_TYPES) {
    const lower = type.toLowerCase()
    // Match the type as a word, optionally pluralized. Word boundaries on
    // both sides keep "Dragonfly" / "Snakebite" from matching.
    const pattern = new RegExp(`\\b${lower}s?\\b`, 'i')
    if (!pattern.test(text)) continue

    const have = composition.creatureTypes.get(type) ?? 0
    conditions.push({
      kind: 'tribal',
      label: type,
      satisfied: have >= tribalThreshold,
    })
  }

  // ─── Card-type matters references ──────────────────────────
  for (const type of CARD_TYPE_REFERENCES) {
    // Look for phrases that gate value on the existence of cards of this type:
    //   "another <type>"
    //   "<type> you control"
    //   "<type>s you control"
    //   "whenever you cast a/an <type>"
    //   "<type> spells you cast"
    //   "for each <type>"
    //   "sacrifice a <type>"
    const conditionalPattern = new RegExp(
      `\\b(?:another\\s+${type}|${type}s?\\s+you\\s+control|${type}\\s+spells?\\s+you\\s+cast|whenever\\s+you\\s+cast\\s+(?:a|an)\\s+${type}|for\\s+each\\s+${type}|sacrifice\\s+(?:a|an)\\s+${type})\\b`,
      'i',
    )
    if (!conditionalPattern.test(text)) continue

    const have = composition.cardTypes.get(type) ?? 0
    conditions.push({
      kind: 'cardtype',
      label: type,
      satisfied: have >= cardTypeThreshold,
    })
  }

  // ─── Keyword conditional references ────────────────────────
  // Specifically: "creatures you control with <keyword>". This is the GATING
  // form, distinct from "gain <keyword>" / "have <keyword>" which would
  // grant the keyword and therefore not require it to pre-exist.
  for (const kw of CONDITIONAL_KEYWORDS) {
    const pattern = new RegExp(`creatures?\\s+you\\s+control\\s+with\\s+${kw}\\b`, 'i')
    if (!pattern.test(text)) continue

    const have = composition.keywords.get(kw) ?? 0
    conditions.push({
      kind: 'keyword',
      label: kw,
      satisfied: have >= keywordThreshold,
    })
  }

  if (conditions.length === 0) return null
  // Any single satisfied reference is enough to keep the card.
  if (conditions.some((c) => c.satisfied)) return null

  const parts = conditions.map((c) => {
    if (c.kind === 'tribal') {
      return `references ${c.label}s but the deck has fewer than ${tribalThreshold}`
    }
    if (c.kind === 'cardtype') {
      return `requires ${c.label}s but the deck has fewer than ${cardTypeThreshold}`
    }
    return `gates value on creatures with ${c.label} but the deck has none`
  })

  return {
    reason: `${card.name}: ${parts.join('; ')}`,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a human-readable composition summary for inclusion in an LLM prompt.
 * Lets the AI see the same numeric facts the validator will check, so it can
 * avoid suggesting dead cards in the first place.
 */
export function summarizeComposition(composition: DeckComposition): string {
  const lines: string[] = []

  const tribesPresent = Array.from(composition.creatureTypes.entries())
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  if (tribesPresent.length > 0) {
    lines.push(
      `- Creature types present: ${tribesPresent.map(([t, n]) => `${t} (${n})`).join(', ')}`,
    )
  } else {
    lines.push('- Creature types present: none with tribal payoff potential')
  }

  const typeOrder = ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker', 'land']
  const typeParts: string[] = []
  for (const t of typeOrder) {
    const n = composition.cardTypes.get(t) ?? 0
    if (n > 0) typeParts.push(`${n} ${t}${n === 1 ? '' : 's'}`)
  }
  if (typeParts.length > 0) {
    lines.push(`- Card type breakdown: ${typeParts.join(', ')}`)
  }

  const keywordsPresent = Array.from(composition.keywords.entries())
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  if (keywordsPresent.length > 0) {
    lines.push(
      `- Keywords on creatures: ${keywordsPresent.map(([k, n]) => `${k} (${n})`).join(', ')}`,
    )
  }

  return lines.join('\n')
}
