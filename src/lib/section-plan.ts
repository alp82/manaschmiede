import { getTraitById } from './trait-mappings'
import type { ScryfallCard } from './scryfall/types'

export interface DeckSection {
  id: string
  label: string
  description: string
  targetCount: number
  role: 'creatures' | 'spells' | 'support' | 'interaction' | 'lands'
  /** Scryfall query hints for building card pool */
  scryfallHints: string[]
}

interface SectionTemplate {
  sections: Omit<DeckSection, 'targetCount'>[]
  /** Distribution of non-land, non-core slots across sections (proportional weights) */
  weights: number[]
  /** Preferred land count */
  landCount: number
}

const TEMPLATES: Record<string, SectionTemplate> = {
  aggro: {
    sections: [
      { id: 'aggressive-creatures', label: 'Aggressive Creatures', description: 'Low-cost creatures with high power, haste, or evasion', role: 'creatures', scryfallHints: ['cmc<=2 pow>=2 t:creature', 'keyword:haste t:creature cmc<=3'] },
      { id: 'burn-tricks', label: 'Burn & Combat Tricks', description: 'Direct damage spells and combat tricks to push damage through', role: 'spells', scryfallHints: ['o:"damage" (t:instant OR t:sorcery) cmc<=3', 'o:"gets +' ] },
      { id: 'removal', label: 'Removal', description: 'Efficient removal to clear blockers', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile OR o:damage) t:instant cmc<=3'] },
    ],
    weights: [16, 6, 4],
    landCount: 22,
  },
  control: {
    sections: [
      { id: 'counterspells', label: 'Counterspells', description: 'Counter magic to deny opponent threats', role: 'spells', scryfallHints: ['o:counter t:instant'] },
      { id: 'removal-wipes', label: 'Removal & Board Wipes', description: 'Spot removal and mass removal to control the board', role: 'interaction', scryfallHints: ['o:"destroy all" (t:instant OR t:sorcery)', '(o:destroy OR o:exile) t:instant'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Card advantage and filtering to find answers', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'win-conditions', label: 'Win Conditions', description: 'Powerful finishers to close the game after stabilizing', role: 'creatures', scryfallHints: ['t:creature cmc>=4 pow>=4 r>=rare'] },
    ],
    weights: [6, 6, 5, 4],
    landCount: 26,
  },
  midrange: {
    sections: [
      { id: 'value-creatures', label: 'Value Creatures', description: 'Efficient mid-cost creatures that generate value on entry or attack', role: 'creatures', scryfallHints: ['t:creature cmc>=3 cmc<=5 r>=uncommon', 'o:"enters" t:creature'] },
      { id: 'removal', label: 'Removal', description: 'Versatile removal to handle any threat', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-advantage', label: 'Card Advantage', description: 'Card draw and value engines to outgrind opponents', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:creature)'] },
    ],
    weights: [12, 6, 6],
    landCount: 24,
  },
  combo: {
    sections: [
      { id: 'combo-pieces', label: 'Combo Pieces', description: 'Key cards that form the combo engine', role: 'support', scryfallHints: ['o:"untap" o:"tap" r>=uncommon', 'o:"whenever" o:"you cast" r>=rare'] },
      { id: 'protection-tutors', label: 'Protection & Tutors', description: 'Cards to find and protect combo pieces', role: 'spells', scryfallHints: ['o:"search your library" r>=uncommon', 'o:hexproof OR o:indestructible'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Dig through the deck to assemble the combo', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'interaction', label: 'Interaction', description: 'Cheap interaction to survive until combo is ready', role: 'interaction', scryfallHints: ['(o:counter OR o:destroy OR o:exile) t:instant cmc<=3'] },
    ],
    weights: [8, 6, 6, 4],
    landCount: 24,
  },
  tribal: {
    sections: [
      { id: 'tribal-lords', label: 'Lords & Payoffs', description: 'Creatures that buff or reward having many of the same type', role: 'creatures', scryfallHints: ['o:"creatures you control get" r>=uncommon'] },
      { id: 'tribal-core', label: 'Core Creatures', description: 'The best creatures of the tribe at various mana costs', role: 'creatures', scryfallHints: [] },
      { id: 'tribal-support', label: 'Tribal Support', description: 'Non-creature spells that support the tribal strategy', role: 'support', scryfallHints: [] },
      { id: 'removal', label: 'Removal', description: 'Removal to clear the way for your tribal army', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [8, 12, 4, 4],
    landCount: 24,
  },
  ramp: {
    sections: [
      { id: 'mana-acceleration', label: 'Mana Acceleration', description: 'Ramp spells and mana dorks to accelerate', role: 'support', scryfallHints: ['o:"search your library" o:land', 'o:"add" o:"mana" t:creature cmc<=2'] },
      { id: 'big-threats', label: 'Big Threats', description: 'Expensive, game-ending creatures and spells', role: 'creatures', scryfallHints: ['cmc>=6 pow>=6 t:creature r>=rare'] },
      { id: 'removal', label: 'Removal', description: 'Removal to survive the early game', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Card draw to keep fueled', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [8, 8, 4, 4],
    landCount: 26,
  },
  tokens: {
    sections: [
      { id: 'token-producers', label: 'Token Producers', description: 'Cards that create creature tokens', role: 'creatures', scryfallHints: ['o:"create" o:"token" r>=uncommon'] },
      { id: 'anthems', label: 'Anthems & Pumps', description: 'Effects that buff all your creatures or tokens', role: 'support', scryfallHints: ['o:"creatures you control get" r>=uncommon'] },
      { id: 'support', label: 'Support Spells', description: 'Card draw and utility to sustain the token strategy', role: 'spells', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', label: 'Removal', description: 'Removal to protect your board', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [12, 6, 4, 4],
    landCount: 24,
  },
  voltron: {
    sections: [
      { id: 'equipment-auras', label: 'Equipment & Auras', description: 'Powerful equipment and auras to suit up your creature', role: 'support', scryfallHints: ['t:equipment r>=uncommon', 't:aura t:enchantment (o:"+2" OR o:"+3")'] },
      { id: 'voltron-carriers', label: 'Voltron Carriers', description: 'Creatures suited for carrying equipment and auras', role: 'creatures', scryfallHints: ['keyword:hexproof t:creature', 'keyword:double_strike t:creature'] },
      { id: 'protection', label: 'Protection', description: 'Spells to protect your equipped creature', role: 'spells', scryfallHints: ['o:hexproof OR o:indestructible (t:instant)'] },
      { id: 'removal', label: 'Removal', description: 'Removal to clear blockers', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) t:instant'] },
    ],
    weights: [10, 8, 4, 4],
    landCount: 24,
  },
  mill: {
    sections: [
      { id: 'mill-effects', label: 'Mill Effects', description: 'Cards that put opponent cards from library into graveyard', role: 'spells', scryfallHints: ['o:mill r>=uncommon', 'o:"puts the top" o:"into their graveyard"'] },
      { id: 'defensive-creatures', label: 'Defensive Creatures', description: 'Creatures that block while you mill', role: 'creatures', scryfallHints: ['tou>=3 t:creature cmc<=3'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Card draw to find mill pieces', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', label: 'Removal', description: 'Removal to survive against aggressive decks', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile OR o:counter) (t:instant OR t:sorcery)'] },
    ],
    weights: [12, 6, 4, 4],
    landCount: 24,
  },
  lifegain: {
    sections: [
      { id: 'lifegain-payoffs', label: 'Lifegain Payoffs', description: 'Cards that reward you for gaining life', role: 'creatures', scryfallHints: ['o:"whenever you gain life" r>=uncommon'] },
      { id: 'life-gainers', label: 'Life Gainers', description: 'Efficient cards that gain life reliably', role: 'creatures', scryfallHints: ['keyword:lifelink t:creature', 'o:"gain life"'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Card draw to keep the engine going', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', label: 'Removal', description: 'Removal to protect your lifegain engine', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [10, 8, 4, 4],
    landCount: 24,
  },
  reanimator: {
    sections: [
      { id: 'reanimate-spells', label: 'Reanimate Spells', description: 'Spells that return creatures from graveyard to battlefield', role: 'spells', scryfallHints: ['o:"return" o:"from your graveyard to the battlefield" r>=uncommon'] },
      { id: 'big-targets', label: 'Reanimate Targets', description: 'Expensive creatures worth reanimating', role: 'creatures', scryfallHints: ['cmc>=6 pow>=6 t:creature r>=rare'] },
      { id: 'self-mill-discard', label: 'Self-Mill & Discard', description: 'Ways to get big creatures into the graveyard', role: 'support', scryfallHints: ['o:"put" o:"into your graveyard"', 'o:mill o:"your library"'] },
      { id: 'removal', label: 'Removal', description: 'Removal to survive the early game', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Card filtering and draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
    ],
    weights: [6, 6, 6, 4, 4],
    landCount: 24,
  },
  burn: {
    sections: [
      { id: 'burn-spells', label: 'Burn Spells', description: 'Direct damage spells targeting any target', role: 'spells', scryfallHints: ['o:"damage to any target" (t:instant OR t:sorcery)', 'o:"deals" o:"damage" (t:instant OR t:sorcery) cmc<=3'] },
      { id: 'aggressive-creatures', label: 'Aggressive Creatures', description: 'Fast creatures that deal damage quickly', role: 'creatures', scryfallHints: ['pow>=2 cmc<=2 t:creature', 'keyword:haste t:creature'] },
      { id: 'card-draw', label: 'Card Draw', description: 'Ways to refuel after dumping your hand', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [14, 8, 4],
    landCount: 22,
  },
}

/** Default template when no archetype matches */
const DEFAULT_TEMPLATE: SectionTemplate = {
  sections: [
    { id: 'creatures', label: 'Creatures', description: 'Creatures for your deck strategy', role: 'creatures', scryfallHints: ['t:creature'] },
    { id: 'spells', label: 'Spells', description: 'Instants and sorceries', role: 'spells', scryfallHints: ['(t:instant OR t:sorcery)'] },
    { id: 'support', label: 'Support', description: 'Enchantments, artifacts, and other support cards', role: 'support', scryfallHints: ['(t:enchantment OR t:artifact)'] },
    { id: 'removal', label: 'Removal', description: 'Removal to handle opponent threats', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
  ],
  weights: [16, 6, 4, 4],
  landCount: 24,
}

/**
 * Resolve tribal section labels when a specific tribe trait is selected.
 */
function resolveTribeLabels(sections: Omit<DeckSection, 'targetCount'>[], traits: string[]): Omit<DeckSection, 'targetCount'>[] {
  // Find selected tribal creature types
  const tribalTraits = traits
    .map((id) => getTraitById(id))
    .filter((t) => t && t.category === 'tribal')

  if (tribalTraits.length === 0) return sections

  const tribe = tribalTraits[0]!
  const tribeName = tribe.label // e.g. "Elves", "Goblins"
  const tribeQuery = tribe.scryfallQueries[0] ?? '' // e.g. "t:elf"

  return sections.map((s) => {
    if (s.id === 'tribal-lords') {
      return { ...s, label: `${tribeName} Lords & Payoffs`, scryfallHints: [...s.scryfallHints, tribeQuery] }
    }
    if (s.id === 'tribal-core') {
      return { ...s, label: `Core ${tribeName}`, scryfallHints: [tribeQuery] }
    }
    if (s.id === 'tribal-support') {
      return { ...s, label: `${tribeName} Support`, scryfallHints: [tribeQuery, ...s.scryfallHints] }
    }
    return s
  })
}

/**
 * Pick the best-matching section for a card based on its type line and
 * oracle text. Used when the chat flow adds new cards without an explicit
 * target section so they don't all fall into the "Other Cards" bucket.
 *
 * Returns the section id, or null if nothing in the plan accepts the card.
 */
export function pickSectionForCard(
  card: ScryfallCard,
  sections: DeckSection[],
): string | null {
  const tl = card.type_line.toLowerCase()
  const text = (card.oracle_text || '').toLowerCase()

  // Role preference by card type. Order matters - first role that exists in
  // the plan wins. Instant/sorcery is ambiguous so we look at oracle text to
  // decide whether it's interaction (removal/counter) or a spell payoff.
  let preferredRoles: DeckSection['role'][] = []

  if (tl.includes('land')) {
    preferredRoles = ['lands']
  } else if (tl.includes('creature')) {
    preferredRoles = ['creatures']
  } else if (tl.includes('instant') || tl.includes('sorcery')) {
    const looksLikeInteraction = /\b(destroy|exile|counter target|return target .* to)\b/.test(text)
    preferredRoles = looksLikeInteraction
      ? ['interaction', 'spells', 'support']
      : ['spells', 'interaction', 'support']
  } else if (tl.includes('enchantment') || tl.includes('artifact')) {
    preferredRoles = ['support', 'spells']
  }

  if (preferredRoles.length === 0) return null

  for (const role of preferredRoles) {
    const match = sections.find((s) => s.role === role)
    if (match) return match.id
  }
  return null
}

/**
 * Derive the section plan from selected archetypes and traits.
 * Core cards are already accounted for - this plans the remaining slots.
 */
export function deriveSectionPlan(
  archetypes: string[],
  traits: string[],
  coreCardCount: number,
): DeckSection[] {
  const primary = archetypes[0]
  const secondary = archetypes[1]

  // Get primary template
  let template = (primary && TEMPLATES[primary]) ? TEMPLATES[primary] : DEFAULT_TEMPLATE

  // Resolve tribal labels if applicable
  let baseSections = resolveTribeLabels([...template.sections], traits)

  // If secondary archetype, merge in one key section from it
  if (secondary && TEMPLATES[secondary]) {
    const secTemplate = TEMPLATES[secondary]
    // Find a section from secondary that doesn't duplicate a role already present
    const existingRoles = new Set(baseSections.map((s) => s.role))
    const newSection = secTemplate.sections.find((s) => !existingRoles.has(s.role))
    if (newSection) {
      baseSections.push(newSection)
      // Extend weights
      const secWeight = secTemplate.weights[secTemplate.sections.indexOf(newSection)] ?? 4
      template = {
        ...template,
        weights: [...template.weights, secWeight],
      }
    }
  }

  // Calculate available slots
  const landCount = template.landCount
  const availableSlots = Math.max(60 - coreCardCount - landCount, baseSections.length * 2)
  const totalWeight = template.weights.slice(0, baseSections.length).reduce((s, w) => s + w, 0)

  // Distribute slots proportionally, then clamp so total doesn't exceed availableSlots
  const sections: DeckSection[] = []
  let distributed = 0

  for (let i = 0; i < baseSections.length; i++) {
    const weight = template.weights[i] ?? 4
    const isLast = i === baseSections.length - 1
    const remaining = availableSlots - distributed
    const count = isLast
      ? remaining
      : Math.min(Math.round((weight / totalWeight) * availableSlots), remaining - (baseSections.length - i - 1) * 2)

    const clamped = Math.max(count, 2)
    sections.push({
      ...baseSections[i],
      targetCount: clamped,
    })
    distributed += clamped
  }

  // Add lands section - absorb any rounding mismatch
  const currentTotal = coreCardCount + sections.reduce((s, sec) => s + sec.targetCount, 0)
  const actualLandCount = Math.max(60 - currentTotal, 18)

  sections.push({
    id: 'lands',
    label: 'Lands',
    description: 'Mana base to support the deck',
    targetCount: actualLandCount,
    role: 'lands',
    scryfallHints: [],
  })

  return sections
}

