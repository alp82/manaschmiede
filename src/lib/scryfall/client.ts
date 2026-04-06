import type { ScryfallCard, ScryfallList, ScryfallAutocomplete } from './types'

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

export function searchCards(query: string, page = 1): Promise<ScryfallList> {
  return scryfallFetch<ScryfallList>('/cards/search', {
    q: query,
    page: String(page),
  })
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
