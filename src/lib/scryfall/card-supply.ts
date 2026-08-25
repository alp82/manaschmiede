/**
 * The one door to Scryfall card data by ID.
 *
 * Everything that needs "give me these cards, in this language" goes through
 * `cardsById`. The ordering constraint that used to live in a doc comment on
 * `getCardsCollection` — *batch first, then upgrade each print to the
 * requested language* — is executed here instead of being re-implemented by
 * every caller.
 *
 * Pipeline
 * --------
 *   1. dedupe the requested ids
 *   2. satisfy what `have` already covers (no network)
 *   3. ONE `/cards/collection` POST for everything still cold
 *   4. localize the remainder with bounded concurrency
 *
 * Step 3 is what makes step 4 cheap: the collection hop hands us the default
 * print, so every localization call has a real `set` + `collector_number` and
 * takes the `/cards/{set}/{cn}/{lang}` fast path instead of the id fallback.
 * Callers that pass `have` skip step 3 for those ids entirely and go straight
 * to the fast path with the set/collector number they already hold.
 *
 * Resolution contract (this is the part `deck/new.tsx` depends on)
 * ---------------------------------------------------------------
 * - **Key present** in the returned map: resolved.
 * - **Key absent** (or `cardById` returning `null`): Scryfall does not know
 *   that id. It is safe to drop it — retrying will not help.
 * - **Throws**: transient failure (network, 5xx, rate limit). Nothing is
 *   claimed about the ids; retry later.
 *
 * That is deliberately different from `getLocalizedCardData`, which collapses
 * both failure modes into `null` and leaves the caller unable to tell an
 * invalid deck-link from a flaky connection.
 *
 * Deduplication happens on three levels:
 *   1. within a call — a `Set` over the requested ids
 *   2. across concurrent calls — the in-flight registry below, which is what
 *      collapses several chat code paths all asking for Forest in one turn
 *   3. across time — `queryClient` seeding under `scryfallKeys.card`
 *
 * The `ScryfallTransport` seam exists so this module is testable without a
 * network, a DOM, or module mocking: pass a plain object of fakes to
 * `createCardSupply`.
 */
import type { QueryClient } from '@tanstack/react-query'
import { getCardsCollection, getLocalizedCardData } from './client'
import { scryfallKeys } from './keys'
import type { ScryfallCard } from './types'

/** The two network operations the supply needs. Faked wholesale in tests. */
export interface ScryfallTransport {
  /** Batched default-print lookup. Unknown ids are simply absent from the result. */
  collection(ids: string[]): Promise<ScryfallCard[]>
  /** Upgrade one card to `lang`. Never throws; falls back to `existing`. */
  localize(
    existing: ScryfallCard | null | undefined,
    id: string,
    set: string | undefined,
    collectorNumber: string | undefined,
    lang: string,
  ): Promise<ScryfallCard | null>
}

/** The real transport: the rate-limited Scryfall HTTP client. */
export const httpTransport: ScryfallTransport = {
  collection: (ids) => getCardsCollection(ids),
  localize: (existing, id, set, collectorNumber, lang) =>
    getLocalizedCardData(existing, id, set, collectorNumber, lang),
}

/** Just the slice of QueryClient the supply touches — keeps tests dependency-free. */
type CacheSink = Pick<QueryClient, 'setQueryData'>

export interface CardsByIdOptions {
  /** Cards the caller already holds. Matching-language entries cost no network. */
  have?: ReadonlyMap<string, ScryfallCard>
  /** Skip the localization pass — the default (English) print is good enough. */
  defaultPrintOnly?: boolean
  /** Stop caring about the result. Rejects with an `AbortError`. */
  signal?: AbortSignal
  /** When given, resolved cards are seeded under `scryfallKeys.card`. */
  queryClient?: CacheSink
  /**
   * Fires as each card lands — once with the default print, again with the
   * localized upgrade. Lets a caller paint progressively instead of waiting
   * for the whole batch.
   */
  onCard?: (card: ScryfallCard) => void
}

export interface CardSupply {
  /**
   * Resolve every id to a card in `lang`.
   *
   * @throws on transient transport failure. An id Scryfall does not know is
   *   reported by its absence from the map, not by an exception.
   */
  cardsById(
    ids: readonly (string | undefined)[],
    lang: string,
    opts?: CardsByIdOptions,
  ): Promise<ReadonlyMap<string, ScryfallCard>>
  /**
   * One-card form of `cardsById`. `null` means "Scryfall does not know this
   * id"; a throw means "try again later".
   */
  cardById(
    id: string,
    lang: string,
    opts?: CardsByIdOptions,
  ): Promise<ScryfallCard | null>
}

export interface CardSupplyOptions {
  /**
   * How many localization requests may be outstanding at once. They still
   * queue behind the client's 75ms Scryfall spacing — this only overlaps RTT.
   */
  localizeConcurrency?: number
}

const DEFAULT_LOCALIZE_CONCURRENCY = 6

function abortError(): Error {
  const err = new Error('cardsById aborted')
  err.name = 'AbortError'
  return err
}

