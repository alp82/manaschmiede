import type { ScryfallCard, ScryfallList, ScryfallAutocomplete, ScryfallSetList } from './types'
import { HARD_FILTER_SCRYFALL_QUERY } from '../../../convex/lib/cardFilters'
import { getCardRejectionReason } from '../card-validation'

const SCRYFALL_BASE = 'https://api.scryfall.com'
const MIN_REQUEST_INTERVAL = 75 // Scryfall asks for 50-100ms between requests

const JSON_HEADERS: Record<string, string> = {
  'User-Agent': 'Manaschmiede/0.1',
  Accept: 'application/json',
}

let lastRequestTime = 0
let slotQueue: Promise<void> = Promise.resolve()

/**
 * Wait for this caller's turn to start a request, then claim the next slot.
 *
 * The queue chains on the *reservation*, not on the response, so requests
 * leave 75ms apart and their round trips overlap. Chaining on completion -
 * what this used to do - serialized the whole app behind whatever request was
 * in flight, turning the decks page's 33 card lookups into 33 sequential round
 * trips. The page finished rendering before the data arrived and painted blank
 * plates.
 *
 * The returned promise never rejects, so one failed request can't wedge the
 * queue for everyone behind it.
 */
function takeRequestSlot(): Promise<void> {
  const slot = slotQueue.then(async () => {
    const elapsed = Date.now() - lastRequestTime
    if (elapsed < MIN_REQUEST_INTERVAL) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed))
    }
    lastRequestTime = Date.now()
  })
  slotQueue = slot
  return slot
}

/** Rate-limited JSON request. Throws `Scryfall <status>: <details>` on failure. */
async function scryfallSend<T>(url: URL, init: RequestInit): Promise<T> {
  await takeRequestSlot()

  const res = await fetch(url.toString(), init)

  if (!res.ok) {
    const error = await res.json().catch(() => ({ details: res.statusText }))
    throw new Error(
      `Scryfall ${res.status}: ${(error as { details?: string }).details ?? res.statusText}`,
    )
  }

  return res.json() as Promise<T>
}

function scryfallFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, SCRYFALL_BASE)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return scryfallSend<T>(url, { headers: { ...JSON_HEADERS } })
}

function scryfallFetchPost<T>(path: string, body: unknown): Promise<T> {
  return scryfallSend<T>(new URL(path, SCRYFALL_BASE), {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

/**
 * Fetch a card in the requested language, with smart fallback.
 *
 * - If `existing` is already in the right language, return it (no network).
 * - Else if we have set + collector_number, try the localized print endpoint.
 * - Else / on 404, fall back to getCardById(id, lang) — Scryfall returns the
 *   default printing but with lang=de query, so it still tries to serve DE
 *   if the card has one.
 * - Never throws. Returns `existing` (or null) if every path fails.
 *
 * This is a transport primitive: it collapses "unknown id" and "network is
 * down" into the same `null`, and the set/collector_number fast path only
 * fires for callers that already hold a print. Feature code should go through
 * `card-supply.ts` instead, which batches the default prints first and so
 * always has a print to localize from.
 */
export async function getLocalizedCardData(
  existing: ScryfallCard | null | undefined,
  id: string,
  set: string | undefined,
  collectorNumber: string | undefined,
  lang: string,
): Promise<ScryfallCard | null> {
  if (existing && existing.lang === lang) return existing

  if (set && collectorNumber) {
    try {
      return await getCardInLang(set, collectorNumber, lang)
    } catch {
      // fall through to id-based fetch
    }
  }

  try {
    return await getCardById(id, lang)
  } catch {
    // fall through to existing
  }

  return existing ?? null
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

/**
 * Batch-fetch cards by Scryfall ID via `/cards/collection`. Up to 75
 * identifiers per POST; callers pass any number — we chunk and flatten.
 *
 * Returns default-print English cards only, because the collection endpoint
 * does not accept a `lang` param on ID identifiers. Sequencing that against
 * the per-card localization upgrade is `card-supply.ts`'s job — call
 * `cardsById` rather than re-implementing the order here.
 *
 * Ids Scryfall does not recognise come back in `not_found` and are dropped;
 * callers learn about them by diffing the request against the result.
 */
export async function getCardsCollection(ids: string[]): Promise<ScryfallCard[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 75) chunks.push(ids.slice(i, i + 75))
  const results = await Promise.all(
    chunks.map((chunk) =>
      scryfallFetchPost<{ data: ScryfallCard[]; not_found: unknown[] }>('/cards/collection', {
        identifiers: chunk.map((id) => ({ id })),
      }),
    ),
  )
  return results.flatMap((r) => r.data)
}
