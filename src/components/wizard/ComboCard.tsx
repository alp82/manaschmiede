import { useState, useEffect } from 'react'
import type { CoreCombo } from '../../lib/wizard-state'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getCardById } from '../../lib/scryfall/client'
import { CardImage } from '../CardImage'
import { CardLightbox } from '../CardLightbox'
import { ManaSymbol, type ManaColor } from '../ManaSymbol'
import { Checkbox } from '../ui/Checkbox'
import { cn } from '../../lib/utils'
import { useI18n } from '../../lib/i18n'

interface ComboCardProps {
  combo: CoreCombo
  selected: boolean
  onSelect: () => void
  renderLightboxActions?: (card: ScryfallCard) => React.ReactNode
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

export function ComboCard({ combo, selected, onSelect, renderLightboxActions }: ComboCardProps) {
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
        className={cn(
          'relative border border-hairline transition-colors duration-150',
          selected ? 'bg-ash-800' : 'bg-ash-900/50 hover:border-hairline-strong',
        )}
      >
        {/* Selected-state marker: cream slab running the full left edge.
            Cream (not ink-red) for consistency with the archetype cards —
            the red was colliding with red imagery in both places. */}
        {selected && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1.5 bg-cream-100"
          />
        )}

        {/* Header: mana colors + name + checkbox */}
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full cursor-pointer items-center gap-3 px-5 pb-3 pt-5 text-left"
        >
          <div className="flex items-center gap-1.5">
            {colors.map((color) => (
              <ManaSymbol key={color} color={color} size="sm" selected />
            ))}
          </div>
          <h3 className="flex-1 font-display text-display-eyebrow uppercase tracking-display text-cream-100">
            {combo.name}
          </h3>
          <Checkbox checked={selected} />
        </button>

        {/* Card images — flat grid, sharp corners */}
        <div className="px-5 py-2">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(resolvedCards.length, 4)}, 1fr)` }}
          >
            {resolvedCards.map((card) => (
              <button
                key={card.name}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (card.scryfallCard) {
                    const scryfallIndex = scryfallCards.findIndex(
                      (sc) => sc.id === card.scryfallCard!.id,
                    )
                    if (scryfallIndex >= 0) setLightboxIndex(scryfallIndex)
                  }
                }}
                className="group relative"
              >
                {card.scryfallCard ? (
                  <div className="overflow-hidden border border-hairline transition-transform group-hover:-translate-y-1">
                    <CardImage card={card.scryfallCard} size="normal" />
                  </div>
                ) : (
                  <div className="flex aspect-[488/680] items-center justify-center border border-hairline bg-ash-800 p-2">
                    <span className="text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-300">
                      {card.name}
                    </span>
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
          className="w-full cursor-pointer px-5 pb-5 pt-2 text-left"
        >
          <p className="font-body text-sm leading-relaxed text-cream-300">
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
          renderActions={renderLightboxActions}
        />
      )}
    </>
  )
}
