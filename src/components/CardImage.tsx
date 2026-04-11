import { memo, useState } from 'react'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri } from '../lib/scryfall/types'

interface CardImageProps {
  card: ScryfallCard
  size?: 'small' | 'normal'
  onClick?: () => void
}

/**
 * MTG card thumbnail. Sharp corners (no rounded) — card art is iconographic,
 * the rectangle is part of the plate. Foil shimmer is kept as a subtle
 * tactile detail on rare/mythic. Scaling on hover is handled by the parent
 * (CardStack) so this component stays flat.
 */
export const CardImage = memo(function CardImage({ card, size = 'normal', onClick }: CardImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const name = getCardName(card)
  const imageUrl = getCardImageUri(card, size)

  return (
    <div className="relative aspect-[488/680] overflow-hidden" onClick={onClick}>
      {!loaded && !error && (
        <div className="absolute inset-0 bg-ash-700" aria-hidden="true" />
      )}
      {imageUrl && !error ? (
        <>
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className={`h-full w-full object-cover transition-opacity duration-500 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
          {/* Foil shimmer for rare/mythic — one of the allowed soft-light
              exceptions per the Specimen rule (card art can glow). */}
          {loaded && (card.rarity === 'rare' || card.rarity === 'mythic') && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(105deg, transparent 40%, oklch(0.9 0.05 90 / 0.08) 45%, oklch(0.9 0.1 200 / 0.10) 50%, oklch(0.9 0.05 330 / 0.08) 55%, transparent 60%)',
                backgroundSize: '200% 100%',
                animation: 'foil-shimmer 4s ease-in-out infinite',
              }}
            />
          )}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center border border-hairline bg-ash-800 p-2">
          <span className="text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-300">
            {name}
          </span>
        </div>
      )}
    </div>
  )
})
