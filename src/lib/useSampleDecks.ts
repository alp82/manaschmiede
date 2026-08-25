import { useCallback } from 'react'
import { SAMPLE_DECKS } from './sample-decks'
import { deckStore } from './storage/deck-store'

/**
 * Import the bundled sample decks. Every one is a new deck with a fresh id, so
 * importing twice gives two copies rather than overwriting anything.
 *
 * This hook used to read and rewrite `manaschmiede-decks` itself — a key owned
 * by the deck store, whose format it had no way of knowing (issue #29). It
 * appends through the store now and knows nothing about storage.
 */
export function useSampleDecks(onComplete: () => void) {
  const importAll = useCallback(() => {
    const now = Date.now()
    deckStore.append(
      SAMPLE_DECKS.map((sample) => ({
        id: crypto.randomUUID(),
        name: sample.name,
        cards: sample.cards,
        createdAt: now,
        updatedAt: now,
      })),
    )
    onComplete()
  }, [onComplete])

  return { importAll }
}
