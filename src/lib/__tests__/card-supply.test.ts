import { describe, it, expect, vi } from 'vitest'
import {
  createCardSupply,
  type ScryfallTransport,
} from '../scryfall/card-supply'
import { scryfallKeys } from '../scryfall/keys'
import type { ScryfallCard } from '../scryfall/types'

/**
 * These tests exist because `scryfall/client.ts` is untestable without a
 * network: it owns a module-global request queue and calls `fetch` directly.
 * The supply's transport seam is the whole point — everything below runs on a
 * plain object of `vi.fn()`s under the node-only runner. No DOM, no MSW, no
 * module mocking, and no `lastRequestTime` leaking between files.
 */

function card(id: string, lang = 'en', over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
    lang,
    layout: 'normal',
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    set: `set-${id}`,
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: `cn-${id}`,
    legalities: {},
    ...over,
  }
}

/** A transport that answers from a fixed catalog. Unknown ids are omitted. */
function fakeTransport(
  catalog: Record<string, ScryfallCard>,
  localized: Record<string, ScryfallCard> = {},
): ScryfallTransport & {
  collection: ReturnType<typeof vi.fn>
  localize: ReturnType<typeof vi.fn>
} {
  return {
    collection: vi.fn(async (ids: string[]) =>
      ids.map((id) => catalog[id]).filter((c): c is ScryfallCard => !!c),
    ),
    localize: vi.fn(
      async (
        existing: ScryfallCard | null | undefined,
        id: string,
        _set: string | undefined,
        _cn: string | undefined,
        lang: string,
      ) => localized[`${id}:${lang}`] ?? existing ?? null,
    ),
  }
}

/** Never settles until `release()` is called — for overlap tests. */
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((res) => {
    release = res
  })
  return { promise, release }
}

