/**
 * The mechanical gate's Scryfall half. `mechanicalGate.ts` is pure and asks,
 * through `gateProbes`, which card names and queries a response carries; this
 * module looks them up and feeds the facts to `checkRun`. The split is the
 * `strategyParse.ts` / `strategyQueries.ts` one: the rules stay offline and
 * testable, the network lives here.
 *
 * Card existence goes through `POST /cards/collection` in batches of 75 (the
 * endpoint's cap), matched on exact English name - the same name the app
 * would later resolve, so a name that fails here fails the wizard too.
 * Query syntax goes through `/cards/search` with the hard filter attached,
 * exactly as the pool build does; a query Scryfall rejects reads as null and
 * an empty result as 0, and the gate scores both as misses.
 */
import { HARD_FILTER_SCRYFALL_QUERY } from './cardFilters'
import {
  checkRun,
  gateProbes,
  type CardFact,
  type GateFacts,
  type GateRun,
  type GateRunInput,
} from './mechanicalGate'

const SCRYFALL_HEADERS = { 'User-Agent': 'Manaschmiede/0.1', Accept: 'application/json' }
const COLLECTION_BATCH = 75

interface CollectionResponse {
  data?: CardFact[]
  not_found?: Array<{ name?: string }>
}

/**
 * Look up every distinct name. Names Scryfall does not return map to null.
 * A batch that fails outright (network, 5xx) leaves its names absent, which
 * `checkRun` also treats as nonexistent - a gate that cannot verify a card
 * does not pass it.
 */
export async function lookupCards(names: readonly string[]): Promise<Map<string, CardFact | null>> {
  const facts = new Map<string, CardFact | null>()
  for (let i = 0; i < names.length; i += COLLECTION_BATCH) {
    const batch = names.slice(i, i + COLLECTION_BATCH)
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { ...SCRYFALL_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      })
      if (!res.ok) continue
      const data: CollectionResponse = await res.json()
      // Scryfall matches a name case-insensitively and returns the canonical
      // one; key by what the model wrote so the gate finds it again.
      const byLower = new Map((data.data ?? []).map((c) => [c.name.toLowerCase(), c]))
      for (const name of batch) {
        facts.set(name, byLower.get(name.toLowerCase()) ?? null)
      }
    } catch {
      // leave the batch absent
    }
  }
  return facts
}

/** Result count per query, null when Scryfall rejected the query. */
export async function lookupQueries(queries: readonly string[]): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>()
  for (const query of queries) {
    const url = new URL('https://api.scryfall.com/cards/search')
    url.searchParams.set('q', `(${query}) ${HARD_FILTER_SCRYFALL_QUERY}`)
    url.searchParams.set('unique', 'cards')
    try {
      const res = await fetch(url.toString(), { headers: SCRYFALL_HEADERS })
      // Scryfall answers a well-formed query with no hits with 404, and a
      // malformed one with 400. Both are misses; only the 400 is "invalid".
      if (res.status === 404) counts.set(query, 0)
      else if (!res.ok) counts.set(query, null)
      else counts.set(query, ((await res.json()) as { total_cards?: number }).total_cards ?? 0)
    } catch {
      counts.set(query, null)
    }
  }
  return counts
}

/** Judge one run end to end: probe, look up, check. */
export async function runMechanicalGate(input: GateRunInput): Promise<GateRun> {
  const probes = gateProbes(input.site, input.text)
  const [cards, queries] = await Promise.all([lookupCards(probes.cardNames), lookupQueries(probes.queries)])
  const facts: GateFacts = { cards, queries }
  return checkRun(input, facts)
}
