import { useEffect, useMemo, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { getCardsCollection, getLocalizedCardData } from './scryfall/client'
import { scryfallKeys } from './scryfall/queries'
import type { DeckCard } from './deck-utils'
import type { ScryfallCard } from './scryfall/types'

interface UseDeckCardDataOpts {
  /** When provided, fetched cards are mirrored into the React Query cache. */
  queryClient?: QueryClient
  scryfallLang: string
}

/**
 * Resolve Scryfall data for every card in a deck. Fires one batched
 * /cards/collection request for the default prints, then per-card
 * localization upgrades in the background. When a `queryClient` is given,
 * results are seeded into its cache so remounts are instant.
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

    // Dedupe the batch request — a deck can include the same card id twice
    // (e.g. tokens, basic lands duplicated across zones).
    const uniqueMissing = Array.from(new Set(missingIds))

    getCardsCollection(uniqueMissing)
      .then((batch) => {
        if (cancelled) return
        if (batch.length > 0) {
          setCardDataMap((prev) => {
            const next = new Map(prev)
            for (const card of batch) {
              next.set(card.id, card)
              queryClient?.setQueryData(scryfallKeys.card(card.id, card.lang), card)
              // Seed the active-locale key so remounts under the same locale
              // hit the cache; localization upgrades below will overwrite
              // this entry with the localized print when available.
              queryClient?.setQueryData(scryfallKeys.card(card.id, scryfallLang), card)
            }
            return next
          })
        }
        // Fire per-card localization upgrades in the background. These hit
        // the rate-limited queue but don't block the initial render.
        if (scryfallLang !== 'en') {
          for (const card of batch) {
            if (cancelled) return
            if (card.lang === scryfallLang) continue
            getLocalizedCardData(card, card.id, card.set, card.collector_number, scryfallLang)
              .then((localized) => {
                if (cancelled || !localized || localized.lang !== scryfallLang) return
                setCardDataMap((prev) => {
                  const next = new Map(prev)
                  next.set(card.id, localized)
                  return next
                })
                queryClient?.setQueryData(
                  scryfallKeys.card(card.id, scryfallLang),
                  localized,
                )
              })
              .catch(() => {})
          }
        }
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
