import { memo, useState } from 'react'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri } from '../lib/scryfall/types'

interface CardImageProps {
  card: ScryfallCard
  size?: 'small' | 'normal'
  onClick?: () => void
}

export const CardImage = memo(function CardImage({ card, size = 'normal', onClick }: CardImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const name = getCardName(card)
  const imageUrl = getCardImageUri(card, size)

  return (
    <div
      className="group relative transition-transform duration-150 hover:scale-105 cursor-pointer"
      onClick={onClick}
    >
      <div className="relative overflow-hidden rounded-lg aspect-[488/680]">
        {!loaded && !error && (
          <div className="absolute inset-0 animate-pulse rounded-lg bg-surface-700" />
        )}
        {imageUrl && !error ? (
          <>
            <img
              src={imageUrl}
              alt={name}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
              className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
            {/* Foil shimmer overlay for rare/mythic */}
            {loaded && (card.rarity === 'rare' || card.rarity === 'mythic') && (
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{
                  background: 'linear-gradient(105deg, transparent 40%, oklch(0.9 0.05 90 / 0.08) 45%, oklch(0.9 0.1 200 / 0.1) 50%, oklch(0.9 0.05 330 / 0.08) 55%, transparent 60%)',
                  backgroundSize: '200% 100%',
                  animation: 'foil-shimmer 4s ease-in-out infinite',
                }}
              />
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-surface-600 bg-surface-800 p-2">
            <span className="text-center text-sm text-surface-400">{name}</span>
          </div>
        )}
      </div>
    </div>
  )
})
