export type TraitCategory = 'archetype' | 'keyword' | 'mechanic' | 'tribal'

export interface TraitMapping {
  id: string
  label: string
  category: TraitCategory
  scryfallQueries: string[]
  colorAffinity?: string[]
  description: string
  /** Oracle text terms that can be verified on card data (lowercase). */
  oracleTerms?: string[]
}

export const TRAITS: TraitMapping[] = [
  // ─── Archetypes ───────────────────────────────────────────
  {
    id: 'aggro',
    label: 'Aggro',
    category: 'archetype',
    scryfallQueries: [
      'pow>=2 cmc<=2 t:creature',
      'keyword:haste pow>=3 t:creature',
    ],
    colorAffinity: ['R', 'G', 'W'],
    description: 'Fast creatures that end the game quickly',
  },
  {
    id: 'midrange',
    label: 'Midrange',
    category: 'archetype',
    scryfallQueries: [
      'pow>=4 cmc>=3 cmc<=5 t:creature r>=rare',
      'o:"enters" t:creature cmc>=3 cmc<=5 r>=rare',
    ],
    colorAffinity: ['G', 'B'],
    description: 'Powerful mid-game threats with value',
  },
  {
    id: 'control',
    label: 'Control',
    category: 'archetype',
    scryfallQueries: [
      't:instant o:counter r>=uncommon',
      'o:"destroy all" (t:instant OR t:sorcery)',
      't:creature cmc>=4 (o:draw OR o:"each opponent") r>=rare',
    ],
    colorAffinity: ['U', 'W', 'B'],
    description: 'Counter, remove, and outlast your opponent',
  },
  {
    id: 'combo',
    label: 'Combo',
    category: 'archetype',
    scryfallQueries: [
      'o:"untap" o:"tap" r>=uncommon',
      'o:"whenever" o:"you cast" r>=rare',
      'o:"infinite" OR o:"each time" OR o:"copy" r>=rare',
    ],
    colorAffinity: ['U', 'R'],
    description: 'Assemble game-winning card combinations',
  },
  {
    id: 'tribal',
    label: 'Tribal',
    category: 'archetype',
    scryfallQueries: [
      'o:"creatures you control get" r>=uncommon',
      'o:"creature type" r>=rare',
    ],
    colorAffinity: undefined,
    description: 'Unite creatures of the same type',
  },
  {
    id: 'ramp',
    label: 'Ramp',
    category: 'archetype',
    scryfallQueries: [
      'cmc>=6 pow>=6 t:creature r>=rare',
      'cmc>=7 (t:creature OR t:sorcery) r>=rare',
      'o:"search your library" o:land r>=uncommon',
    ],
    colorAffinity: ['G'],
    description: 'Accelerate your mana to cast game-ending threats',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    category: 'archetype',
    scryfallQueries: [
      'o:"create" o:"token" r>=rare',
      'o:"creatures you control get" r>=uncommon',
    ],
    colorAffinity: ['W', 'G'],
    description: 'Flood the board with creature tokens',
  },
  {
    id: 'voltron',
    label: 'Voltron',
    category: 'archetype',
    scryfallQueries: [
      't:equipment r>=rare',
      't:aura t:enchantment (o:"+2" OR o:"+3" OR o:"double strike")',
    ],
    colorAffinity: ['W', 'R'],
    description: 'Suit up one creature with powerful equipment and auras',
  },
  {
    id: 'mill',
    label: 'Mill',
    category: 'archetype',
    scryfallQueries: [
      'o:mill r>=uncommon',
      'o:"puts the top" o:"into their graveyard" r>=uncommon',
    ],
    colorAffinity: ['U', 'B'],
    description: 'Win by depleting your opponent\'s library',
  },
  {
    id: 'lifegain',
    label: 'Lifegain',
    category: 'archetype',
    scryfallQueries: [
      'o:"whenever you gain life" r>=uncommon',
      'o:"gain life" o:"draw" OR o:"gain life" o:"+1/+1"',
    ],
    colorAffinity: ['W', 'B'],
    description: 'Gain life and turn it into a winning advantage',
  },
  {
    id: 'reanimator',
    label: 'Reanimator',
    category: 'archetype',
    scryfallQueries: [
      'o:"return" o:"from your graveyard to the battlefield" r>=uncommon',
      'cmc>=6 pow>=6 t:creature r>=rare',
      'o:"put" o:"into your graveyard" r>=uncommon',
    ],
    colorAffinity: ['B', 'W'],
    description: 'Cheat powerful creatures from the graveyard',
  },
  {
    id: 'burn',
    label: 'Burn',
    category: 'archetype',
    scryfallQueries: [
      'o:"damage to any target" (t:instant OR t:sorcery)',
      'o:"deals" o:"damage to each" (t:instant OR t:sorcery OR t:creature)',
    ],
    colorAffinity: ['R'],
    description: 'Deal direct damage to win the game',
  },
  {
    id: 'goodstuff',
    label: 'Goodstuff',
    category: 'archetype',
    scryfallQueries: [
      't:artifact o:"add" o:"mana of any color"',
      't:artifact o:"add" cmc<=3',
      'id>=3 r>=rare t:creature',
      'o:"lands you control" o:"any color"',
    ],
    colorAffinity: ['W', 'U', 'B', 'R', 'G'],
    description: 'Splashy multi-color payoffs held together by mana-fixing artifacts',
  },
  {
    id: 'sacrifice',
    label: 'Sacrifice',
    category: 'archetype',
    scryfallQueries: [
      'o:"whenever" o:"dies" r>=uncommon',
      'o:"sacrifice a creature" r>=uncommon',
      'o:"create" o:"token" t:creature cmc<=3',
      'o:"return" o:"from your graveyard" t:creature cmc<=3',
    ],
    colorAffinity: ['B', 'R'],
    description: 'Creatures die for profit — fodder feeds sacrifice payoffs',
  },
  {
    id: 'drain',
    label: 'Drain',
    category: 'archetype',
    scryfallQueries: [
      'o:"loses" o:"life" o:"gain" r>=uncommon',
      'o:"each opponent loses" r>=uncommon',
      'o:"swamps you control" t:creature',
      'o:"return target creature card from your graveyard to your hand" r>=uncommon',
    ],
    colorAffinity: ['B'],
    description: 'Bleed opponents with life-loss spells and recursive black threats',
  },

  // ─── Combat Keywords ──────────────────────────────────────
  {
    id: 'flying',
    label: 'Flying',
    category: 'keyword',
    scryfallQueries: ['keyword:flying t:creature'],
    colorAffinity: ['W', 'U'],
    description: 'Creatures that can only be blocked by other flyers or reach',
    oracleTerms: ['flying'],
  },
  {
    id: 'trample',
    label: 'Trample',
    category: 'keyword',
    scryfallQueries: ['keyword:trample t:creature'],
    colorAffinity: ['G', 'R'],
    description: 'Excess combat damage carries over to the opponent',
    oracleTerms: ['trample'],
  },
  {
    id: 'deathtouch',
    label: 'Deathtouch',
    category: 'keyword',
    scryfallQueries: ['keyword:deathtouch t:creature'],
    colorAffinity: ['B', 'G'],
    description: 'Any amount of damage from this creature is lethal',
    oracleTerms: ['deathtouch'],
  },
  {
    id: 'lifelink',
    label: 'Lifelink',
    category: 'keyword',
    scryfallQueries: ['keyword:lifelink t:creature'],
    colorAffinity: ['W', 'B'],
    description: 'Damage dealt by this creature also gains you life',
    oracleTerms: ['lifelink'],
  },
  {
    id: 'first-strike',
    label: 'First Strike',
    category: 'keyword',
    scryfallQueries: ['keyword:first_strike t:creature'],
    colorAffinity: ['W', 'R'],
    description: 'Deals combat damage before creatures without first strike',
    oracleTerms: ['first strike'],
  },
  {
    id: 'double-strike',
    label: 'Double Strike',
    category: 'keyword',
    scryfallQueries: ['keyword:double_strike t:creature'],
    colorAffinity: ['R', 'W'],
    description: 'Deals combat damage twice - first strike and regular',
    oracleTerms: ['double strike'],
  },
  {
    id: 'vigilance',
    label: 'Vigilance',
    category: 'keyword',
    scryfallQueries: ['keyword:vigilance t:creature'],
    colorAffinity: ['W', 'G'],
    description: 'Attacking does not cause this creature to tap',
    oracleTerms: ['vigilance'],
  },
  {
    id: 'haste',
    label: 'Haste',
    category: 'keyword',
    scryfallQueries: ['keyword:haste t:creature'],
    colorAffinity: ['R'],
    description: 'Can attack and use tap abilities immediately',
    oracleTerms: ['haste'],
  },
  {
    id: 'hexproof',
    label: 'Hexproof',
    category: 'keyword',
    scryfallQueries: ['keyword:hexproof t:creature'],
    colorAffinity: ['U', 'G'],
    description: 'Cannot be targeted by opponent\'s spells or abilities',
    oracleTerms: ['hexproof'],
  },
  {
    id: 'menace',
    label: 'Menace',
    category: 'keyword',
    scryfallQueries: ['keyword:menace t:creature'],
    colorAffinity: ['B', 'R'],
    description: 'Must be blocked by two or more creatures',
    oracleTerms: ['menace'],
  },
  {
    id: 'reach',
    label: 'Reach',
    category: 'keyword',
    scryfallQueries: ['keyword:reach t:creature'],
    colorAffinity: ['G'],
    description: 'Can block creatures with flying',
    oracleTerms: ['reach'],
  },
  {
    id: 'indestructible',
    label: 'Indestructible',
    category: 'keyword',
    scryfallQueries: ['keyword:indestructible'],
    colorAffinity: ['W'],
    description: 'Cannot be destroyed by damage or destroy effects',
    oracleTerms: ['indestructible'],
  },

  // ─── Mechanics ────────────────────────────────────────────
  {
    id: 'flashback',
    label: 'Flashback',
    category: 'mechanic',
    scryfallQueries: ['keyword:flashback'],
    colorAffinity: ['U', 'R'],
    description: 'Cast spells again from your graveyard',
    oracleTerms: ['flashback'],
  },
  {
    id: 'cascade',
    label: 'Cascade',
    category: 'mechanic',
    scryfallQueries: ['keyword:cascade'],
    colorAffinity: ['R', 'G'],
    description: 'Casting reveals and casts a cheaper spell for free',
    oracleTerms: ['cascade'],
  },
  {
    id: 'proliferate',
    label: 'Proliferate',
    category: 'mechanic',
    scryfallQueries: ['o:proliferate'],
    colorAffinity: ['U'],
    description: 'Add counters to any permanents that already have them',
    oracleTerms: ['proliferate'],
  },
  {
    id: 'convoke',
    label: 'Convoke',
    category: 'mechanic',
    scryfallQueries: ['keyword:convoke'],
    colorAffinity: ['W', 'G'],
    description: 'Tap creatures to help pay for spells',
    oracleTerms: ['convoke'],
  },
  {
    id: 'kicker',
    label: 'Kicker',
    category: 'mechanic',
    scryfallQueries: ['keyword:kicker'],
    colorAffinity: undefined,
    description: 'Pay extra for a more powerful effect',
    oracleTerms: ['kicker'],
  },
  {
    id: 'ward',
    label: 'Ward',
    category: 'mechanic',
    scryfallQueries: ['keyword:ward'],
    colorAffinity: ['U'],
    description: 'Opponents must pay extra to target this permanent',
    oracleTerms: ['ward'],
  },
  {
    id: 'flash',
    label: 'Flash',
    category: 'mechanic',
    scryfallQueries: ['keyword:flash t:creature'],
    colorAffinity: ['U'],
    description: 'Cast creatures at instant speed for surprise plays',
    oracleTerms: ['flash'],
  },
  {
    id: 'landfall',
    label: 'Landfall',
    category: 'mechanic',
    scryfallQueries: ['o:"whenever a land enters the battlefield under your control"'],
    colorAffinity: ['G'],
    description: 'Trigger abilities whenever you play a land',
    oracleTerms: ['whenever a land enters'],
  },
  {
    id: 'madness',
    label: 'Madness',
    category: 'mechanic',
    scryfallQueries: ['keyword:madness'],
    colorAffinity: ['B', 'R'],
    description: 'Cast spells for a discount when you discard them',
    oracleTerms: ['madness'],
  },
  {
    id: 'equipment',
    label: 'Equipment',
    category: 'mechanic',
    scryfallQueries: ['t:equipment', 'keyword:equip'],
    colorAffinity: ['W', 'R'],
    description: 'Weapons and armor to suit up your creatures',
    oracleTerms: ['equip'],
  },
  {
    id: 'sagas',
    label: 'Sagas',
    category: 'mechanic',
    scryfallQueries: ['t:saga'],
    colorAffinity: undefined,
    description: 'Enchantments that tell a story over multiple turns',
  },
  {
    id: 'counters',
    label: '+1/+1 Counters',
    category: 'mechanic',
    scryfallQueries: ['o:"+1/+1 counter"'],
    colorAffinity: ['G', 'W'],
    description: 'Grow your creatures with +1/+1 counters',
    oracleTerms: ['+1/+1 counter'],
  },

  // ─── Creature Types (Tribal) ──────────────────────────────
  {
    id: 'elves',
    label: 'Elves',
    category: 'tribal',
    scryfallQueries: ['t:elf'],
    colorAffinity: ['G'],
    description: 'Mana-producing and synergistic forest dwellers',
  },
  {
    id: 'goblins',
    label: 'Goblins',
    category: 'tribal',
    scryfallQueries: ['t:goblin'],
    colorAffinity: ['R'],
    description: 'Aggressive and expendable swarm creatures',
  },
  {
    id: 'zombies',
    label: 'Zombies',
    category: 'tribal',
    scryfallQueries: ['t:zombie'],
    colorAffinity: ['B'],
    description: 'Undead horde that keeps coming back',
  },
  {
    id: 'vampires',
    label: 'Vampires',
    category: 'tribal',
    scryfallQueries: ['t:vampire'],
    colorAffinity: ['B', 'R'],
    description: 'Life-draining creatures of the night',
  },
  {
    id: 'angels',
    label: 'Angels',
    category: 'tribal',
    scryfallQueries: ['t:angel'],
    colorAffinity: ['W'],
    description: 'Powerful flying protectors',
  },
  {
    id: 'dragons',
    label: 'Dragons',
    category: 'tribal',
    scryfallQueries: ['t:dragon'],
    colorAffinity: ['R'],
    description: 'Massive flying firebreathers',
  },
  {
    id: 'merfolk',
    label: 'Merfolk',
    category: 'tribal',
    scryfallQueries: ['t:merfolk'],
    colorAffinity: ['U'],
    description: 'Slippery sea creatures that buff each other',
  },
  {
    id: 'humans',
    label: 'Humans',
    category: 'tribal',
    scryfallQueries: ['t:human'],
    colorAffinity: ['W'],
    description: 'Versatile creatures across all strategies',
  },
  {
    id: 'spirits',
    label: 'Spirits',
    category: 'tribal',
    scryfallQueries: ['t:spirit'],
    colorAffinity: ['W', 'U'],
    description: 'Ethereal flyers with disruptive abilities',
  },
  {
    id: 'elementals',
    label: 'Elementals',
    category: 'tribal',
    scryfallQueries: ['t:elemental'],
    colorAffinity: ['R', 'G'],
    description: 'Primal forces of nature',
  },
  {
    id: 'knights',
    label: 'Knights',
    category: 'tribal',
    scryfallQueries: ['t:knight'],
    colorAffinity: ['W', 'B'],
    description: 'Noble warriors with first strike and equipment synergy',
  },
  {
    id: 'faeries',
    label: 'Faeries',
    category: 'tribal',
    scryfallQueries: ['t:faerie'],
    colorAffinity: ['U', 'B'],
    description: 'Tricky flying creatures with flash and counters',
  },
  {
    id: 'dinosaurs',
    label: 'Dinosaurs',
    category: 'tribal',
    scryfallQueries: ['t:dinosaur'],
    colorAffinity: ['R', 'G'],
    description: 'Massive prehistoric beasts with enrage abilities',
  },
  {
    id: 'cats',
    label: 'Cats',
    category: 'tribal',
    scryfallQueries: ['t:cat'],
    colorAffinity: ['W', 'G'],
    description: 'Agile predators with equipment synergy',
  },
  {
    id: 'rogues',
    label: 'Rogues',
    category: 'tribal',
    scryfallQueries: ['t:rogue'],
    colorAffinity: ['U', 'B'],
    description: 'Stealthy attackers that mill and disrupt',
  },
  {
    id: 'wizards',
    label: 'Wizards',
    category: 'tribal',
    scryfallQueries: ['t:wizard'],
    colorAffinity: ['U'],
    description: 'Spell-slinging magic users',
  },
  {
    id: 'warriors',
    label: 'Warriors',
    category: 'tribal',
    scryfallQueries: ['t:warrior'],
    colorAffinity: ['R', 'W'],
    description: 'Aggressive fighters that reward attacking',
  },
  {
    id: 'beasts',
    label: 'Beasts',
    category: 'tribal',
    scryfallQueries: ['t:beast'],
    colorAffinity: ['G'],
    description: 'Large, efficient creatures with raw power',
  },
]

