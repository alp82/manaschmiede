import { useCallback } from 'react'
import { SAMPLE_DECKS } from './sample-decks'

export function useSampleDecks(onComplete: () => void) {
  const importAll = useCallback(() => {
    const newDecks = SAMPLE_DECKS.map((sample) => ({
      id: crypto.randomUUID(),
      name: sample.name,
      format: sample.format,
      cards: sample.cards,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))

    const existing = JSON.parse(
      localStorage.getItem('manaschmiede-decks') || '[]',
    )
    localStorage.setItem(
      'manaschmiede-decks',
      JSON.stringify([...existing, ...newDecks]),
    )
    onComplete()
  }, [onComplete])

  return { importAll }
}
