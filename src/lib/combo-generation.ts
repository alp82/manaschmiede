import { searchCards, getCardByName } from './scryfall/client'
import {
  buildScryfallQueriesFromTraits,
  buildSearchFilterSuffix,
  getTraitById,
  getOracleTermsForTraits,
} from './trait-mappings'
import { assembleQueries } from '../../convex/lib/strategyQueries'
import { getCardRejectionReason, getFilterRejectionReason, type DeckFilters } from './card-validation'
import { analyzeComposition, findSynergyIssue } from './synergy-validation'
import type { ScryfallCard } from './scryfall/types'
import type { CoreCombo } from './wizard-state'
import type { SectionFillIntent } from './section-fill-intent'

export interface RejectedCard {
  name: string
  reason: string
}

export interface RejectedCombo {
  name: string
  reason: string
}

export interface GenerateCombosOptions {
  /** Selected + maybe colors — the candidate-pool and validation identity. */
  activeColors: string[]
  /** Hard-committed colors fed to the suggest model. */
  selectedColors: string[]
  /** Tentative colors fed to the suggest model. */
  maybeColors: string[]
  rejectedCards?: RejectedCard[]
  rejectedCombos?: RejectedCombo[]
  pinnedCard?: string
  missingMaybeColors?: string[]
}

export interface GenerateCombosResult {
  combos: CoreCombo[]
  rejectedCards: RejectedCard[]
  rejectedCombos: RejectedCombo[]
}

/** Check if any card in a combo has at least one of the required oracle terms. */
export function comboMatchesKeywords(cards: Array<{ scryfallCard?: ScryfallCard }>, oracleTerms: string[]): boolean {
  if (oracleTerms.length === 0) return true
  for (const { scryfallCard } of cards) {
    if (!scryfallCard) continue
    const text = (scryfallCard.oracle_text || '').toLowerCase()
    const keywordsLower = (scryfallCard.keywords ?? []).map((k) => k.toLowerCase())
    for (const term of oracleTerms) {
      const t = term.toLowerCase()
      if (text.includes(t) || keywordsLower.includes(t)) return true
    }
  }
  return false
}

/**
 * Build the candidate pool, ask the suggest model for combos, resolve each card
 * against Scryfall, and validate combos against the deck filters plus internal
 * synergy. Maybe-color coverage, seed-card pinning, and history/buffer
 * bookkeeping stay with the caller (StepCoreCards).
 */
