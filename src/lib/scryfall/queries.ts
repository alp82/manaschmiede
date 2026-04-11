import { queryOptions } from '@tanstack/react-query'
import { searchCards, autocompleteCards, getCardById, listSets } from './client'

const STALE_24H = 1000 * 60 * 60 * 24

export const scryfallKeys = {
  all: ['scryfall'] as const,
  search: (query: string, page: number) =>
    [...scryfallKeys.all, 'search', query, page] as const,
  autocomplete: (partial: string) =>
    [...scryfallKeys.all, 'autocomplete', partial] as const,
  card: (id: string, lang: string) => [...scryfallKeys.all, 'card', id, lang] as const,
  sets: () => [...scryfallKeys.all, 'sets'] as const,
}

export function cardSearchOptions(query: string, page = 1) {
  return queryOptions({
    queryKey: scryfallKeys.search(query, page),
    queryFn: () => searchCards(query, page),
    staleTime: STALE_24H,
    enabled: query.length >= 1,
  })
}

export function cardAutocompleteOptions(partial: string) {
  return queryOptions({
    queryKey: scryfallKeys.autocomplete(partial),
    queryFn: () => autocompleteCards(partial),
    staleTime: STALE_24H,
    enabled: partial.length >= 1,
  })
}

export function cardByIdOptions(id: string, lang = 'en') {
  return queryOptions({
    queryKey: scryfallKeys.card(id, lang),
    queryFn: () => getCardById(id, lang),
    staleTime: STALE_24H,
    enabled: !!id,
  })
}

export function setsListOptions() {
  return queryOptions({
    queryKey: scryfallKeys.sets(),
    queryFn: listSets,
    staleTime: STALE_24H,
  })
}
