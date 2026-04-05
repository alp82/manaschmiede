import type { ScryfallCard } from '../lib/scryfall/types'
import { CardImage } from './CardImage'

interface CardStackProps {
  card: ScryfallCard
  quantity: number
  locked?: boolean
  highlighted?: boolean
  isNew?: boolean
  onClick?: () => void
  innerRef?: (el: HTMLElement | null) => void
}

/** Visual card stack: 1x single, 2-4x offset stack edges, 5+ thicker edges */
export function CardStack({ card, quantity, locked, highlighted, isNew, onClick, innerRef }: CardStackProps) {
  // How many "extra" edges to show behind the card
  const extraCount = quantity <= 1 ? 0 : Math.min(quantity - 1, 3)
  const offset = extraCount * 3 // px offset for the stack

  return (
    <button
      type="button"
      onClick={onClick}
      ref={innerRef as React.Ref<HTMLButtonElement>}
      className={`group relative transition-all duration-300 ${
        highlighted ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-900 scale-105' : ''
      }`}
      style={{
        marginTop: offset > 0 ? `${offset}px` : undefined,
        marginLeft: offset > 0 ? `${offset}px` : undefined,
      }}
    >
      {/* Stack edges behind the card */}
      {Array.from({ length: extraCount }, (_, i) => (
        <div
          key={i}
          className="absolute rounded-lg border border-surface-500/30 bg-surface-700"
          style={{
            top: `${-(i + 1) * 3}px`,
            left: `${-(i + 1) * 3}px`,
            right: `${(i + 1) * 3}px`,
            bottom: `${(i + 1) * 3}px`,
            zIndex: i,
          }}
        />
      ))}

      {/* Main card */}
      <div
        className="relative overflow-hidden rounded-lg transition-transform group-hover:scale-[1.02]"
        style={{ zIndex: extraCount + 1 }}
      >
        <CardImage card={card} size="normal" />

        {/* Quantity badge */}
        {quantity > 1 && (
          <span className="absolute right-1 bottom-1 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-bold text-white backdrop-blur-sm">
            {quantity}x
          </span>
        )}

        {/* Lock indicator */}
        {locked && (
          <span className="absolute left-1 top-1 rounded bg-mana-green/80 px-1 py-0.5 text-[10px] text-white">
            {'\u{1F512}'}
          </span>
        )}

        {/* New card indicator */}
        {isNew && !locked && (
          <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
            NEW
          </span>
        )}
      </div>
    </button>
  )
}