export async function generateCombos(
  intent: SectionFillIntent,
  locale: string,
  opts: GenerateCombosOptions,
): Promise<GenerateCombosResult> {
  const { activeColors, selectedColors, maybeColors, rejectedCards, rejectedCombos, pinnedCard, missingMaybeColors } = opts
  const allTraitIds = [...intent.selectedArchetypes, ...intent.selectedTraits]

  // Extract verifiable oracle terms from selected traits
  const oracleTerms = getOracleTermsForTraits(intent.selectedTraits)

  // Build Scryfall queries from trait mappings
  const traitQueries = buildScryfallQueriesFromTraits(allTraitIds, activeColors, {
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarities: intent.rarityFilter,
  })

  // Convex client — hoisted above the Scryfall loop so the strategy parse can
  // run before we fetch the pool. (api is the public-action reference object.)
  const { ConvexHttpClient } = await import('convex/browser')
  const { api } = await import('../../convex/_generated/api')
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string
  const client = new ConvexHttpClient(convexUrl)

  // Honor free-text strategy: one Haiku round-trip turns it into on-theme
  // Scryfall fragments that pull matching cards into the candidate pool. This
  // is NOT parallel with the sequential rate-limited Scryfall loop below — it's
  // one extra call up front; the loop is unchanged. A parse failure degrades to
  // the trait-only pool.
  //
  // CLIENT-SIDE TIMEOUT: callHaiku uses bare fetch with no built-in timeout, so
  // a stalled response would hang step-3 on the spinner indefinitely. We race
  // the action against an 8s guard that resolves to { queries: [] }. On timeout
  // the strategy queries are simply empty — combos still generate and the theme
  // still reaches the suggest prompt via the customStrategy arg.
  const STRATEGY_PARSE_TIMEOUT_MS = 8000
  const parsed = intent.customStrategy.trim() !== ''
    ? await Promise.race([
        client.action(api.suggestCombos.parseStrategy, {
          customStrategy: intent.customStrategy,
          selectedColors,
          language: locale,
        }).catch(() => ({ queries: [] as string[] })),
        new Promise<{ queries: string[] }>((resolve) =>
          setTimeout(() => resolve({ queries: [] }), STRATEGY_PARSE_TIMEOUT_MS),
        ),
      ])
    : { queries: [] as string[] }

  // Scope strategy fragments to the deck's colors/budget/rarity. Note
  // the suffix uses c<= (identity-within, "playable in these colors") — this is
  // intentionally more permissive than buildScryfallQueriesFromTraits' c:, so
  // the strategy pool stays broad; the suggest model makes the final pick.
  const suffix = buildSearchFilterSuffix(activeColors, {
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarities: intent.rarityFilter,
  })
  const strategyQueries = parsed.queries.map((q) => q + suffix)

  // Strategy queries are ordered first so the combined cap can't drop them.
  const queries = assembleQueries(strategyQueries, traitQueries)

  // Fetch card pools from Scryfall
  const cardPoolText: string[] = []
  for (const query of queries) {
    try {
      const result = await searchCards(query)
      const cards = result.data ?? []
      for (const c of cards.slice(0, 10)) {
        const type = c.type_line.replace(/ —.*/, '')
        cardPoolText.push(`${c.name} (${c.mana_cost ?? '0'}) [${type}]`)
      }
    } catch {
      // Intentional silent drop: a query that 4xx's (unknown Scryfall operator,
      // untranslated/zero-result fragment) is dropped from the pool. This is not
      // a swallowed bug — the theme still reaches the suggest model via the
      // customStrategy prompt block, so a dropped strategy query degrades
      // gracefully to the trait-only pool.
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  const uniquePool = [...new Set(cardPoolText)]
  const archetypeLabels = intent.selectedArchetypes.map((id) => {
    const trait = getTraitById(id)
    return trait ? `${trait.label} (${trait.description})` : id
  })
  const traitLabels = intent.selectedTraits.map((id) => getTraitById(id)?.label || id)

  // Call Convex action
  const result = await client.action(api.suggestCombos.suggest, {
    cardPool: uniquePool.join('\n'),
    selectedColors,
    maybeColors,
    archetypes: archetypeLabels,
    traits: traitLabels,
    requiredKeywords: oracleTerms.length > 0 ? oracleTerms : undefined,
    pinnedCard: pinnedCard || undefined,
    customStrategy: intent.customStrategy || undefined,
    budgetLimit: intent.budgetMax ?? undefined,
    rejectedCards: rejectedCards && rejectedCards.length > 0 ? rejectedCards : undefined,
    rejectedCombos: rejectedCombos && rejectedCombos.length > 0 ? rejectedCombos : undefined,
    missingMaybeColors: missingMaybeColors && missingMaybeColors.length > 0 ? missingMaybeColors : undefined,
    language: locale,
  })

  // Resolve card images and validate
  const deckFilters: DeckFilters = {
    colors: activeColors,
    budgetMin: intent.budgetMin,
    budgetMax: intent.budgetMax,
    rarities: intent.rarityFilter,
  }
  const validCombos: CoreCombo[] = []
  const newRejectedCards: RejectedCard[] = [...(rejectedCards ?? [])]
  const newRejectedCombos: RejectedCombo[] = [...(rejectedCombos ?? [])]

  // Resolve all combos - reject entire combo if any card fails (description references all cards)
  const matchingCombos: CoreCombo[] = []
  const nonMatchingCombos: CoreCombo[] = []

  for (const combo of result.combos) {
    const resolvedCards: CoreCombo['cards'] = []
    let hasRejection = false

    for (const cardName of combo.cards) {
      try {
        const scryfallCard = await getCardByName(cardName, locale !== 'en' ? locale : undefined)
        const rejection = getCardRejectionReason(scryfallCard) ?? getFilterRejectionReason(scryfallCard, deckFilters)
        if (rejection) {
          newRejectedCards.push({ name: cardName, reason: rejection })
          hasRejection = true
        } else {
          resolvedCards.push({ name: cardName, scryfallId: scryfallCard.id, scryfallCard })
        }
      } catch {
        newRejectedCards.push({ name: cardName, reason: 'Card not found on Scryfall - may not exist' })
        hasRejection = true
      }
    }

    // All cards must resolve - partial combos have broken descriptions
    if (hasRejection || resolvedCards.length < 2) continue

    // Internal synergy check: each card's tribal/type/keyword references
    // must be satisfied by at least one OTHER card in the combo. A combo
    // that includes "Dragon Tempest" without any Dragon is broken.
    const comboComposition = analyzeComposition(
      resolvedCards
        .filter((c) => c.scryfallCard)
        .map((c) => ({ card: c.scryfallCard!, quantity: 1 })),
    )
    let comboSynergyOk = true
    for (const card of resolvedCards) {
      if (!card.scryfallCard) continue
      const issue = findSynergyIssue(card.scryfallCard, comboComposition, {
        tribalThreshold: 1,
        cardTypeThreshold: 1,
        keywordThreshold: 1,
      })
      if (issue) {
        newRejectedCombos.push({ name: combo.name, reason: issue.reason })
        comboSynergyOk = false
        break
      }
    }
    if (!comboSynergyOk) continue

    const resolved: CoreCombo = { name: combo.name, cards: resolvedCards, explanation: combo.explanation }

    if (comboMatchesKeywords(resolvedCards, oracleTerms)) {
      matchingCombos.push(resolved)
    } else {
      nonMatchingCombos.push(resolved)
    }
  }

  // Prefer keyword-matching combos, then fill with non-matching as fallback
  for (const combo of matchingCombos) {
    validCombos.push(combo)
  }
  for (const combo of nonMatchingCombos) {
    validCombos.push(combo)
  }

  return {
    combos: validCombos,
    rejectedCards: newRejectedCards,
    rejectedCombos: newRejectedCombos,
  }
}
