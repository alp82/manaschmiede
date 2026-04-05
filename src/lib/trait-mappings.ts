export type TraitCategory = 'archetype' | 'keyword' | 'mechanic' | 'tribal'

export interface TraitMapping {
  id: string
  label: string
  category: TraitCategory
  scryfallQueries: string[]
  colorAffinity?: string[]
  description: string
}

export const TRAITS: TraitMapping[] = [
  // ─── Archetypes ───────────────────────────────────────────
  {
    id: 'aggro',
    label: 'Aggro',
    category: 'archetype',
    scryfallQueries: ['cmc<=3 t:creature', 'keyword:haste t:creature'],
    colorAffinity: ['R', 'G', 'W'],
    description: 'Fast creatures that end the game quickly',
  },
  {
    id: 'midrange',
    label: 'Midrange',
    category: 'archetype',
    scryfallQueries: ['cmc>=3 cmc<=5 t:creature', 'o:"enters the battlefield" t:creature'],
    colorAffinity: ['G', 'B'],
    description: 'Powerful mid-game threats with value',
  },
  {
    id: 'control',
    label: 'Control',
    category: 'archetype',
    scryfallQueries: ['t:instant o:counter', 'o:destroy (t:instant OR t:sorcery)'],
    colorAffinity: ['U', 'W', 'B'],
    description: 'Counter, remove, and outlast your opponent',
  },
  {
    id: 'combo',
    label: 'Combo',
    category: 'archetype',
    scryfallQueries: ['o:"untap" o:"tap"', 'o:"whenever" o:"you cast"'],
    colorAffinity: ['U', 'R'],
    description: 'Assemble game-winning card combinations',
  },
  {
    id: 'tribal',
    label: 'Tribal',
    category: 'archetype',
    scryfallQueries: ['o:"creatures you control"', 'o:"creature type"'],
    colorAffinity: undefined,
    description: 'Unite creatures of the same type',
  },
  {
    id: 'ramp',
    label: 'Ramp',
    category: 'archetype',
    scryfallQueries: ['o:"search your library" o:land', 'o:"add" o:"mana" t:creature cmc<=2'],
    colorAffinity: ['G'],
    description: 'Accelerate your mana to cast big threats',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    category: 'archetype',
    scryfallQueries: ['o:"create" o:"token"', 'o:"creatures you control get"'],
    colorAffinity: ['W', 'G'],
    description: 'Flood the board with creature tokens',
  },
  {
    id: 'voltron',
    label: 'Voltron',
    category: 'archetype',
    scryfallQueries: ['t:equipment', 't:aura t:enchantment'],
    colorAffinity: ['W', 'R'],
    description: 'Suit up one creature with powerful equipment and auras',
  },
  {
    id: 'mill',
    label: 'Mill',
    category: 'archetype',
    scryfallQueries: ['o:mill', 'o:"puts the top" o:"into their graveyard"'],
    colorAffinity: ['U', 'B'],
    description: 'Win by depleting your opponent\'s library',
  },
  {
    id: 'lifegain',
    label: 'Lifegain',
    category: 'archetype',
    scryfallQueries: ['o:"gain life"', 'o:"whenever you gain life"'],
    colorAffinity: ['W', 'B'],
    description: 'Gain life and turn it into a winning advantage',
  },
  {
    id: 'reanimator',
    label: 'Reanimator',
    category: 'archetype',
    scryfallQueries: ['o:"return" o:"from your graveyard"', 'o:"put" o:"into your graveyard"'],
    colorAffinity: ['B', 'W'],
    description: 'Cheat powerful creatures from the graveyard',
  },
  {
    id: 'burn',
    label: 'Burn',
    category: 'archetype',
    scryfallQueries: ['o:"deals" o:"damage" (t:instant OR t:sorcery)', 'o:"damage to any target"'],
    colorAffinity: ['R'],
    description: 'Deal direct damage to win the game',
  },

  // ─── Combat Keywords ──────────────────────────────────────
  {
    id: 'flying',
    label: 'Flying',
    category: 'keyword',
    scryfallQueries: ['keyword:flying t:creature'],
    colorAffinity: ['W', 'U'],
    description: 'Creatures that can only be blocked by other flyers or reach',
  },
  {
    id: 'trample',
    label: 'Trample',
    category: 'keyword',
    scryfallQueries: ['keyword:trample t:creature'],
    colorAffinity: ['G', 'R'],
    description: 'Excess combat damage carries over to the opponent',
  },
  {
    id: 'deathtouch',
    label: 'Deathtouch',
    category: 'keyword',
    scryfallQueries: ['keyword:deathtouch t:creature'],
    colorAffinity: ['B', 'G'],
    description: 'Any amount of damage from this creature is lethal',
  },
  {
    id: 'lifelink',
    label: 'Lifelink',
    category: 'keyword',
    scryfallQueries: ['keyword:lifelink t:creature'],
    colorAffinity: ['W', 'B'],
    description: 'Damage dealt by this creature also gains you life',
  },
  {
    id: 'first-strike',
    label: 'First Strike',
    category: 'keyword',
    scryfallQueries: ['keyword:first_strike t:creature'],
    colorAffinity: ['W', 'R'],
    description: 'Deals combat damage before creatures without first strike',
  },
  {
    id: 'double-strike',
    label: 'Double Strike',
    category: 'keyword',
    scryfallQueries: ['keyword:double_strike t:creature'],
    colorAffinity: ['R', 'W'],
    description: 'Deals combat damage twice — first strike and regular',
  },
  {
    id: 'vigilance',
    label: 'Vigilance',
    category: 'keyword',
    scryfallQueries: ['keyword:vigilance t:creature'],
    colorAffinity: ['W', 'G'],
    description: 'Attacking does not cause this creature to tap',
  },
  {
    id: 'haste',
    label: 'Haste',
    category: 'keyword',
    scryfallQueries: ['keyword:haste t:creature'],
    colorAffinity: ['R'],
    description: 'Can attack and use tap abilities immediately',
  },
  {
    id: 'hexproof',
    label: 'Hexproof',
    category: 'keyword',
    scryfallQueries: ['keyword:hexproof t:creature'],
    colorAffinity: ['U', 'G'],
    description: 'Cannot be targeted by opponent\'s spells or abilities',
  },
  {
    id: 'menace',
    label: 'Menace',
    category: 'keyword',
    scryfallQueries: ['keyword:menace t:creature'],
    colorAffinity: ['B', 'R'],
    description: 'Must be blocked by two or more creatures',
  },
  {
    id: 'reach',
    label: 'Reach',
    category: 'keyword',
    scryfallQueries: ['keyword:reach t:creature'],
    colorAffinity: ['G'],
    description: 'Can block creatures with flying',
  },
  {
    id: 'indestructible',
    label: 'Indestructible',
    category: 'keyword',
    scryfallQueries: ['keyword:indestructible'],
    colorAffinity: ['W'],
    description: 'Cannot be destroyed by damage or destroy effects',
  },

  // ─── Mechanics ────────────────────────────────────────────
  {
    id: 'flashback',
    label: 'Flashback',
    category: 'mechanic',
    scryfallQueries: ['keyword:flashback'],
    colorAffinity: ['U', 'R'],
    description: 'Cast spells again from your graveyard',
  },
  {
    id: 'cascade',
    label: 'Cascade',
    category: 'mechanic',
    scryfallQueries: ['keyword:cascade'],
    colorAffinity: ['R', 'G'],
    description: 'Casting reveals and casts a cheaper spell for free',
  },
  {
    id: 'proliferate',
    label: 'Proliferate',
    category: 'mechanic',
    scryfallQueries: ['o:proliferate'],
    colorAffinity: ['U'],
    description: 'Add counters to any permanents that already have them',
  },
  {
    id: 'convoke',
    label: 'Convoke',
    category: 'mechanic',
    scryfallQueries: ['keyword:convoke'],
    colorAffinity: ['W', 'G'],
    description: 'Tap creatures to help pay for spells',
  },
  {
    id: 'kicker',
    label: 'Kicker',
    category: 'mechanic',
    scryfallQueries: ['keyword:kicker'],
    colorAffinity: undefined,
    description: 'Pay extra for a more powerful effect',
  },
  {
    id: 'ward',
    label: 'Ward',
    category: 'mechanic',
    scryfallQueries: ['keyword:ward'],
    colorAffinity: ['U'],
    description: 'Opponents must pay extra to target this permanent',
  },
  {
    id: 'flash',
    label: 'Flash',
    category: 'mechanic',
    scryfallQueries: ['keyword:flash t:creature'],
    colorAffinity: ['U'],
    description: 'Cast creatures at instant speed for surprise plays',
  },
  {
    id: 'landfall',
    label: 'Landfall',
    category: 'mechanic',
    scryfallQueries: ['o:"whenever a land enters the battlefield under your control"'],
    colorAffinity: ['G'],
    description: 'Trigger abilities whenever you play a land',
  },
  {
    id: 'madness',
    label: 'Madness',
    category: 'mechanic',
    scryfallQueries: ['keyword:madness'],
    colorAffinity: ['B', 'R'],
    description: 'Cast spells for a discount when you discard them',
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
    budgetLimit?: number | null
    rarities?: string[]
  },
): string[] {
  const queries: string[] = []
  const colorFilter = colors.length > 0 ? ` c:${colors.join('').toLowerCase()}` : ''
  const formatFilter = options?.format && options.format !== 'casual'
    ? ` f:${options.format}`
    : ''
  const budgetFilter = options?.budgetLimit != null
    ? ` usd<=${options.budgetLimit.toFixed(2)}`
    : ''

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
  return [...new Set(queries)].slice(0, 6)
}

/**
 * Build a Scryfall filter suffix from wizard step 1 & 2 selections.
 * Append this to any free-text search query to scope results.
 */
export function buildSearchFilterSuffix(
  colors: string[],
  options?: {
    format?: string
    budgetLimit?: number | null
    rarities?: string[]
  },
): string {
  const colorFilter = colors.length > 0 ? ` c<=${colors.join('').toLowerCase()}` : ''
  const formatFilter = options?.format && options.format !== 'casual'
    ? ` f:${options.format}`
    : ''
  const budgetFilter = options?.budgetLimit != null
    ? ` usd<=${options.budgetLimit.toFixed(2)}`
    : ''

  const allRarities = ['common', 'uncommon', 'rare', 'mythic']
  let rarityFilter = ''
  if (options?.rarities && options.rarities.length > 0 && options.rarities.length < allRarities.length) {
    rarityFilter = ` (${options.rarities.map((r) => `r:${r}`).join(' OR ')})`
  }

  return `${colorFilter}${formatFilter}${budgetFilter}${rarityFilter}`
}
