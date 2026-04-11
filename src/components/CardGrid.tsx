import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardTypeLine } from '../lib/scryfall/types'
import { CardImage } from './CardImage'
import { HighlightText } from './HighlightText'
import { OracleText } from './OracleText'
import { useT } from '../lib/i18n'

interface CardGridProps {
  cards: ScryfallCard[]
  searchTerm?: string
  onCardClick?: (card: ScryfallCard) => void
}

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text
  if (card.card_faces) {
    return card.card_faces.map((f) => f.oracle_text ?? '').filter(Boolean).join(' // ')
  }
  return ''
}

export function CardGrid({ cards, searchTerm = '', onCardClick }: CardGridProps) {
  const t = useT()

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-500">
        <p className="text-lg">{t('search.noResults')}</p>
        <p className="text-sm">{t('search.tryDifferent')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {cards.map((card) => {
        const name = getCardName(card)
        const typeLine = getCardTypeLine(card)
        const oracleText = getOracleText(card)

        return (
          <SearchCardItem
            key={card.id}
            card={card}
            name={name}
            typeLine={typeLine}
            oracleText={oracleText}
            searchTerm={searchTerm}
            onCardClick={onCardClick}
          />
        )
      })}
    </div>
  )
}

function SearchCardItem({ card, name, typeLine, oracleText, searchTerm, onCardClick }: {
  card: ScryfallCard
  name: string
  typeLine: string
  oracleText: string
  searchTerm: string
  onCardClick?: (card: ScryfallCard) => void
}) {
  return (
    <div
      className="group cursor-pointer border border-transparent transition-colors hover:border-hairline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
      role="button"
      tabIndex={0}
      onClick={() => onCardClick?.(card)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCardClick?.(card) } }}
      aria-label={name}
    >
      <CardImage card={card} />
      <div className="mt-1 space-y-0.5 px-1">
        <p className="truncate text-xs font-medium text-cream-200">
          <HighlightText text={name} term={searchTerm} />
        </p>
        <p className="truncate text-[10px] text-cream-400">
          <HighlightText text={typeLine} term={searchTerm} />
        </p>
        {oracleText && (
          <p className="line-clamp-2 text-[10px] leading-tight text-cream-500">
            <OracleText text={oracleText} term={searchTerm} />
          </p>
        )}
      </div>
    </div>
  )
}

export function CardGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="aspect-[488/680] animate-pulse bg-ash-800" />
          <div className="mx-auto h-3 w-3/4 animate-pulse bg-ash-800" />
        </div>
      ))}
    </div>
  )
}
