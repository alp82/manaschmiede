import type { ScryfallCard, ScryfallList, ScryfallAutocomplete, ScryfallSetList } from './types'
import { HARD_FILTER_SCRYFALL_QUERY } from '../../../convex/lib/cardFilters'
import { getCardRejectionReason } from '../card-validation'

const SCRYFALL_BASE = 'https://api.scryfall.com'
const MIN_REQUEST_INTERVAL = 75 // Scryfall asks for 50-100ms between requests

let lastRequestTime = 0

async function scryfallFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed))
  }
  lastRequestTime = Date.now()

  const url = new URL(path, SCRYFALL_BASE)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Manaschmiede/0.1',
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ details: res.statusText }))
    throw new Error(
      `Scryfall ${res.status}: ${(error as { details?: string }).details ?? res.statusText}`,
    )
  }

  return res.json() as Promise<T>
}

/**
 * Search Scryfall and return only cards that pass every app-level filter.
 *
 * Scryfall-side: `HARD_FILTER_SCRYFALL_QUERY` rules out most junk at the API
 * level (stickers, Un-sets, oversized, digital-only, etc.) so pagination
 * counts stay honest.
 *
 * Client-side: `getCardRejectionReason` catches the rest — notably
 * commander-only printings like Fallout (`pip`), which Scryfall has no
 * clean set-level exclusion for but which this app refuses to show because
 * it's a 60-card casual deckbuilder.
 */
export async function searchCards(query: string, page = 1): Promise<ScryfallList> {
  const result = await scryfallFetch<ScryfallList>('/cards/search', {
    q: `${query} ${HARD_FILTER_SCRYFALL_QUERY}`,
    page: String(page),
  })
  if (result.data) {
    result.data = result.data.filter((c) => !getCardRejectionReason(c))
  }
  return result
}

export function autocompleteCards(
  partial: string,
): Promise<ScryfallAutocomplete> {
  return scryfallFetch<ScryfallAutocomplete>('/cards/autocomplete', {
    q: partial,
  })
}

export function getCardById(id: string, lang = 'en'): Promise<ScryfallCard> {
  return scryfallFetch<ScryfallCard>(`/cards/${id}`, { lang })
}

export function getCardInLang(set: string, collectorNumber: string, lang: string): Promise<ScryfallCard> {
  return scryfallFetch<ScryfallCard>(`/cards/${set}/${collectorNumber}/${lang}`)
}

export function getCardByName(name: string, lang?: string): Promise<ScryfallCard> {
  const params: Record<string, string> = { fuzzy: name }
  if (lang) params.lang = lang
  return scryfallFetch<ScryfallCard>('/cards/named', params)
}

/**
 * List every set published on Scryfall. Used by the Edition filter dropdown.
 * Callers should filter down to the set types they care about (the search
 * filter uses only expansions, core sets, masters, and commander decks).
 */
export function listSets(): Promise<ScryfallSetList> {
  return scryfallFetch<ScryfallSetList>('/sets')
}
