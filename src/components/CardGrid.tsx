import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardTypeLine, getCardImageUri } from '../lib/scryfall/types'
import { CardImage } from './CardImage'
import { HighlightText } from './HighlightText'
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
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewUrl = getCardImageUri(card, 'normal')

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (window.matchMedia('(hover: none)').matches) return
    previewTimer.current = setTimeout(() => setPreviewPos({ x: e.clientX, y: e.clientY }), 400)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (previewPos) setPreviewPos({ x: e.clientX, y: e.clientY })
  }, [previewPos])

  const handleMouseLeave = useCallback(() => {
    if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null }
    setPreviewPos(null)
  }, [])

  return (
    <div
      className="group cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => { setPreviewPos(null); onCardClick?.(card) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCardClick?.(card) } }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ boxShadow: 'var(--shadow-raised)' }}
      aria-label={name}
    >
      <CardImage card={card} />
      <div className="mt-1 space-y-0.5 px-1">
        <p className="truncate text-xs font-medium text-surface-200">
          <HighlightText text={name} term={searchTerm} />
        </p>
        <p className="truncate text-[10px] text-surface-400">
          <HighlightText text={typeLine} term={searchTerm} />
        </p>
        {oracleText && (
          <p className="line-clamp-2 text-[10px] leading-tight text-surface-500">
            <HighlightText text={oracleText} term={searchTerm} />
          </p>
        )}
      </div>

      {/* Hover card preview - desktop only */}
      {previewPos && previewUrl && createPortal(
        <div
          className="pointer-events-none fixed z-[55]"
          style={{
            left: previewPos.x + 260 > window.innerWidth ? previewPos.x - 250 : previewPos.x + 16,
            top: Math.max(8, Math.min(previewPos.y - 60, window.innerHeight - 380)),
            animation: 'card-enter 150ms cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          <img src={previewUrl} alt="" className="w-[240px] rounded-xl shadow-2xl" style={{ aspectRatio: '488/680' }} />
        </div>,
        document.body,
      )}
    </div>
  )
}

export function CardGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="aspect-[488/680] animate-pulse rounded-lg bg-surface-700" />
          <div className="mx-auto h-3 w-3/4 animate-pulse rounded bg-surface-700" />
        </div>
      ))}
    </div>
  )
}
