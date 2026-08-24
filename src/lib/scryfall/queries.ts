import { queryOptions } from '@tanstack/react-query'
import { searchCards, listSets } from './client'
import { cardSupply } from './card-supply'
import { scryfallKeys } from './keys'
import type { ScryfallCard } from './types'


const STALE_24H = 1000 * 60 * 60 * 24

export function cardSearchOptions(query: string, page = 1) {
  return queryOptions({
    queryKey: scryfallKeys.search(query, page),
    queryFn: () => searchCards(query, page),
    staleTime: STALE_24H,
    enabled: query.length >= 1,
  })
}

export function localizedCardOptions(params: {
  id: string
  set?: string
  collectorNumber?: string
  lang: string
  existing?: ScryfallCard | null
}) {
  return queryOptions({
    queryKey: scryfallKeys.card(params.id, params.lang),
    queryFn: async (): Promise<ScryfallCard | null> => {
      // One-element call: the payoff here isn't batching, it's the supply's
      // in-flight registry — several of these mounting alongside a deck-wide
      // `cardsById` collapse into that one request instead of N.
      const have = params.existing
        ? new Map([[params.id, withPrint(params.existing, params.set, params.collectorNumber)]])
        : undefined
      try {
        return await cardSupply.cardById(params.id, params.lang, { have })
      } catch {
        // This hook's callers render a placeholder for missing art and have
        // never seen this query fail; keep it that way.
        return params.existing ?? null
      }
    },
    staleTime: STALE_24H,
    enabled: !!params.id,
  })
}

/**
 * Callers may know a print (set + collector number) that the `existing` card
 * object doesn't carry. Fold it in so the supply can take the fast path.
 */
function withPrint(
  card: ScryfallCard,
  set: string | undefined,
  collectorNumber: string | undefined,
): ScryfallCard {
  if (!set && !collectorNumber) return card
  return {
    ...card,
    set: set ?? card.set,
    collector_number: collectorNumber ?? card.collector_number,
  }
}

export function setsListOptions() {
  return queryOptions({
    queryKey: scryfallKeys.sets(),
    queryFn: listSets,
    staleTime: STALE_24H,
  })
}
