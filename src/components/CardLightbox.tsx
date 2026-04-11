import { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri, getCardTypeLine } from '../lib/scryfall/types'
import { ManaCost } from './ManaCost'
import { OracleText } from './OracleText'
import { HighlightText } from './HighlightText'
import { Kbd } from './ui/Kbd'
import { useT } from '../lib/i18n'
import { useDeckSounds } from '../lib/sounds'

interface CardLightboxProps {
  cards: ScryfallCard[]
  currentIndex: number
  searchTerm?: string
  onClose: () => void
  onNavigate: (index: number) => void
  /** Render additional action buttons for the current card. */
  renderActions?: (card: ScryfallCard) => React.ReactNode
}

const SWIPE_THRESHOLD = 50

/**
 * Specimen card lightbox — a framed plate.
 *
 * Sharp hairline frame, no rounded corners, no backdrop blur (pure ash-900
 * scrim). Cinzel title, mono metadata rail, body-face oracle text. Swipe,
 * keyboard nav, and peek preserved.
 */
export function CardLightbox({
  cards,
  currentIndex,
  searchTerm = '',
  onClose,
  onNavigate,
  renderActions,
}: CardLightboxProps) {
  const card: ScryfallCard | undefined = cards[currentIndex]
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < cards.length - 1

  const t = useT()
  const sounds = useDeckSounds()

  // Swipe state (mobile only)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const [settling, setSettling] = useState(false)
  const skipTransition = useRef(false)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (settling) return
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
      isHorizontalSwipe.current = null
    },
    [settling],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null || settling) return
      const dx = e.touches[0].clientX - touchStartX.current
      const dy = e.touches[0].clientY - touchStartY.current

      if (isHorizontalSwipe.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy)
      }
      if (!isHorizontalSwipe.current) return

      if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) {
        setSwipeX(dx * 0.15)
      } else {
        setSwipeX(dx)
      }
    },
    [hasPrev, hasNext, settling],
  )

  const closeWithSound = useCallback(() => {
    sounds.dismiss()
    onClose()
  }, [sounds, onClose])
  const navigateWithSound = useCallback(
    (idx: number) => {
      sounds.cardSlide()
      onNavigate(idx)
    },
    [sounds, onNavigate],
  )

  const handleTouchEnd = useCallback(() => {
    if (settling) return
    const dx = swipeX
    touchStartX.current = null
    touchStartY.current = null
    isHorizontalSwipe.current = null

    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (dx < 0 && hasNext) {
        setSettling(true)
        setSwipeX(-window.innerWidth)
        setTimeout(() => {
          skipTransition.current = true
          navigateWithSound(currentIndex + 1)
          setSwipeX(0)
          setSettling(false)
        }, 200)
        return
      }
      if (dx > 0 && hasPrev) {
        setSettling(true)
        setSwipeX(window.innerWidth)
        setTimeout(() => {
          skipTransition.current = true
          navigateWithSound(currentIndex - 1)
          setSwipeX(0)
          setSettling(false)
        }, 200)
        return
      }
    }
    setSwipeX(0)
  }, [swipeX, currentIndex, hasNext, hasPrev, navigateWithSound, settling])

  // Keyboard nav
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWithSound()
      if (e.key === 'ArrowLeft' && hasPrev) navigateWithSound(currentIndex - 1)
      if (e.key === 'ArrowRight' && hasNext) navigateWithSound(currentIndex + 1)
    },
    [closeWithSound, navigateWithSound, currentIndex, hasPrev, hasNext],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  useEffect(() => {
    if (skipTransition.current) {
      requestAnimationFrame(() => {
        skipTransition.current = false
      })
    }
  }, [currentIndex])

  // All hooks are declared above. Early return is safe here.
  if (!card) return null

  const name = getCardName(card)
  const imageUrl = getCardImageUri(card, 'large')
  const typeLine = getCardTypeLine(card)
  const oracleText = card.printed_text || card.oracle_text || ''

  // Preload adjacent images
  const prevCard = hasPrev ? cards[currentIndex - 1] : null
  const nextCard = hasNext ? cards[currentIndex + 1] : null
  const prevImage = prevCard ? getCardImageUri(prevCard, 'large') : null
  const nextImage = nextCard ? getCardImageUri(nextCard, 'large') : null

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) closeWithSound()
  }

  const showPeekPrev = swipeX > 0 && prevImage
  const showPeekNext = swipeX < 0 && nextImage

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ash-900/90"
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
          <img
            src={prevImage}
            alt=""
            className="max-h-[50vh] border border-hairline-strong"
            style={{ width: 'auto', maxWidth: '80vw' }}
          />
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
          <img
            src={nextImage}
            alt=""
            className="max-h-[50vh] border border-hairline-strong"
            style={{ width: 'auto', maxWidth: '80vw' }}
          />
        </div>
      )}

      {/* Main content */}
      <div
        className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-12 md:flex-row md:gap-10 md:overflow-y-auto md:px-[max(10vw,80px)] md:py-12"
        onClick={handleBackdropClick}
        style={{
          transform: swipeX ? `translateX(${swipeX}px)` : undefined,
          transition: skipTransition.current
            ? 'none'
            : settling
              ? 'transform 0.2s ease-out'
              : swipeX === 0
                ? 'transform 0.15s ease-out'
                : 'none',
        }}
      >
        <div className="flex-shrink-0 border border-hairline-strong" onClick={(e) => e.stopPropagation()}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              className="block max-h-[50vh] md:max-h-[85vh]"
              style={{ width: 'auto', maxWidth: '400px' }}
            />
          ) : (
            <div className="flex h-[300px] w-[215px] items-center justify-center bg-ash-800 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-300 md:h-[560px] md:w-[400px]">
              {name}
            </div>
          )}
        </div>

        <div className="w-full max-w-md space-y-5 px-2 pb-8 md:pb-0" onClick={(e) => e.stopPropagation()}>
          {/* Eyebrow: set + rarity */}
          <div className="flex items-center gap-3 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
            <span>{card.set_name}</span>
            <span className="h-px w-4 bg-hairline" aria-hidden="true" />
            <span>{card.rarity}</span>
          </div>

          {/* Title */}
          <h2 className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100 md:text-display-section">
            <HighlightText text={name} term={searchTerm} />
          </h2>

          {/* Type line */}
          <p className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            <HighlightText text={typeLine} term={searchTerm} />
          </p>

          {/* Mana cost */}
          {(() => {
            // Adventure / split / MDFC cards store each face's cost separately. The
            // top-level `mana_cost` is a combined "{A} // {B}" string whose symbols
            // all render side-by-side, producing a misleading "7-mana" display.
            // Prefer the primary face's cost when `card_faces` exists.
            const primaryCost = card.card_faces?.[0]?.mana_cost ?? card.mana_cost
            if (!primaryCost) return null
            return (
              <div className="flex items-center gap-3">
                <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
                  {t('lightbox.manaCost')}
                </span>
                <ManaCost cost={primaryCost} />
              </div>
            )
          })()}

          {/* Oracle text — framed body */}
          {oracleText && (
            <p className="whitespace-pre-line border border-hairline p-4 font-body text-sm leading-relaxed text-cream-200">
              <OracleText text={oracleText} term={searchTerm} />
            </p>
          )}

          {renderActions && <div className="pt-1">{renderActions(card)}</div>}

          {/* Mobile nav + counter */}
          <div className="flex items-center justify-between md:block">
            <button
              type="button"
              onClick={() => hasPrev && navigateWithSound(currentIndex - 1)}
              disabled={!hasPrev}
              className="flex h-11 w-11 items-center justify-center border border-hairline font-mono text-lg text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none md:hidden md:h-9 md:w-9"
              aria-label="Previous"
            >
              &lsaquo;
            </button>
            <p className="font-mono text-mono-tag tabular-nums tracking-mono-tag text-cream-500">
              {String(currentIndex + 1).padStart(2, '0')} / {String(cards.length).padStart(2, '0')}
            </p>
            <button
              type="button"
              onClick={() => hasNext && navigateWithSound(currentIndex + 1)}
              disabled={!hasNext}
              className="flex h-11 w-11 items-center justify-center border border-hairline font-mono text-lg text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none md:hidden md:h-9 md:w-9"
              aria-label="Next"
            >
              &rsaquo;
            </button>
          </div>
        </div>
      </div>

      {/* Left nav - desktop only */}
      {hasPrev && (
        <button
          type="button"
          onClick={() => navigateWithSound(currentIndex - 1)}
          className="absolute left-0 top-0 hidden h-full flex-col items-center justify-center font-mono text-4xl text-cream-400 transition-colors hover:bg-ash-800/30 hover:text-cream-100 md:flex"
          style={{ width: 'max(10vw, 60px)' }}
          aria-label="Previous"
        >
          <span>&lsaquo;</span>
        </button>
      )}

      {/* Right nav - desktop only */}
      {hasNext && (
        <button
          type="button"
          onClick={() => navigateWithSound(currentIndex + 1)}
          className="absolute right-0 top-0 hidden h-full flex-col items-center justify-center font-mono text-4xl text-cream-400 transition-colors hover:bg-ash-800/30 hover:text-cream-100 md:flex"
          style={{ width: 'max(10vw, 60px)' }}
          aria-label="Next"
        >
          <span>&rsaquo;</span>
        </button>
      )}

      {/* Close button — mono label, hairline frame */}
      <button
        type="button"
        onClick={closeWithSound}
        className="absolute right-4 top-4 z-10 flex items-center gap-2 border border-hairline-strong bg-ash-900 px-3 py-1.5 font-mono text-mono-label uppercase tracking-mono-label text-cream-200 transition-colors hover:border-ink-red hover:text-cream-100"
        aria-label="Close"
      >
        <span>{t('action.close')}</span>
        <Kbd className="border-hairline">{'\u238B'}</Kbd>
      </button>

      {/* Preload adjacent images */}
      {prevImage && <link rel="preload" as="image" href={prevImage} />}
      {nextImage && <link rel="preload" as="image" href={nextImage} />}
    </div>,
    document.body,
  )
}
