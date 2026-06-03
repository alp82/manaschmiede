/**
 * Trait/theme → Scryfall query-fragment extraction for the AI card pool.
 *
 * Turns a free-text deck prompt into a handful of Scryfall search queries
 * (tribal, theme, removal, creature catch-all) scoped to the deck's colors.
 * Used by both chat() (buildCardPool) and fillSection() (buildSectionCardPool).
 *
 * Zero-dependency pure TypeScript — no ActionCtx / scryfallSearch / callHaiku
 * imports — so it can be imported from src/ node tests the same way
 * convex/lib/strategyQueries.ts is. Adding runtime imports here would drag the
 * Convex runtime into the node test; keep this file dependency-free.
 */

/**
 * Merge a persisted deck strategy with a live chat message into a single parse
 * input. Persisted-strategy-first: the anchor theme is never displaced by a
 * long conversational turn. The live message is trimmed and capped at `cap`
 * characters so a runaway message degrades gracefully. Either or both parts may
 * be absent — filter(Boolean) drops empty/whitespace-only strings so the result
 * has no leading or trailing '. '.
 */
export function buildCombinedStrategy(
  customStrategy: string | undefined,
  liveMessage: string,
  cap: number,
): string {
  return [customStrategy?.trim(), (liveMessage ?? '').trim().slice(0, cap)]
    .filter(Boolean)
    .join('. ')
}

/**
 * Extract keyword/tribal/theme Scryfall query fragments from a free-text prompt.
 *
 * Detects creature types (tribal), theme keywords (lifegain, mill, burn, …), and
 * colors from both the prompt text and the explicit `colors` array, then emits
 * up to 4 color-scoped Scryfall query strings. When `hasStrategy` is true the
 * broad `t:creature` catch-all is suppressed so a themed pool is not diluted by
 * generic creatures; the removal/utility query is always emitted regardless.
 */
export function extractSearchQueries(
  prompt: string,
  colors?: string[],
  hasStrategy = false,
): string[] {
  const queries: string[] = []
  const lower = prompt.toLowerCase()

  // Color mapping
  const colorMap: Record<string, string> = {
    rot: 'r', red: 'r', schwarz: 'b', black: 'b',
    blau: 'u', blue: 'u', gruen: 'g', grün: 'g', green: 'g',
    weiss: 'w', weiß: 'w', white: 'w',
  }

  const detectedColors = new Set<string>()
  for (const [word, code] of Object.entries(colorMap)) {
    if (lower.includes(word)) detectedColors.add(code)
  }
  if (colors) colors.forEach((c) => detectedColors.add(c.toLowerCase()))

  const colorFilter = detectedColors.size > 0
    ? ` c:${Array.from(detectedColors).join('')}`
    : ''

  // Creature type / tribal detection
  const tribalPatterns = [
    'elf', 'elfen', 'elves', 'goblin', 'merfolk', 'meervolk', 'dragon', 'drachen',
    'zombie', 'vampire', 'angel', 'engel', 'demon', 'daemon', 'knight', 'ritter',
    'wizard', 'zauberer', 'warrior', 'krieger', 'soldier', 'soldat', 'beast',
    'elemental', 'spirit', 'geist', 'faerie', 'dinosaur', 'dinosaurier',
    'cat', 'katze', 'bird', 'vogel', 'snake', 'schlange', 'spider', 'spinne',
    'rat', 'ratte', 'human', 'mensch', 'cleric', 'kleriker', 'rogue', 'schurke',
    'shaman', 'schamane', 'druid', 'druide', 'pirate', 'skeleton', 'skelett',
  ]

  for (const tribe of tribalPatterns) {
    if (lower.includes(tribe)) {
      const englishTribe = tribe.replace(/en$/, '') // rough de->en
      queries.push(`t:creature t:${englishTribe}${colorFilter}`)
      break
    }
  }

  // Theme detection
  const themes: Record<string, string> = {
    'lifegain': 'o:"gain life"',
    'leben': 'o:"gain life"',
    'token': 'o:"create" o:"token"',
    'graveyard': 'o:graveyard',
    'friedhof': 'o:graveyard',
    'counter': 'o:"+1/+1 counter"',
    'mill': 'o:mill',
    'burn': 'o:"damage to" t:instant',
    'aggro': 'cmc<=3 t:creature',
    'control': 't:instant o:counter',
    'ramp': 'o:"search your library" o:land',
    'equipment': 't:equipment',
    'enchantment': 't:enchantment',
    'artifact': 't:artifact',
    'flyer': 'o:flying t:creature',
    'flieger': 'o:flying t:creature',
    'removal': '(o:destroy OR o:exile) t:instant',
    'sacrifice': 'o:"whenever" o:"dies"',
    'sacrifice-payoff': 'o:"whenever a creature dies"',
    'drain': 'o:"loses" o:"life" o:"gain"',
    'mana fixing': 't:artifact o:"add" o:"mana of any color"',
    'multicolor': 'id>=3 t:creature r>=rare',
    'goodstuff': 't:artifact o:"add" o:"mana of any color"',
  }

  for (const [keyword, query] of Object.entries(themes)) {
    if (lower.includes(keyword)) {
      queries.push(`${query}${colorFilter}`)
    }
  }

  // General creature search for the colors. Suppressed when a strategy is
  // present: the strategy supplies its own theme, so this broad catch-all would
  // dilute the themed pool. Removal below stays unconditional — every deck wants
  // interaction regardless of theme.
  if (colorFilter && queries.length === 0 && !hasStrategy) {
    queries.push(`t:creature${colorFilter}`)
  }

  // Always add a removal + utility search
  if (colorFilter) {
    queries.push(`(o:destroy OR o:exile OR o:damage) (t:instant OR t:sorcery)${colorFilter}`)
  }

  return queries.slice(0, 4) // max 4 searches
}
