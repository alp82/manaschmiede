import { getTraitById } from './trait-mappings'
import type { ScryfallCard } from './scryfall/types'
import type { DynamicKey, TFn } from './i18n/types'
import {
  TARGET_DECK_SIZE,
  fixingLandCountForColors,
  landCountForArchetype,
  splitEvenly,
} from '../../convex/lib/deckRules'

export interface DeckSection {
  id: string
  label: string
  description: string
  targetCount: number
  role: 'creatures' | 'spells' | 'support' | 'interaction' | 'lands'
  /** Scryfall query hints for building card pool */
  scryfallHints: string[]
  /**
   * Trait id of the tribe used to fill the `{tribe}` placeholder in tribal
   * section labels. Persisted alongside the section so labels can be
   * re-localized when the user switches language after deck creation.
   */
  tribalTraitId?: string
}

interface SectionTemplateEntry {
  id: string
  role: DeckSection['role']
  scryfallHints: string[]
}

interface SectionTemplate {
  sections: SectionTemplateEntry[]
  /** Distribution of non-land, non-core slots across sections (proportional weights) */
  weights: number[]
}

const TEMPLATES: Record<string, SectionTemplate> = {
  aggro: {
    sections: [
      { id: 'aggressive-creatures', role: 'creatures', scryfallHints: ['cmc<=2 pow>=2 t:creature', 'keyword:haste t:creature cmc<=3'] },
      { id: 'burn-tricks', role: 'spells', scryfallHints: ['o:"damage" (t:instant OR t:sorcery) cmc<=3', 'o:"gets +'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile OR o:damage) t:instant cmc<=3'] },
    ],
    weights: [16, 6, 4],
  },
  control: {
    sections: [
      { id: 'counterspells', role: 'spells', scryfallHints: ['o:counter t:instant'] },
      { id: 'removal-wipes', role: 'interaction', scryfallHints: ['o:"destroy all" (t:instant OR t:sorcery)', '(o:destroy OR o:exile) t:instant'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'win-conditions', role: 'creatures', scryfallHints: ['t:creature cmc>=4 pow>=4 r>=rare'] },
    ],
    weights: [6, 6, 5, 4],
  },
  midrange: {
    sections: [
      { id: 'value-creatures', role: 'creatures', scryfallHints: ['t:creature cmc>=3 cmc<=5 r>=uncommon', 'o:"enters" t:creature'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-advantage', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:creature)'] },
    ],
    weights: [12, 6, 6],
  },
  combo: {
    sections: [
      { id: 'combo-pieces', role: 'support', scryfallHints: ['o:"untap" o:"tap" r>=uncommon', 'o:"whenever" o:"you cast" r>=rare'] },
      { id: 'protection-tutors', role: 'spells', scryfallHints: ['o:"search your library" r>=uncommon', 'o:hexproof OR o:indestructible'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'interaction', role: 'interaction', scryfallHints: ['(o:counter OR o:destroy OR o:exile) t:instant cmc<=3'] },
    ],
    weights: [8, 6, 6, 4],
  },
  tribal: {
    sections: [
      { id: 'tribal-lords', role: 'creatures', scryfallHints: ['o:"creatures you control get" r>=uncommon'] },
      { id: 'tribal-core', role: 'creatures', scryfallHints: [] },
      { id: 'tribal-support', role: 'support', scryfallHints: [] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [8, 12, 4, 4],
  },
  ramp: {
    sections: [
      { id: 'mana-acceleration', role: 'support', scryfallHints: ['o:"search your library" o:land', 'o:"add" o:"mana" t:creature cmc<=2'] },
      { id: 'mid-threats', role: 'creatures', scryfallHints: ['t:creature cmc>=3 cmc<=5 pow>=3 r>=uncommon', 'o:"enters" t:creature cmc>=3 cmc<=5 r>=uncommon'] },
      { id: 'big-threats', role: 'creatures', scryfallHints: ['cmc>=6 pow>=6 t:creature r>=rare'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [6, 6, 6, 4, 4],
  },
  tokens: {
    sections: [
      { id: 'token-producers', role: 'creatures', scryfallHints: ['o:"create" o:"token" r>=uncommon'] },
      { id: 'anthems', role: 'support', scryfallHints: ['o:"creatures you control get" r>=uncommon'] },
      { id: 'support', role: 'spells', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [12, 6, 4, 4],
  },
  voltron: {
    sections: [
      { id: 'equipment-auras', role: 'support', scryfallHints: ['t:equipment r>=uncommon', 't:aura t:enchantment (o:"+2" OR o:"+3")'] },
      { id: 'voltron-carriers', role: 'creatures', scryfallHints: ['keyword:hexproof t:creature', 'keyword:double_strike t:creature'] },
      { id: 'protection', role: 'spells', scryfallHints: ['o:hexproof OR o:indestructible (t:instant)'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) t:instant'] },
    ],
    weights: [10, 8, 4, 4],
  },
  mill: {
    sections: [
      { id: 'mill-effects', role: 'spells', scryfallHints: ['o:mill r>=uncommon', 'o:"puts the top" o:"into their graveyard"'] },
      { id: 'defensive-creatures', role: 'creatures', scryfallHints: ['tou>=3 t:creature cmc<=3'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile OR o:counter) (t:instant OR t:sorcery)'] },
    ],
    weights: [12, 6, 4, 4],
  },
  lifegain: {
    sections: [
      { id: 'lifegain-payoffs', role: 'creatures', scryfallHints: ['o:"whenever you gain life" r>=uncommon'] },
      { id: 'life-gainers', role: 'creatures', scryfallHints: ['keyword:lifelink t:creature', 'o:"gain life"'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
    ],
    weights: [10, 8, 4, 4],
  },
  reanimator: {
    sections: [
      { id: 'reanimate-spells', role: 'spells', scryfallHints: ['o:"return" o:"from your graveyard to the battlefield" r>=uncommon'] },
      { id: 'big-targets', role: 'creatures', scryfallHints: ['cmc>=6 pow>=6 t:creature r>=rare'] },
      { id: 'self-mill-discard', role: 'support', scryfallHints: ['o:"put" o:"into your graveyard"', 'o:mill o:"your library"'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery)'] },
    ],
    weights: [6, 6, 6, 4, 4],
  },
  burn: {
    sections: [
      { id: 'burn-spells', role: 'spells', scryfallHints: ['o:"damage to any target" (t:instant OR t:sorcery)', 'o:"deals" o:"damage" (t:instant OR t:sorcery) cmc<=3'] },
      { id: 'aggressive-creatures', role: 'creatures', scryfallHints: ['pow>=2 cmc<=2 t:creature', 'keyword:haste t:creature'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [14, 8, 4],
  },
  goodstuff: {
    sections: [
      { id: 'mana-fixing-lands', role: 'lands', scryfallHints: ['t:land o:"any color"', 't:land o:"enters the battlefield tapped" o:"add"', 'o:"search your library" o:"basic land"'] },
      { id: 'mana-fixing', role: 'support', scryfallHints: ['t:artifact o:"add" o:"mana of any color" cmc<=3', 't:artifact o:"add {w}" OR o:"add {u}" OR o:"add {b}" OR o:"add {r}" OR o:"add {g}" cmc<=3'] },
      { id: 'multicolor-threats', role: 'creatures', scryfallHints: ['id>=3 t:creature r>=rare', 'id>=2 t:creature cmc>=4 r>=rare'] },
      { id: 'signature-spells', role: 'spells', scryfallHints: ['id>=2 (t:instant OR t:sorcery) r>=uncommon'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [6, 5, 10, 6, 5, 4],
  },
  sacrifice: {
    sections: [
      { id: 'sacrifice-fodder', role: 'creatures', scryfallHints: ['t:creature cmc<=2', 'o:"create" o:"1/1" o:"token"', 'o:"return" o:"from your graveyard to the battlefield" t:creature cmc<=3'] },
      { id: 'sacrifice-payoffs', role: 'creatures', scryfallHints: ['o:"whenever" o:"dies"', 'o:"whenever a creature dies"', 'o:"deals damage" o:"whenever" o:"cast"'] },
      { id: 'sacrifice-outlets', role: 'support', scryfallHints: ['o:"sacrifice a creature:"', 'o:"sacrifice another creature"'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery)'] },
    ],
    weights: [12, 8, 4, 4],
  },
  drain: {
    sections: [
      { id: 'drain-spells', role: 'spells', scryfallHints: ['o:"loses" o:"life" o:"gain" (t:instant OR t:sorcery)', 'o:"swamps you control" (t:instant OR t:sorcery)', 'o:"each opponent loses" (t:instant OR t:sorcery)'] },
      { id: 'black-threats', role: 'creatures', scryfallHints: ['c:b t:creature cmc>=3 cmc<=5 r>=uncommon', 'o:"swamps you control" t:creature'] },
      { id: 'recursion', role: 'support', scryfallHints: ['o:"return target creature card from your graveyard"', 'o:"return" o:"from your graveyard to your hand" r>=uncommon'] },
      { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) t:creature (t:instant OR t:sorcery)'] },
      { id: 'card-draw', role: 'support', scryfallHints: ['o:"draw" (t:instant OR t:sorcery OR t:enchantment)'] },
    ],
    weights: [8, 10, 4, 4, 4],
  },
}

/** Default template when no archetype matches */
const DEFAULT_TEMPLATE: SectionTemplate = {
  sections: [
    { id: 'creatures', role: 'creatures', scryfallHints: ['t:creature'] },
    { id: 'spells', role: 'spells', scryfallHints: ['(t:instant OR t:sorcery)'] },
    { id: 'support', role: 'support', scryfallHints: ['(t:enchantment OR t:artifact)'] },
    { id: 'removal', role: 'interaction', scryfallHints: ['(o:destroy OR o:exile) (t:instant OR t:sorcery)'] },
  ],
  weights: [16, 6, 4, 4],
}

/** Fixing-lands entry for archetypes whose template doesn't ship its own. */
const GENERIC_FIXING_SECTIONS: SectionTemplateEntry[] = [
  {
    id: 'mana-fixing-lands',
    role: 'lands',
    scryfallHints: [
      't:land o:"add" -o:"enters the battlefield tapped"',
      't:land (t:forest OR t:island OR t:swamp OR t:mountain OR t:plains) -t:basic',
      't:land o:"enters the battlefield tapped" o:"add"',
    ],
  },
]

/**
 * Resolve a section's label/description via i18n. Tribal sections carry a
 * {tribe} placeholder that's filled in with the selected creature type.
 */
function localizeSection(
  entry: SectionTemplateEntry,
  t: TFn,
  tribe: string | null,
): { label: string; description: string } {
  const params = tribe ? { tribe } : undefined
  return {
    label: t(`section.${entry.id}.label`, params),
    description: t(`section.${entry.id}.desc`, params),
  }
}

/**
 * Re-localize a persisted section using the current locale. Returns a new
 * DeckSection with fresh label/description. Falls back to the stored values
 * if the translation key is missing (older persisted decks, unknown ids).
 * Tribal sections interpolate `{tribe}` from the persisted `tribalTraitId`.
 */
export function localizeDeckSection(section: DeckSection, t: TFn): DeckSection {
  // Annotated, not inferred: hoisting these into locals widens them to `string`,
  // which `t` no longer accepts. The comparison below needs them as locals.
  const labelKey: DynamicKey = `section.${section.id}.label`
  const descKey: DynamicKey = `section.${section.id}.desc`
  const params = section.tribalTraitId
    ? { tribe: t(`trait.${section.tribalTraitId}`) }
    : undefined

  const translatedLabel = t(labelKey, params)
  const translatedDesc = t(descKey, params)

  return {
    ...section,
    label: translatedLabel === labelKey ? section.label : translatedLabel,
    description: translatedDesc === descKey ? section.description : translatedDesc,
  }
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
  colors: string[],
  t: TFn,
): DeckSection[] {
  const primary = archetypes[0]
  const extraArchetypes = archetypes.slice(1)

  // Get primary template
  const primaryTemplate = (primary && TEMPLATES[primary]) ? TEMPLATES[primary] : DEFAULT_TEMPLATE

  // Tribal label resolution: use the first selected tribal trait (if any)
  // and run its translated label through the {tribe} placeholder.
  const tribalTrait = traits
    .map((id) => getTraitById(id))
    .find((trait) => trait && trait.category === 'tribal')
  const tribeLabel = tribalTrait ? t(`trait.${tribalTrait.id}`) : null
  const tribalTraitId = tribalTrait?.id
  const tribeQuery = tribalTrait?.scryfallQueries[0] ?? ''

  let baseSections: SectionTemplateEntry[] = [...primaryTemplate.sections]
  let weights = [...primaryTemplate.weights]

  // Merge distinctive sections from every additional archetype. Two
  // archetypes can share role buckets (tokens + reanimator both need
  // creatures, spells, support, interaction), so the merge key is the
  // section id — any id the primary doesn't already provide gets pulled
  // in so the second archetype actually shows up in the plan.
  for (const extraId of extraArchetypes) {
    const extraTemplate = TEMPLATES[extraId]
    if (!extraTemplate) continue
    const existingIds = new Set(baseSections.map((s) => s.id))
    extraTemplate.sections.forEach((section, i) => {
      if (existingIds.has(section.id)) return
      baseSections.push(section)
      // Secondary archetypes contribute as an overlay at half weight so the
      // primary archetype's shape is preserved.
      const rawWeight = extraTemplate.weights[i] ?? 4
      weights.push(Math.max(2, Math.round(rawWeight / 2)))
      existingIds.add(section.id)
    })
  }

  // Split the plan's two budgets. The archetype's land target counts every
  // land in the deck, so a template that ships its own fixing-lands section
  // (goodstuff) draws it from the land budget rather than the spell budget —
  // before issue #45 that section came out of the spell slots and goodstuff
  // carried a land target of 18 to compensate, which matched no other number
  // in the app.
  const fixingLandCount = fixingLandCountForColors(colors.length)
  const spellEntries: SectionTemplateEntry[] = []
  const spellWeights: number[] = []
  const fixingEntries: SectionTemplateEntry[] = []

  baseSections.forEach((entry, i) => {
    if (entry.role === 'lands') {
      // A mono-color deck has nothing to fix, so its fixing section is dropped
      // and the slots go to the residual land section.
      if (fixingLandCount > 0) fixingEntries.push(entry)
    } else {
      spellEntries.push(entry)
      spellWeights.push(weights[i] ?? 4)
    }
  })

  // Calculate available slots
  const landTarget = landCountForArchetype(primary)
  const availableSlots = Math.max(TARGET_DECK_SIZE - coreCardCount - landTarget, spellEntries.length * 2)
  const totalWeight = spellWeights.reduce((s, w) => s + w, 0)

  // Distribute slots proportionally, then clamp so total doesn't exceed availableSlots
  const sections: DeckSection[] = []
  let distributed = 0

  for (let i = 0; i < spellEntries.length; i++) {
    const entry = spellEntries[i]
    const weight = spellWeights[i]
    const isLast = i === spellEntries.length - 1
    const remaining = availableSlots - distributed
    const count = isLast
      ? remaining
      : Math.min(Math.round((weight / totalWeight) * availableSlots), remaining - (spellEntries.length - i - 1) * 2)

    const clamped = Math.max(count, 2)
    const { label, description } = localizeSection(entry, t, tribeLabel)
    const scryfallHints = entry.id.startsWith('tribal-') && tribeQuery
      ? entry.id === 'tribal-core'
        ? [tribeQuery]
        : [...entry.scryfallHints, tribeQuery]
      : entry.scryfallHints
    sections.push({
      id: entry.id,
      label,
      description,
      role: entry.role,
      scryfallHints,
      targetCount: clamped,
      ...(entry.id.startsWith('tribal-') && tribalTraitId
        ? { tribalTraitId }
        : {}),
    })
    distributed += clamped
  }

  // Mana-fixing lands: the archetype's own entry when it ships one (goodstuff
  // has a richer set of hints), otherwise the generic entry for any 2+ color
  // deck. Either way the slots come out of the land budget.
  const fixingSections = fixingEntries.length > 0 ? fixingEntries : GENERIC_FIXING_SECTIONS
  let fixingAllocated = 0
  if (fixingLandCount > 0) {
    for (const { slot, quantity } of splitEvenly(fixingLandCount, fixingSections)) {
      const { label, description } = localizeSection(slot, t, tribeLabel)
      sections.push({
        id: slot.id,
        label,
        description,
        role: slot.role,
        scryfallHints: slot.scryfallHints,
        targetCount: quantity,
      })
      fixingAllocated += quantity
    }
  }

  // Add lands section - absorb any rounding mismatch. What keeps the plan
  // inside LAND_COUNT_RANGE is reserving the land budget before the spell
  // sections are distributed, not a floor here: the plan is 60 cards first, so
  // a core crowded enough to leave less than the band takes the lands down with
  // it rather than planning a 62-card deck.
  const currentTotal = coreCardCount + sections.reduce((s, sec) => s + sec.targetCount, 0)
  const actualLandCount = Math.max(TARGET_DECK_SIZE - currentTotal, 0)

  sections.push({
    id: 'lands',
    label: t('section.lands.label'),
    description: t('section.lands.desc'),
    targetCount: actualLandCount,
    role: 'lands',
    scryfallHints: [],
  })

  return sections
}