const traitMap = new Map(TRAITS.map((t) => [t.id, t]))

/** Get verifiable oracle text terms for the given trait IDs. */
export function getOracleTermsForTraits(traitIds: string[]): string[] {
  const terms: string[] = []
  for (const id of traitIds) {
    const trait = traitMap.get(id)
    if (trait?.oracleTerms) terms.push(...trait.oracleTerms)
  }
  return terms
}

export function getTraitById(id: string): TraitMapping | undefined {
  return traitMap.get(id)
}

export function getTraitsByCategory(category: TraitCategory): TraitMapping[] {
  return TRAITS.filter((t) => t.category === category)
}

/**
 * Returns traits sorted by relevance to the selected colors.
 * Traits with color affinity matching selected colors come first.
 */
export function getRelevantTraits(
  selectedColors: string[],
  category?: TraitCategory,
): TraitMapping[] {
  let traits = category ? getTraitsByCategory(category) : TRAITS
  if (selectedColors.length === 0) return traits

  const colorSet = new Set(selectedColors)
  return [...traits].sort((a, b) => {
    const aScore = a.colorAffinity
      ? a.colorAffinity.filter((c) => colorSet.has(c)).length
      : 0
    const bScore = b.colorAffinity
      ? b.colorAffinity.filter((c) => colorSet.has(c)).length
      : 0
    return bScore - aScore
  })
}

