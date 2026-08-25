# Persistence has one seam at the bottom and one deck-shaped facade above it

Everything the app persists goes through `StorageBackend`
(`src/lib/storage/backend.ts`), a three-method string store with two adapters:
`localStorageBackend` in the browser, `memoryBackend` in tests. Deck
persistence sits above it as `DeckStore` (`src/lib/storage/deck-store.ts`),
which owns both the curated 60 in `manaschmiede-decks` and the per-deck pending
slot in `manaschmiede-deck-pending:<id>`.

Before this, five localStorage keys had four owners, each with its own `try` /
`catch` and `JSON.parse` (issue #29). Two costs came out of that. The guards
drifted - `deck-storage.ts` guarded reads but not writes, `wizard-state.ts`
guarded both, `useSampleDecks.ts` guarded neither and reached straight into a
key it did not own. And nothing was testable without a global `localStorage`
polyfill that no test could reset.

## What lives where

- **`backend.ts`** - where bytes go, plus `readJson` / `writeJson`. Every
  operation is total: a server render, a private-mode window, and a full quota
  all degrade to "this key has no value", so no caller above the seam carries a
  guard.
- **`deck-store.ts`** - `list` / `load` / `save` / `remove` / `append` plus the
  two pending-slot methods. `createDeckStore` is the only implementation;
  the adapters are backends, so the shape validation, the replace-in-place
  save and the pending merge are written once.
- **`deck.ts`** - the `Deck` shape. It was `LocalDeck` in `deck-storage.ts`,
  named for the adapter that happened to hold it, which is exactly what the
  seam removes.

## Considered options

**Two `DeckStore` implementations instead of two backends.** Rejected: the
localStorage and in-memory stores would differ only in where bytes land, so
every rule - validation, the pending merge, replace-in-place - would have been
written twice and free to drift. Putting the adapters under the rules is the
same move `cardFilters.ts` makes for one rule in three languages.

**A React context carrying the store.** Rejected: it would touch every
component to buy nothing the node suite can use. One installed backend, swapped
by `setStorageBackend`, gives per-test isolation with no call site aware of it.

**Keeping `convex/decks.ts` as a third adapter.** Rejected on #23. DB-backed
decks need auth first, the schema had already drifted from the deck shape in
five fields, and the code had never been called. It and the `decks` table are
deleted; the Convex adapter returns as a second implementation of a widened,
async interface when the TODO lands.

## Consequences

- **The stored blob is validated in exactly one place.** `coerceDeck` drops
  anything that is not a deck. A non-array blob used to reach callers, where
  every `.find` threw. What it drops is picked to lose as little of the user's
  work as possible: a malformed card row takes only that row, and missing
  timestamps are filled rather than treated as fatal.
- **Adding a required field to `Deck` is a compile error in the validator.**
  `RequiredDeckFields` is derived from `Deck`, so the literal `coerceDeck`
  builds stops compiling until the new field is checked. Optional fields are
  spread through unchecked, which is the limit of the guarantee.
- **A rejected entry is erased from storage on the next write.** Every write
  rewrites the whole list from `list()`, so a blob `coerceDeck` refused does not
  survive the next autosave. It used to sit on disk indefinitely, unreadable.
  Deliberate: an entry the app cannot read is not a deck it can preserve.
- **`remove` deletes the deck and its pending slot.** They are one lifecycle;
  a second delete path can no longer forget the slot.
- **`src/test-setup.ts` installs a fresh `memoryBackend()` before every test**
  and the `MemoryStorage` polyfill is gone. No suite needs `localStorage.clear()`
  in a `beforeEach` any more.
- **The on-disk key names are unchanged and pinned by test**, so existing users
  keep their decks.
- **A save that storage refuses is dropped, not thrown.** Saving a deck used to
  throw on a full quota, from inside the deck route's autosave timer - an
  unhandled rejection the user never saw either. Best-effort is what the wizard
  already did. Neither policy tells the user; surfacing "your deck could not be
  saved" is worth its own issue.
- User preferences that are not deck state - the sound toggle, the locale, the
  AI usage log panel - still call `localStorage` directly. They are single
  scalars with no shape to drift and were never part of issue #29. Route them
  through the backend when one of them next needs a test.