describe('cardsById — batching', () => {
  it('resolves every id through one collection request', async () => {
    const transport = fakeTransport({ a: card('a'), b: card('b'), c: card('c') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a', 'b', 'c'], 'en')

    expect([...cards.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(transport.collection).toHaveBeenCalledTimes(1)
    expect(transport.collection).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('dedupes repeated ids and drops blanks within a call', async () => {
    const transport = fakeTransport({ a: card('a') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a', 'a', undefined, '', 'a'], 'en')

    expect(transport.collection).toHaveBeenCalledWith(['a'])
    expect(cards.size).toBe(1)
  })

  it('issues no request at all when there is nothing to fetch', async () => {
    const transport = fakeTransport({})
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById([], 'en')

    expect(cards.size).toBe(0)
    expect(transport.collection).not.toHaveBeenCalled()
  })
})

describe('cardsById — the `have` short circuit', () => {
  it('never touches the network for cards already in the requested language', async () => {
    const transport = fakeTransport({ a: card('a'), b: card('b') })
    const supply = createCardSupply(transport)
    const have = new Map([['a', card('a')]])

    const cards = await supply.cardsById(['a', 'b'], 'en', { have })

    expect(transport.collection).toHaveBeenCalledWith(['b'])
    expect(transport.localize).not.toHaveBeenCalled()
    expect(cards.get('a')).toBe(have.get('a'))
  })

  it('skips the collection hop for a held card in the wrong language', async () => {
    const de = card('a', 'de')
    const transport = fakeTransport(
      { a: card('a') },
      { 'a:de': de },
    )
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a'], 'de', {
      have: new Map([['a', card('a')]]),
    })

    // It already had a print to localize from — no batch request needed.
    expect(transport.collection).not.toHaveBeenCalled()
    expect(transport.localize).toHaveBeenCalledTimes(1)
    expect(cards.get('a')).toBe(de)
  })

  it('accepts any held print when defaultPrintOnly is set', async () => {
    const transport = fakeTransport({ a: card('a') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a'], 'de', {
      have: new Map([['a', card('a', 'en')]]),
      defaultPrintOnly: true,
    })

    expect(transport.collection).not.toHaveBeenCalled()
    expect(cards.get('a')?.lang).toBe('en')
  })
})

describe('cardsById — localization', () => {
  it('hands localize a real set and collector number from the collection hop', async () => {
    // This is the fast-path claim: nine call sites used to pass undefined for
    // both, so `/cards/{set}/{cn}/{lang}` was dead code for them.
    const en = card('a', 'en', { set: 'dom', collector_number: '123' })
    const transport = fakeTransport({ a: en }, { 'a:de': card('a', 'de') })
    const supply = createCardSupply(transport)

    await supply.cardsById(['a'], 'de')

    expect(transport.localize).toHaveBeenCalledWith(en, 'a', 'dom', '123', 'de')
  })

  it('skips localization when the default print is already in the language', async () => {
    const transport = fakeTransport({ a: card('a', 'de') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a'], 'de')

    expect(transport.localize).not.toHaveBeenCalled()
    expect(cards.get('a')?.lang).toBe('de')
  })

  it('skips localization entirely under defaultPrintOnly', async () => {
    const transport = fakeTransport({ a: card('a', 'en') }, { 'a:de': card('a', 'de') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a'], 'de', { defaultPrintOnly: true })

    expect(transport.localize).not.toHaveBeenCalled()
    expect(cards.get('a')?.lang).toBe('en')
  })

  it('keeps the default print when no localized print exists', async () => {
    const transport = fakeTransport({ a: card('a', 'en') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a'], 'de')

    expect(cards.get('a')?.lang).toBe('en')
  })

  it('bounds how many localize calls run at once', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const catalog = Object.fromEntries(ids.map((id) => [id, card(id, 'en')]))
    let inFlight = 0
    let peak = 0
    const transport: ScryfallTransport = {
      collection: async (batch) => batch.map((id) => catalog[id]),
      localize: async (existing, id) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight--
        return card(id, 'de')
      },
    }
    const supply = createCardSupply(transport, { localizeConcurrency: 3 })

    await supply.cardsById(ids, 'de')

    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('cardsById — dedupe across concurrent calls', () => {
  it('collapses two overlapping calls into one collection request', async () => {
    const gate = deferred<void>()
    const collection = vi.fn(async (ids: string[]) => {
      await gate.promise
      return ids.map((id) => card(id))
    })
    const supply = createCardSupply({ collection, localize: async () => null })

    const first = supply.cardsById(['forest', 'island'], 'en')
    const second = supply.cardsById(['forest', 'mountain'], 'en')
    gate.release()
    const [a, b] = await Promise.all([first, second])

    expect(collection).toHaveBeenCalledTimes(2)
    // The second call only asked for what the first hadn't claimed.
    expect(collection.mock.calls[0][0]).toEqual(['forest', 'island'])
    expect(collection.mock.calls[1][0]).toEqual(['mountain'])
    expect(a.get('forest')).toBe(b.get('forest'))
  })

  it('an in-flight id is fetched once even across three callers', async () => {
    const gate = deferred<void>()
    const collection = vi.fn(async (ids: string[]) => {
      await gate.promise
      return ids.map((id) => card(id))
    })
    const supply = createCardSupply({ collection, localize: async () => null })

    const calls = [
      supply.cardsById(['forest'], 'en'),
      supply.cardsById(['forest'], 'en'),
      supply.cardsById(['forest'], 'en'),
    ]
    gate.release()
    const results = await Promise.all(calls)

    expect(collection).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r.get('forest')?.id).toBe('forest')
  })

  it('does not let a defaultPrintOnly call answer a localized one', async () => {
    const gate = deferred<void>()
    const transport: ScryfallTransport = {
      collection: vi.fn(async (ids: string[]) => {
        await gate.promise
        return ids.map((id) => card(id, 'en'))
      }),
      localize: vi.fn(async (_e, id) => card(id, 'de')),
    }
    const supply = createCardSupply(transport)

    const cheap = supply.cardsById(['a'], 'de', { defaultPrintOnly: true })
    const full = supply.cardsById(['a'], 'de')
    gate.release()
    const [cheapResult, fullResult] = await Promise.all([cheap, full])

    expect(cheapResult.get('a')?.lang).toBe('en')
    expect(fullResult.get('a')?.lang).toBe('de')
  })

  it('releases the registry so a later call fetches again', async () => {
    const transport = fakeTransport({ a: card('a') })
    const supply = createCardSupply(transport)

    await supply.cardsById(['a'], 'en')
    await supply.cardsById(['a'], 'en')

    expect(transport.collection).toHaveBeenCalledTimes(2)
  })
})

describe('cardsById — unresolvable ids vs transient failure', () => {
  it('omits an id Scryfall does not know', async () => {
    const transport = fakeTransport({ a: card('a') })
    const supply = createCardSupply(transport)

    const cards = await supply.cardsById(['a', 'ghost'], 'en')

    expect(cards.has('a')).toBe(true)
    expect(cards.has('ghost')).toBe(false)
  })

  it('reports an unknown id as null from cardById, without throwing', async () => {
    const supply = createCardSupply(fakeTransport({}))

    await expect(supply.cardById('ghost', 'en')).resolves.toBeNull()
  })

  it('throws on transport failure instead of reporting not-found', async () => {
    const supply = createCardSupply({
      collection: async () => {
        throw new Error('Scryfall 503: service unavailable')
      },
      localize: async () => null,
    })

    // The distinction deck/new.tsx needs: this must NOT look like "bad id".
    await expect(supply.cardById('a', 'en')).rejects.toThrow('503')
  })

  it('propagates a transport failure to a joined caller too', async () => {
    const gate = deferred<void>()
    const supply = createCardSupply({
      collection: async () => {
        await gate.promise
        throw new Error('boom')
      },
      localize: async () => null,
    })

    const first = supply.cardsById(['a'], 'en')
    const second = supply.cardsById(['a'], 'en')
    gate.release()

    await expect(first).rejects.toThrow('boom')
    await expect(second).rejects.toThrow('boom')
  })
})

describe('cardsById — abort', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const transport = fakeTransport({ a: card('a') })
    const supply = createCardSupply(transport)
    const controller = new AbortController()
    controller.abort()

    await expect(supply.cardsById(['a'], 'en', { signal: controller.signal })).rejects.toThrow(
      /aborted/,
    )
    expect(transport.collection).not.toHaveBeenCalled()
  })

  it('rejects a call aborted mid-flight', async () => {
    const gate = deferred<void>()
    const supply = createCardSupply({
      collection: async (ids) => {
        await gate.promise
        return ids.map((id) => card(id))
      },
      localize: async () => null,
    })
    const controller = new AbortController()

    const pending = supply.cardsById(['a'], 'en', { signal: controller.signal })
    controller.abort()
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    gate.release()
    await rejection
  })

  it('does not strand a concurrent caller that did not abort', async () => {
    const gate = deferred<void>()
    const supply = createCardSupply({
      collection: async (ids) => {
        await gate.promise
        return ids.map((id) => card(id))
      },
      localize: async () => null,
    })
    const controller = new AbortController()

    const abandoned = supply.cardsById(['a'], 'en', { signal: controller.signal })
    const kept = supply.cardsById(['a'], 'en')
    controller.abort()
    await expect(abandoned).rejects.toThrow(/aborted/)
    gate.release()

    await expect(kept).resolves.toBeDefined()
  })
})

describe('cardsById — cache seeding and progress', () => {
  it('seeds the default print under both its own lang key and the active locale', async () => {
    const setQueryData = vi.fn()
    const en = card('a', 'en')
    const supply = createCardSupply(fakeTransport({ a: en }, { 'a:de': card('a', 'de') }))

    await supply.cardsById(['a'], 'de', { queryClient: { setQueryData } as never })

    expect(setQueryData).toHaveBeenCalledWith(scryfallKeys.card('a', 'en'), en)
    expect(setQueryData).toHaveBeenCalledWith(scryfallKeys.card('a', 'de'), en)
  })

  it('overwrites the locale key once the localized print lands', async () => {
    const setQueryData = vi.fn()
    const de = card('a', 'de')
    const supply = createCardSupply(fakeTransport({ a: card('a', 'en') }, { 'a:de': de }))

    await supply.cardsById(['a'], 'de', { queryClient: { setQueryData } as never })

    const localeWrites = setQueryData.mock.calls.filter(
      ([key]) => JSON.stringify(key) === JSON.stringify(scryfallKeys.card('a', 'de')),
    )
    expect(localeWrites.at(-1)?.[1]).toBe(de)
  })

  it('reports the default print through onCard before the upgrade', async () => {
    const en = card('a', 'en')
    const de = card('a', 'de')
    const supply = createCardSupply(fakeTransport({ a: en }, { 'a:de': de }))
    const seen: string[] = []

    await supply.cardsById(['a'], 'de', { onCard: (c) => seen.push(c.lang) })

    expect(seen).toEqual(['en', 'de'])
  })
})
