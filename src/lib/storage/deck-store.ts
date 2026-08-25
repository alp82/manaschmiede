import type { Deck } from '../deck'
import type { DeckCard } from '../deck-utils'
import type { DeckPending } from '../deck-pending'
import {
  memoryBackend,
  readJson,
  storageBackend,
  writeJson,
  type StorageBackend,
} from './backend'

/**
 * The deck-facing half of the persistence seam (issue #29).
 *
 * A deck's persisted state is two things that used to be owned by two modules
 * with no relationship to each other: the curated 60 in `manaschmiede-decks`,
 * and the transient mid-review slot in `manaschmiede-deck-pending:<id>`. They
 * share one lifecycle — deleting a deck has to delete its slot — which
 * `deck-storage.ts` expressed as an import of `deck-pending.ts`, easy to forget
 * on any second delete path. Here `remove` does both, and that is the "pending
 * merge" the issue asked for.
 *
 * Everything above this interface is storage-blind. `createDeckStore` is the
 * only implementation; the adapters are backends, so the rules — the shape
 * validation, the replace-in-place save, the pending merge — are written once
 * and cannot drift between them.
 *
 * Note that every write rewrites the whole list from `list()`, so an entry
 * `coerceDeck` rejected is gone from storage after the next save. That is
 * deliberate: an entry the app cannot read is not a deck it can preserve.
 *
 * A Convex adapter is deliberately NOT here. DB-backed decks need auth first
 * (issue #23), and they would make every method async, so that adapter arrives
 * as a second implementation of a widened interface rather than a third
 * backend.
 */
export interface DeckStore {
  /** Every stored deck, in storage order. Malformed entries are dropped. */
  list(): Deck[]
  load(id: string): Deck | null
  /** Insert, or replace in place when the id is already stored. */
  save(deck: Deck): void
  /** Delete the deck AND its pending slot. */
  remove(id: string): void
  /**
   * Append decks wholesale — the sample-import path. Unconditional: importing
   * the samples twice gives two copies, it does not seed-if-empty.
   */
  append(decks: Deck[]): void
  loadPending(id: string): DeckPending | null
  savePending(id: string, pending: DeckPending): void
}

export const DECKS_KEY = 'manaschmiede-decks'

const PENDING_KEY_PREFIX = 'manaschmiede-deck-pending:'

export function pendingKey(deckId: string): string {
  return PENDING_KEY_PREFIX + deckId
}

/** The keys of `T` that a value must have. */
type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T]

/**
 * Every field a `Deck` must carry. Listing them is what makes drift a compile
 * error rather than a runtime surprise: add a required field to `Deck` and the
 * literal in `coerceDeck` stops compiling until it is checked here too.
 */
type RequiredDeckFields = { [K in RequiredKeys<Deck>]: Deck[K] }

function isDeckCard(value: unknown): value is DeckCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Partial<DeckCard>
  return (
    typeof card.scryfallId === 'string' &&
    typeof card.quantity === 'number' &&
    card.zone === 'main'
  )
}

/**
 * The one place a stored blob becomes a `Deck`.
 *
 * Storage holds whatever an older build or a hand-edited devtools session
 * wrote. Two shapes used to reach callers: a non-array blob, which every
 * `.find` / `.filter` call site then threw on, and entries without `cards`,
 * which crashed the deck list on render.
 *
 * What is dropped is chosen to lose as little of the user's work as possible:
 *
 * - A missing `id`, `name` or `cards` is not a deck at all — nothing can
 *   render it, route to it, or count it — so the entry goes.
 * - A malformed card row takes only that row with it. A deck of 59 good cards
 *   and one corrupt one is still the user's deck.
 * - Timestamps are filled, not validated. Nothing reads them structurally, so
 *   dropping a real deck over a cosmetic `updatedAt` would be the worse trade.
 */
function coerceDeck(entry: unknown): Deck | null {
  if (!entry || typeof entry !== 'object') return null
  const candidate = entry as Partial<Deck>
  if (typeof candidate.id !== 'string') return null
  if (typeof candidate.name !== 'string') return null
  if (!Array.isArray(candidate.cards)) return null
  const required: RequiredDeckFields = {
    id: candidate.id,
    name: candidate.name,
    cards: candidate.cards.filter(isDeckCard),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
  }
  return { ...candidate, ...required }
}

function coerceDecks(parsed: unknown): Deck[] {
  if (!Array.isArray(parsed)) return []
  return parsed.map(coerceDeck).filter((deck): deck is Deck => deck !== null)
}

export function createDeckStore(backend: StorageBackend): DeckStore {
  function list(): Deck[] {
    return coerceDecks(readJson<unknown>(backend, DECKS_KEY, []))
  }

  function writeAll(decks: Deck[]): void {
    writeJson(backend, DECKS_KEY, decks)
  }

  return {
    list,

    load(id) {
      return list().find((d) => d.id === id) ?? null
    },

    save(deck) {
      const decks = list()
      const index = decks.findIndex((d) => d.id === deck.id)
      if (index >= 0) decks[index] = deck
      else decks.push(deck)
      writeAll(decks)
    },

    remove(id) {
      writeAll(list().filter((d) => d.id !== id))
      backend.delete(pendingKey(id))
    },

    append(decks) {
      if (decks.length === 0) return
      writeAll([...list(), ...decks])
    },

    loadPending(id) {
      return readJson<DeckPending | null>(backend, pendingKey(id), null)
    },

    savePending(id, pending) {
      writeJson(backend, pendingKey(id), pending)
    },
  }
}

/** An isolated store for a test that wants one of its own. */
export function createInMemoryDeckStore(): DeckStore {
  return createDeckStore(memoryBackend())
}

/**
 * The app's store. It forwards to whatever backend is installed at call time,
 * so `setStorageBackend` in a test setup redirects it without any call site
 * knowing there was a swap.
 */
export const deckStore: DeckStore = createDeckStore({
  read: (key) => storageBackend().read(key),
  write: (key, value) => storageBackend().write(key, value),
  delete: (key) => storageBackend().delete(key),
})