/**
 * Build Scryfall query strings from selected traits, colors, and filters.
 * Returns an array of complete query strings ready for the Scryfall API.
 */
export function buildScryfallQueriesFromTraits(
  traitIds: string[],
  colors: string[],
  options?: {
    format?: string
    budgetMin?: number | null
    budgetMax?: number | null
    rarities?: string[]
  },
): string[] {
  const queries: string[] = []
  const colorFilter = colors.length > 0 ? ` c:${colors.join('').toLowerCase()}` : ''
  const formatFilter = options?.format && options.format !== 'casual'
    ? ` f:${options.format}`
    : ''
  const budgetMinFilter = options?.budgetMin != null
    ? ` usd>=${options.budgetMin.toFixed(2)}`
    : ''
  const budgetMaxFilter = options?.budgetMax != null
    ? ` usd<=${options.budgetMax.toFixed(2)}`
    : ''
  const budgetFilter = `${budgetMinFilter}${budgetMaxFilter}`

  // Build rarity filter (exclude unselected rarities)
  const allRarities = ['common', 'uncommon', 'rare', 'mythic']
  let rarityFilter = ''
  if (options?.rarities && options.rarities.length > 0 && options.rarities.length < allRarities.length) {
    rarityFilter = ` (${options.rarities.map((r) => `r:${r}`).join(' OR ')})`
  }

  const suffix = `${colorFilter}${formatFilter}${budgetFilter}${rarityFilter}`

  for (const id of traitIds) {
    const trait = traitMap.get(id)
    if (!trait) continue
    for (const q of trait.scryfallQueries) {
      queries.push(`${q}${suffix}`)
    }
  }

  // Deduplicate and limit
  return [...new Set(queries)].slice(0, 8)
}

