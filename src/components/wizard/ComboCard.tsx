import { useState, useEffect } from 'react'
import type { CoreCombo } from '../../lib/wizard-state'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getCardById } from '../../lib/scryfall/client'
import { CardImage } from '../CardImage'
import { CardLightbox } from '../CardLightbox'
import { ManaSymbol, type ManaColor } from '../ManaSymbol'
import { useI18n } from '../../lib/i18n'

interface ComboCardProps {
  combo: CoreCombo
  selected: boolean
  onSelect: () => void
}

const MANA_COLORS = new Set(['W', 'U', 'B', 'R', 'G'])

function getComboColors(combo: CoreCombo): ManaColor[] {
  const colors = new Set<string>()
  for (const card of combo.cards) {
    if (card.scryfallCard?.color_identity) {
      for (const c of card.scryfallCard.color_identity) {
        if (MANA_COLORS.has(c)) colors.add(c)
      }
    }
  }
  return Array.from(colors) as ManaColor[]
}

export function ComboCard({ combo, selected, onSelect }: ComboCardProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const { scryfallLang } = useI18n()
  const [localizedCards, setLocalizedCards] = useState<Map<string, ScryfallCard>>(new Map())

  // Re-fetch cards when locale doesn't match
  useEffect(() => {
    let cancelled = false
    async function fetchLocalized() {
      for (const card of combo.cards) {
        if (!card.scryfallId || !card.scryfallCard) continue
        if (card.scryfallCard.lang === scryfallLang) continue
        if (localizedCards.get(card.scryfallId)?.lang === scryfallLang) continue
        try {
          const localized = await getCardById(card.scryfallId)
          if (cancelled) return
          setLocalizedCards((prev) => new Map(prev).set(card.scryfallId!, localized))
        } catch {
          // fall back to original
        }
      }
    }
    fetchLocalized()
    return () => { cancelled = true }
  }, [scryfallLang, combo.cards])

  const colors = getComboColors(combo)

  // Use localized card data when available
  const resolvedCards = combo.cards.map((c) => {
    if (c.scryfallId && localizedCards.has(c.scryfallId)) {
      return { ...c, scryfallCard: localizedCards.get(c.scryfallId) }
    }
    return c
  })

  const scryfallCards = resolvedCards
    .filter((c): c is typeof c & { scryfallCard: ScryfallCard } => !!c.scryfallCard)
    .map((c) => c.scryfallCard)

  return (
    <>
      <div
        className={`rounded-xl border-2 transition-all ${
          selected
            ? 'border-accent bg-accent/10'
            : 'border-surface-700 bg-surface-800/50 hover:border-surface-500'
        }`}
      >
        {/* Header: name + colors + select button */}
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center gap-3 px-4 pt-4 pb-2 text-left"
        >
          <div className="flex items-center gap-1.5">
            {colors.map((color) => (
              <ManaSymbol key={color} color={color} size="sm" selected />
            ))}
          </div>
          <h3 className={`flex-1 font-display text-base font-bold ${selected ? 'text-accent' : 'text-surface-100'}`}>
            {combo.name}
          </h3>
          <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
            selected ? 'border-accent bg-accent' : 'border-surface-500'
          }`}>
            {selected && <span className="text-xs text-white">{'\u2713'}</span>}
          </div>
        </button>

        {/* Card images — grid, no scrollbar */}
        <div className="px-4 py-2">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(resolvedCards.length, 4)}, 1fr)` }}>
            {resolvedCards.map((card, i) => (
              <button
                key={card.name}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (card.scryfallCard) {
                    const scryfallIndex = scryfallCards.findIndex((sc) => sc.id === card.scryfallCard!.id)
                    if (scryfallIndex >= 0) setLightboxIndex(scryfallIndex)
                  }
                }}
                className="group relative"
              >
                {card.scryfallCard ? (
                  <div className="overflow-hidden rounded-lg transition-transform group-hover:scale-[1.03]">
                    <CardImage card={card.scryfallCard} size="normal" />
                  </div>
                ) : (
                  <div className="flex aspect-[488/680] items-center justify-center rounded-lg border border-surface-600 bg-surface-700 p-2">
                    <span className="text-center text-xs text-surface-300">{card.name}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <button
          type="button"
          onClick={onSelect}
          className="w-full px-4 pb-4 pt-1 text-left"
        >
          <p className="text-sm leading-relaxed text-surface-300">
            {combo.explanation}
          </p>
        </button>
      </div>

      {/* Lightbox for this combo's cards */}
      {lightboxIndex !== null && scryfallCards.length > 0 && (
        <CardLightbox
          cards={scryfallCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  )
}
