import { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri, getCardTypeLine } from '../lib/scryfall/types'
import { ManaCost } from './ManaCost'
import { HighlightText } from './HighlightText'
import { useT } from '../lib/i18n'

interface CardLightboxProps {
  cards: ScryfallCard[]
  currentIndex: number
  searchTerm?: string
  onClose: () => void
  onNavigate: (index: number) => void
}

const SWIPE_THRESHOLD = 50

export function CardLightbox({ cards, currentIndex, searchTerm = '', onClose, onNavigate }: CardLightboxProps) {
  const card = cards[currentIndex]
  if (!card) return null

  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < cards.length - 1

  const t = useT()
  const name = getCardName(card)
  const imageUrl = getCardImageUri(card, 'large')
  const typeLine = getCardTypeLine(card)
  const oracleText = card.printed_text || card.oracle_text || ''

  // Preload adjacent images
  const prevCard = hasPrev ? cards[currentIndex - 1] : null
  const nextCard = hasNext ? cards[currentIndex + 1] : null
  const prevImage = prevCard ? getCardImageUri(prevCard, 'large') : null
  const nextImage = nextCard ? getCardImageUri(nextCard, 'large') : null

  // Swipe state (mobile only)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const [settling, setSettling] = useState(false)
  const skipTransition = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (settling) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isHorizontalSwipe.current = null
  }, [settling])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || settling) return
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current

    if (isHorizontalSwipe.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy)
    }
    if (!isHorizontalSwipe.current) return

    // Rubber-band at edges
    if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) {
      setSwipeX(dx * 0.15)
    } else {
      setSwipeX(dx)
    }
  }, [hasPrev, hasNext, settling])

  const handleTouchEnd = useCallback(() => {
    if (settling) return
    const dx = swipeX
    touchStartX.current = null
    touchStartY.current = null
    isHorizontalSwipe.current = null

    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (dx < 0 && hasNext) {
        // Animate off-screen left, then navigate
        setSettling(true)
        setSwipeX(-window.innerWidth)
        setTimeout(() => { skipTransition.current = true; onNavigate(currentIndex + 1); setSwipeX(0); setSettling(false) }, 200)
        return
      }
      if (dx > 0 && hasPrev) {
        setSettling(true)
        setSwipeX(window.innerWidth)
        setTimeout(() => { skipTransition.current = true; onNavigate(currentIndex - 1); setSwipeX(0); setSettling(false) }, 200)
        return
      }
    }
    setSwipeX(0)
  }, [swipeX, currentIndex, hasNext, hasPrev, onNavigate, settling])

  // Keyboard nav
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && hasNext) onNavigate(currentIndex + 1)
    },
    [onClose, onNavigate, currentIndex, hasPrev, hasNext],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  // Clear skipTransition after paint so next interactions animate normally
  useEffect(() => {
    if (skipTransition.current) {
      requestAnimationFrame(() => { skipTransition.current = false })
    }
  }, [currentIndex])

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // The adjacent card peeking in from the side during swipe
  const showPeekPrev = swipeX > 0 && prevImage
  const showPeekNext = swipeX < 0 && nextImage

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Peek: adjacent card sliding in (mobile only) */}
      {showPeekPrev && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex items-start justify-center pt-8 md:hidden"
          style={{
            width: '100%',
            transform: `translateX(${swipeX - window.innerWidth}px)`,
            transition: settling ? 'transform 0.2s ease-out' : 'none',
          }}
        >
          <img src={prevImage} alt="" className="max-h-[50vh] rounded-xl shadow-2xl" style={{ width: 'auto', maxWidth: '80vw' }} />
        </div>
      )}
      {showPeekNext && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex items-start justify-center pt-8 md:hidden"
          style={{
            width: '100%',
            transform: `translateX(${swipeX + window.innerWidth}px)`,
            transition: settling ? 'transform 0.2s ease-out' : 'none',
          }}
        >
          <img src={nextImage} alt="" className="max-h-[50vh] rounded-xl shadow-2xl" style={{ width: 'auto', maxWidth: '80vw' }} />
        </div>
      )}

      {/* Main content */}
      <div
        className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-8 md:flex-row md:gap-6 md:overflow-y-auto md:px-[max(20vw,80px)] md:py-8"
        onClick={handleBackdropClick}
        style={{
          transform: swipeX ? `translateX(${swipeX}px)` : undefined,
          transition: skipTransition.current ? 'none' : settling ? 'transform 0.2s ease-out' : swipeX === 0 ? 'transform 0.15s ease-out' : 'none',
        }}
      >
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              className="max-h-[50vh] rounded-xl shadow-2xl md:max-h-[85vh]"
              style={{ width: 'auto', maxWidth: '400px' }}
            />
          ) : (
            <div className="flex h-[300px] w-[215px] items-center justify-center rounded-xl bg-surface-800 text-surface-400 md:h-[560px] md:w-[400px]">
              {name}
            </div>
          )}
        </div>

        <div className="w-full max-w-sm space-y-3 px-2 pb-8 md:pb-0" onClick={(e) => e.stopPropagation()}>
          <h2 className="font-display text-xl font-bold text-surface-100 md:text-2xl">
            <HighlightText text={name} term={searchTerm} />
          </h2>
          <p className="text-sm text-surface-400">
            <HighlightText text={typeLine} term={searchTerm} />
          </p>
          {card.mana_cost && (
            <div className="flex items-center gap-2 text-sm text-surface-300">
              <span>{t('lightbox.manaCost')}</span>
              <ManaCost cost={card.mana_cost} />
            </div>
          )}
          {oracleText && (
            <p className="whitespace-pre-line rounded-lg bg-surface-800/50 p-3 text-sm text-surface-200">
              <HighlightText text={oracleText} term={searchTerm} />
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-surface-500">
            <span>{card.set_name}</span>
            <span className="capitalize">{card.rarity}</span>
          </div>

          {/* Mobile nav + counter */}
          <div className="flex items-center justify-between md:block">
            <button
              type="button"
              onClick={() => hasPrev && onNavigate(currentIndex - 1)}
              disabled={!hasPrev}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-700/80 text-lg text-surface-300 disabled:opacity-20 md:hidden"
            >
              &lsaquo;
            </button>
            <p className="text-xs text-surface-600">
              {currentIndex + 1} / {cards.length}
            </p>
            <button
              type="button"
              onClick={() => hasNext && onNavigate(currentIndex + 1)}
              disabled={!hasNext}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-700/80 text-lg text-surface-300 disabled:opacity-20 md:hidden"
            >
              &rsaquo;
            </button>
          </div>
        </div>
      </div>

      {/* Left nav — desktop only */}
      {hasPrev && (
        <button
          type="button"
          onClick={() => onNavigate(currentIndex - 1)}
          className="absolute left-0 top-0 hidden h-full w-16 items-center justify-center text-4xl text-surface-400 transition-colors hover:bg-white/5 hover:text-white md:flex"
        >
          &lsaquo;
        </button>
      )}

      {/* Right nav — desktop only */}
      {hasNext && (
        <button
          type="button"
          onClick={() => onNavigate(currentIndex + 1)}
          className="absolute right-0 top-0 hidden h-full w-16 items-center justify-center text-4xl text-surface-400 transition-colors hover:bg-white/5 hover:text-white md:flex"
        >
          &rsaquo;
        </button>
      )}

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface-800/80 text-lg text-surface-300 hover:bg-surface-700 hover:text-white"
      >
        x
      </button>

      {/* Preload adjacent images */}
      {prevImage && <link rel="preload" as="image" href={prevImage} />}
      {nextImage && <link rel="preload" as="image" href={nextImage} />}
    </div>,
    document.body,
  )
}