/** Run `fn` over `items`, at most `limit` at a time, in no guaranteed order. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export function createCardSupply(
  transport: ScryfallTransport = httpTransport,
  options: CardSupplyOptions = {},
): CardSupply {
  const localizeConcurrency = options.localizeConcurrency ?? DEFAULT_LOCALIZE_CONCURRENCY

  /**
   * Ids currently being fetched, so two overlapping calls issue one request.
   * `defaultPrintOnly` is part of the key: a default-print request must not
   * hand its unlocalized answer to a caller that asked for a localized one.
   */
  const inFlight = new Map<string, Promise<ScryfallCard | null>>()
  const keyOf = (id: string, lang: string, defaultPrintOnly: boolean | undefined) =>
    defaultPrintOnly ? `${id}:${lang}:default` : `${id}:${lang}`

  function seed(sink: CacheSink | undefined, card: ScryfallCard, lang: string): void {
    if (!sink) return
    sink.setQueryData(scryfallKeys.card(card.id, card.lang), card)
    // Seed the active-locale key too so remounts under the same locale hit
    // the cache; a localization upgrade overwrites this entry later.
    sink.setQueryData(scryfallKeys.card(card.id, lang), card)
  }

  async function cardsById(
    ids: readonly (string | undefined)[],
    lang: string,
    opts: CardsByIdOptions = {},
  ): Promise<ReadonlyMap<string, ScryfallCard>> {
    if (opts.signal?.aborted) throw abortError()

    const resolved = new Map<string, ScryfallCard>()
    /** Ids another in-flight call is already fetching. */
    const joined: Array<[string, Promise<ScryfallCard | null>]> = []
    /** Ids we hold a wrong-language print for — straight to the fast path. */
    const upgradable: Array<[string, ScryfallCard]> = []
    /** Ids we hold nothing for — these need the collection hop. */
    const cold: string[] = []

    const seen = new Set<string>()
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)

      const held = opts.have?.get(id)
      if (held && (opts.defaultPrintOnly || held.lang === lang)) {
        resolved.set(id, held)
        continue
      }

      const pending = inFlight.get(keyOf(id, lang, opts.defaultPrintOnly))
      if (pending) {
        joined.push([id, pending])
        continue
      }

      if (held) upgradable.push([id, held])
      else cold.push(id)
    }

    // Register every id we own BEFORE any await, so a concurrent call started
    // in the same tick joins us instead of firing its own collection request.
    const settle = new Map<string, (card: ScryfallCard | null) => void>()
    const reject = new Map<string, (err: unknown) => void>()
    const owned = new Map<string, Promise<ScryfallCard | null>>()
    const claim = (id: string) => {
      const promise = new Promise<ScryfallCard | null>((res, rej) => {
        settle.set(id, res)
        reject.set(id, rej)
      })
      // A joiner may never attach; don't let a rejection go unhandled.
      promise.catch(() => {})
      owned.set(id, promise)
      inFlight.set(keyOf(id, lang, opts.defaultPrintOnly), promise)
    }
    for (const id of cold) claim(id)
    for (const [id] of upgradable) claim(id)

    const run = async (): Promise<void> => {
      let collectionError: unknown = null
      const defaults = new Map<string, ScryfallCard>()

      if (cold.length > 0) {
        try {
          for (const card of await transport.collection(cold)) defaults.set(card.id, card)
        } catch (err) {
          collectionError = err
        }
      }

      if (collectionError) {
        for (const id of cold) reject.get(id)!(collectionError)
      } else {
        for (const id of cold) {
          const card = defaults.get(id)
          if (!card) {
            // Requested but not returned: Scryfall has no such id. Absence
            // from the result map is how the caller learns that.
            settle.get(id)!(null)
            continue
          }
          seed(opts.queryClient, card, lang)
          opts.onCard?.(card)
          if (opts.defaultPrintOnly || card.lang === lang) settle.get(id)!(card)
        }
      }

      if (opts.defaultPrintOnly) {
        if (collectionError) throw collectionError
        return
      }

      const jobs: Array<[string, ScryfallCard]> = []
      for (const [id, card] of defaults) {
        if (card.lang !== lang) jobs.push([id, card])
      }
      // Wrong-language cards the caller already held never needed the
      // collection hop — they carry their own set + collector number.
      jobs.push(...upgradable)

      await mapWithConcurrency(jobs, localizeConcurrency, async ([id, existing]) => {
        const localized = await transport.localize(
          existing,
          id,
          existing.set,
          existing.collector_number,
          lang,
        )
        if (localized && localized.lang === lang) {
          seed(opts.queryClient, localized, lang)
          opts.onCard?.(localized)
        }
        // `localize` never throws; worst case it hands back what we passed in.
        settle.get(id)!(localized ?? existing)
      })

      if (collectionError) throw collectionError
    }

    const pipeline = (async () => {
      try {
        await run()
      } finally {
        for (const id of owned.keys()) {
          inFlight.delete(keyOf(id, lang, opts.defaultPrintOnly))
        }
      }
    })()

    const work = (async () => {
      await Promise.all([pipeline, ...joined.map(([, p]) => p)])
      for (const [id, promise] of [...owned, ...joined]) {
        const card = await promise
        if (card) resolved.set(id, card)
      }
      return resolved as ReadonlyMap<string, ScryfallCard>
    })()

    if (!opts.signal) return work
    const signal = opts.signal
    work.catch(() => {})
    return new Promise<ReadonlyMap<string, ScryfallCard>>((res, rej) => {
      const onAbort = () => rej(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(res, rej).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  async function cardById(
    id: string,
    lang: string,
    opts: CardsByIdOptions = {},
  ): Promise<ScryfallCard | null> {
    const cards = await cardsById([id], lang, opts)
    return cards.get(id) ?? null
  }

  return { cardsById, cardById }
}

/**
 * The app-wide supply. Sharing one instance is what makes the in-flight
 * registry effective — every caller must import this one, not build its own.
 *
 * A sibling `cardsByName` belongs here too (`getCardByName` has the same
 * one-await-per-card pathology in section fill, chat and combo generation);
 * the deduplication and concurrency machinery above is written to be reused
 * by it.
 */
export const cardSupply = createCardSupply()
