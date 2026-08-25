/**
 * The deck-facing half of the persistence seam.
 *
 * Every test runs against `createDeckStore(memoryBackend())` — the in-memory
 * adapter the seam exists to make possible. The localStorage adapter differs
 * only in where the bytes land, and that difference is pinned in
 * `storage-backend.test.ts`.
 *
 * Three things are asserted here that no test could reach before the seam:
 *
 * - a stored blob that is not an array of decks no longer reaches callers,
 * - `remove` clears the deck AND its pending slot in one call,
 * - the module-level `deckStore` follows whatever backend is installed.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend, setStorageBackend, type StorageBackend } from '../storage/backend'
import {
  createDeckStore,
  createInMemoryDeckStore,
  deckStore,
  DECKS_KEY,
  pendingKey,
  type DeckStore,
} from '../storage/deck-store'
import type { Deck } from '../deck'
import type { DeckPending } from '../deck-pending'

function makeDeck(id: string, over: Partial<Deck> = {}): Deck {
  return {
    id,
    name: `Deck ${id}`,
    cards: [{ scryfallId: 'card-1', quantity: 4, zone: 'main' }],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function makePending(over: Partial<DeckPending> = {}): DeckPending {
  return { intentFingerprint: 'fp-1', ...over }
}

let backend: StorageBackend
let store: DeckStore

beforeEach(() => {
  backend = memoryBackend()
  store = createDeckStore(backend)
})

// ─── list / load / save ──────────────────────────────────────────────────────

describe('save / load / list', () => {
  it('an empty store lists nothing', () => {
    expect(store.list()).toEqual([])
  })

  it('a saved deck comes back from load', () => {
    const deck = makeDeck('a')
    store.save(deck)
    expect(store.load('a')).toEqual(deck)
  })

  it('a saved deck comes back from list', () => {
    store.save(makeDeck('a'))
    store.save(makeDeck('b'))
    expect(store.list().map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('load of an unknown id is null', () => {
    store.save(makeDeck('a'))
    expect(store.load('nope')).toBeNull()
  })

  it('saving the same id twice replaces in place rather than appending', () => {
    store.save(makeDeck('a', { name: 'first' }))
    store.save(makeDeck('a', { name: 'second' }))
    expect(store.list()).toHaveLength(1)
    expect(store.load('a')?.name).toBe('second')
  })

  it('a replacing save keeps the deck at its original position', () => {
    store.save(makeDeck('a'))
    store.save(makeDeck('b'))
    store.save(makeDeck('a', { name: 'updated' }))
    expect(store.list().map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('the optional fields survive a round-trip', () => {
    const deck = makeDeck('a', {
      description: 'desc',
      colors: ['R', 'G'],
      sectionPlan: [
        {
          id: 'core',
          label: 'Core',
          description: 'The engine',
          targetCount: 8,
          role: 'creatures',
          scryfallHints: ['t:creature'],
        },
      ],
      sectionAssignments: { core: ['card-1'] },
      featuredCardIds: ['card-1'],
    })
    store.save(deck)
    expect(store.load('a')).toEqual(deck)
  })
})

// ─── validation: one Deck shape, one place it is checked ─────────────────────

describe('reading a corrupt store', () => {
  it('unparseable JSON lists nothing instead of throwing', () => {
    backend.write(DECKS_KEY, 'not valid json {{{')
    expect(store.list()).toEqual([])
  })

  it('a stored object that is not an array lists nothing', () => {
    // Before the seam this returned the object, and `.find` on it threw.
    backend.write(DECKS_KEY, JSON.stringify({ a: 1 }))
    expect(store.list()).toEqual([])
  })

  it('entries missing the fields every caller reads are dropped', () => {
    backend.write(
      DECKS_KEY,
      JSON.stringify([
        makeDeck('good'),
        null,
        'a string',
        { name: 'no id', cards: [] },
        { id: 'no-cards', name: 'x' },
        { id: 'cards-not-array', name: 'x', cards: 'nope' },
      ]),
    )
    expect(store.list().map((d) => d.id)).toEqual(['good'])
  })

  it('a deck missing timestamps is kept and stamped with 0, since nothing reads them structurally', () => {
    backend.write(DECKS_KEY, JSON.stringify([{ id: 'a', name: 'x', cards: [] }]))
    expect(store.list()).toEqual([{ id: 'a', name: 'x', cards: [], createdAt: 0, updatedAt: 0 }])
  })

  it('a malformed card row is dropped without taking the deck with it', () => {
    backend.write(
      DECKS_KEY,
      JSON.stringify([
        {
          id: 'a',
          name: 'x',
          cards: [
            { scryfallId: 'good', quantity: 4, zone: 'main' },
            null,
            'a string',
            { quantity: 1, zone: 'main' },
            { scryfallId: 'no-quantity', zone: 'main' },
            { scryfallId: 'bad-zone', quantity: 1, zone: 'sideboard' },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    )
    expect(store.list()[0].cards).toEqual([{ scryfallId: 'good', quantity: 4, zone: 'main' }])
  })

  it('a rejected entry is gone from storage after the next save', () => {
    backend.write(DECKS_KEY, JSON.stringify([makeDeck('good'), { id: 'no-cards', name: 'x' }]))
    store.save(makeDeck('good', { name: 'renamed' }))
    expect(JSON.parse(backend.read(DECKS_KEY)!).map((d: Deck) => d.id)).toEqual(['good'])
  })

  it('saving over a corrupt store replaces it with a valid one', () => {
    backend.write(DECKS_KEY, 'not valid json {{{')
    store.save(makeDeck('a'))
    expect(store.list().map((d) => d.id)).toEqual(['a'])
  })
})

// ─── remove: the deck and its pending slot are one lifecycle ─────────────────

describe('remove', () => {
  it('drops the deck', () => {
    store.save(makeDeck('a'))
    store.save(makeDeck('b'))
    store.remove('a')
    expect(store.list().map((d) => d.id)).toEqual(['b'])
    expect(store.load('a')).toBeNull()
  })

  it('clears the removed deck pending slot', () => {
    store.save(makeDeck('a'))
    store.savePending('a', makePending())
    store.remove('a')
    expect(store.loadPending('a')).toBeNull()
  })

  it('leaves another deck pending slot alone', () => {
    store.savePending('a', makePending({ intentFingerprint: 'fp-a' }))
    store.savePending('b', makePending({ intentFingerprint: 'fp-b' }))
    store.remove('a')
    expect(store.loadPending('b')?.intentFingerprint).toBe('fp-b')
  })

  it('removing an unknown id does not throw and changes nothing', () => {
    store.save(makeDeck('a'))
    expect(() => store.remove('never-existed')).not.toThrow()
    expect(store.list().map((d) => d.id)).toEqual(['a'])
  })
})

// ─── seeding ─────────────────────────────────────────────────────────────────

describe('append', () => {
  it('appends to what is already stored', () => {
    store.save(makeDeck('a'))
    store.append([makeDeck('b'), makeDeck('c')])
    expect(store.list().map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('appending an empty list is a no-op', () => {
    store.save(makeDeck('a'))
    store.append([])
    expect(store.list().map((d) => d.id)).toEqual(['a'])
  })
})

// ─── the pending slot ────────────────────────────────────────────────────────

describe('pending slots', () => {
  it('round-trips a slot', () => {
    const pending = makePending({ offeredCombos: [] })
    store.savePending('a', pending)
    expect(store.loadPending('a')).toEqual(pending)
  })

  it('an unwritten slot is null', () => {
    expect(store.loadPending('a')).toBeNull()
  })

  it('slots are keyed per deck', () => {
    store.savePending('a', makePending({ intentFingerprint: 'fp-a' }))
    store.savePending('b', makePending({ intentFingerprint: 'fp-b' }))
    expect(store.loadPending('a')?.intentFingerprint).toBe('fp-a')
    expect(store.loadPending('b')?.intentFingerprint).toBe('fp-b')
  })

  it('a later save overwrites the slot rather than merging into it', () => {
    store.savePending('a', makePending({ offeredCombos: [], refillChat: [] }))
    store.savePending('a', makePending({ intentFingerprint: 'fp-2' }))
    expect(store.loadPending('a')).toEqual({ intentFingerprint: 'fp-2' })
  })

  it('a corrupt slot reads as null instead of throwing', () => {
    backend.write(pendingKey('a'), 'not valid json {{{')
    expect(store.loadPending('a')).toBeNull()
  })

  it('a slot write does not disturb the deck list', () => {
    store.save(makeDeck('a'))
    store.savePending('a', makePending())
    expect(store.list().map((d) => d.id)).toEqual(['a'])
  })
})

// ─── the on-disk keys ────────────────────────────────────────────────────────

describe('storage keys', () => {
  it('the deck list key is unchanged — every existing user has decks under it', () => {
    expect(DECKS_KEY).toBe('manaschmiede-decks')
  })

  it('a pending slot key is the deck id under its own prefix', () => {
    expect(pendingKey('deck-A')).toBe('manaschmiede-deck-pending:deck-A')
  })

  it('no slot key can collide with the deck list or the wizard keys', () => {
    for (const id of ['', 'decks', 'wizard', 'wizard-aux']) {
      expect(pendingKey(id)).not.toBe(DECKS_KEY)
      expect(pendingKey(id)).not.toBe('manaschmiede-wizard')
      expect(pendingKey(id)).not.toBe('manaschmiede-wizard-aux')
    }
  })

  it('a deck write leaves the wizard keys alone', () => {
    backend.write('manaschmiede-wizard', '{"step":1}')
    store.save(makeDeck('a'))
    store.savePending('a', makePending())
    expect(backend.read('manaschmiede-wizard')).toBe('{"step":1}')
  })

  it('a slot holding the literal string null reads as an absent slot', () => {
    backend.write(pendingKey('a'), 'null')
    expect(store.loadPending('a')).toBeNull()
  })
})

// ─── the two adapters and the module-level store ─────────────────────────────

describe('adapters', () => {
  it('createInMemoryDeckStore gives each caller its own storage', () => {
    const one = createInMemoryDeckStore()
    const two = createInMemoryDeckStore()
    one.save(makeDeck('a'))
    expect(two.list()).toEqual([])
  })

  it('the module-level deckStore writes through whichever backend is installed', () => {
    setStorageBackend(backend)
    deckStore.save(makeDeck('a'))
    expect(store.list().map((d) => d.id)).toEqual(['a'])
  })

  it('the module-level deckStore follows a later swap', () => {
    setStorageBackend(backend)
    deckStore.save(makeDeck('a'))
    const fresh = memoryBackend()
    setStorageBackend(fresh)
    expect(deckStore.list()).toEqual([])
  })
})
