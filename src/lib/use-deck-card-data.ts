import { useEffect, useMemo, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { cardSupply } from './scryfall/card-supply'
import type { DeckCard } from './deck-utils'
import type { ScryfallCard } from './scryfall/types'

interface UseDeckCardDataOpts {
  /** When provided, fetched cards are mirrored into the React Query cache. */
  queryClient?: QueryClient
  scryfallLang: string
}

/**
 * Resolve Scryfall data for every card in a deck. One batched request for the
 * default prints, then localization upgrades — `cardSupply` owns that
 * ordering, so this hook only has to decide what to do with each card as it
 * lands.
 *
 * `cardsLoading` clears as soon as every requested card has a print to render;
 * the localization upgrades keep arriving through `onCard` afterwards.
 */
export function useDeckCardData(
  cards: DeckCard[],
  cardDataMap: Map<string, ScryfallCard>,
  setCardDataMap: React.Dispatch<React.SetStateAction<Map<string, ScryfallCard>>>,
  opts: UseDeckCardDataOpts,
): { cardsLoading: boolean } {
  const { queryClient, scryfallLang } = opts
  const [cardsLoading, setCardsLoading] = useState<boolean>(() => cards.length > 0)

  // Stable composition key over all card ids — changing when any id changes,
  // including same-count swaps (remove A, add B) that cards.length misses.
  const cardsKey = useMemo(() => cards.map((c) => c.scryfallId).join(','), [cards])

  useEffect(() => {
    const missingIds = cards
      .map((dc) => dc.scryfallId)
      .filter((sid) => {
        const existing = cardDataMap.get(sid)
        return !existing || existing.lang !== scryfallLang
      })
    if (missingIds.length === 0) {
      setCardsLoading(false)
      return
    }
    let cancelled = false
    setCardsLoading(true)

    const wanted = new Set(missingIds)
    const painted = new Set<string>()

    cardSupply
      .cardsById(missingIds, scryfallLang, {
        queryClient,
        onCard: (card) => {
          if (cancelled) return
          setCardDataMap((prev) => new Map(prev).set(card.id, card))
          painted.add(card.id)
          // Every card has something renderable now — don't make the UI wait
          // on the localization tail.
          if (painted.size >= wanted.size) setCardsLoading(false)
        },
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCardsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [cardsKey, scryfallLang, queryClient])

  return { cardsLoading }
}
