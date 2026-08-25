/**
 * React Query cache keys for Scryfall data.
 *
 * Lives apart from `queries.ts` so `card-supply.ts` can seed the cache
 * without importing the query-options module that itself depends on the
 * supply.
 */
export const scryfallKeys = {
  all: ['scryfall'] as const,
  search: (query: string, page: number) =>
    [...scryfallKeys.all, 'search', query, page] as const,
  autocomplete: (partial: string) =>
    [...scryfallKeys.all, 'autocomplete', partial] as const,
  card: (id: string, lang: string) => [...scryfallKeys.all, 'card', id, lang] as const,
  sets: () => [...scryfallKeys.all, 'sets'] as const,
}