/**
 * Build a Scryfall filter suffix from wizard step 1 & 2 selections.
 * Append this to any free-text search query to scope results.
 */
export function buildSearchFilterSuffix(
  colors: string[],
  options?: {
    format?: string
    budgetMin?: number | null
    budgetMax?: number | null
    rarities?: string[]
  },
): string {
  const colorFilter = colors.length > 0 ? ` c<=${colors.join('').toLowerCase()}` : ''
  const formatFilter = options?.format && options.format !== 'casual'
    ? ` f:${options.format}`
    : ''
  const budgetMinFilter = options?.budgetMin != null
    ? ` usd>=${options.budgetMin.toFixed(2)}`
    : ''
  const budgetMaxFilter = options?.budgetMax != null
    ? ` usd<=${options.budgetMax.toFixed(2)}`
    : ''
  const budgetFilter = `${budgetMinFilter}${budgetMaxFilter}`

  const allRarities = ['common', 'uncommon', 'rare', 'mythic']
  let rarityFilter = ''
  if (options?.rarities && options.rarities.length > 0 && options.rarities.length < allRarities.length) {
    rarityFilter = ` (${options.rarities.map((r) => `r:${r}`).join(' OR ')})`
  }

  return `${colorFilter}${formatFilter}${budgetFilter}${rarityFilter}`
}
