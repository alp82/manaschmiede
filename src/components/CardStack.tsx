import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ScryfallCard } from '../lib/scryfall/types'
import { CardImage } from './CardImage'
import { cn } from '../lib/utils'
import { useDeckSounds } from '../lib/sounds'

interface CardStackProps {
  card: ScryfallCard
  quantity: number
  locked?: boolean
  highlighted?: boolean
  isNew?: boolean
  onClick?: () => void
  onToggleLock?: () => void
  onChangeQuantity?: (qty: number) => void
  onRemove?: () => void
  innerRef?: (el: HTMLElement | null) => void
}

/**
 * Visual card stack — 1x single, 2-4x offset stack edges, 5+ thicker edges.
 *
 * Specimen treatment: sharp rectangles, hairline stack edges instead of
 * rounded outlines, mono quantity/lock/new badges, ink-red hairline on
 * highlighted state (no scale, no glow). Context menu is a hairline frame
 * with mono items.
 */
export const CardStack = memo(function CardStack({
  card,
  quantity,
  locked,
  highlighted,
  isNew,
  onClick,
  onToggleLock,
  onChangeQuantity,
  onRemove,
  innerRef,
}: CardStackProps) {
  const sounds = useDeckSounds()
  const extraCount = quantity <= 1 ? 0 : Math.min(quantity - 1, 3)
  const offset = extraCount * 3

  const hasContextMenu = !!(onToggleLock || onChangeQuantity || onRemove)

  // Exit animation — when onRemove fires, we let the card animate out first
  // and then actually call the parent's onRemove so the component unmounts
  // from the next state update. 200ms matches --animate-card-exit.
  const [exiting, setExiting] = useState(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
  }, [])

  const handleRemoveWithExit = useCallback(() => {
    if (!onRemove || exiting) return
    setExiting(true)
    exitTimerRef.current = setTimeout(() => {
      onRemove()
    }, 200)
  }, [onRemove, exiting])

  // Settle animation — captured on mount. If this card mounts as `isNew`,
  // we play card-settle once on first paint. Using a ref so later isNew
  // changes don't re-trigger the animation.
  const settleOnMountRef = useRef(isNew === true)

  // Context menu state
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)

  const openMenu = useCallback((x: number, y: number) => {
    const mx = Math.min(x, window.innerWidth - 200)
    const my = Math.min(y, window.innerHeight - 220)
    setMenuPos({ x: mx, y: my })
  }, [])

  const closeMenu = useCallback(() => setMenuPos(null), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!hasContextMenu) return
      e.preventDefault()
      openMenu(e.clientX, e.clientY)
    },
    [hasContextMenu, openMenu],
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!hasContextMenu) return
      longPressTriggered.current = false
      const touch = e.touches[0]
      const x = touch.clientX
      const y = touch.clientY
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true
        openMenu(x, y)
      }, 400)
    },
    [hasContextMenu, openMenu],
  )

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = useCallback(() => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }
    onClick?.()
  }, [onClick])

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onClick?.()
          }
          if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove && !locked) {
            e.preventDefault()
            handleRemoveWithExit()
          }
        }}
        aria-label={`${card.name}, ${quantity}x${locked ? ', locked' : ''}`}
        ref={innerRef as React.Ref<HTMLButtonElement>}
        className={cn(
          'group relative transition-transform duration-150',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
          highlighted && '-translate-y-1',
        )}
        style={{
          marginTop: offset > 0 ? `${offset}px` : undefined,
          marginLeft: offset > 0 ? `${offset}px` : undefined,
          animation: exiting
            ? 'card-exit 200ms cubic-bezier(0.16, 1, 0.3, 1) both'
            : settleOnMountRef.current
              ? 'card-settle 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both'
              : undefined,
        }}
      >
        {/* Stack edges — hairline sheets peeking behind the main card */}
        {Array.from({ length: extraCount }, (_, i) => (
          <div
            key={i}
            className="absolute border border-hairline bg-ash-800"
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
          className={cn(
            'relative overflow-hidden border transition-colors duration-150',
            highlighted
              ? 'border-ink-red'
              : 'border-hairline group-hover:border-hairline-strong',
            isNew && !locked && 'border-ink-red',
          )}
          style={{ zIndex: extraCount + 1 }}
        >
          <CardImage card={card} size="normal" />

          {/* Quantity badge — mono on hairline slab */}
          {quantity > 1 && (
            <span className="absolute bottom-0 right-0 border-l border-t border-hairline-strong bg-ash-900/90 px-1.5 py-0.5 font-mono text-mono-tag uppercase tabular-nums tracking-mono-tag text-cream-100">
              {quantity}x
            </span>
          )}

          {/* Lock indicator — mono slab */}
          {locked && (
            <span className="absolute left-0 top-0 border-b border-r border-hairline-strong bg-ash-900/90 px-1.5 py-0.5 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-100">
              Lock
            </span>
          )}

          {/* New card indicator — mono slab with ink-red ground */}
          {isNew && !locked && (
            <span className="absolute left-0 top-0 bg-ink-red px-1.5 py-0.5 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-100">
              New
            </span>
          )}
        </div>
      </button>

      {/* Context menu — hairline frame, mono items */}
      {menuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={closeMenu} />
            <div
              className="fixed z-[61] min-w-[180px] border border-hairline-strong bg-ash-900"
              style={{
                left: menuPos.x,
                top: menuPos.y,
                animation: 'card-enter 150ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
              }}
            >
              {onToggleLock && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleLock()
                    closeMenu()
                    sounds.uiClick()
                  }}
                  className="flex w-full items-center gap-2 border-b border-hairline px-4 py-2.5 text-left font-mono text-mono-label uppercase tracking-mono-label text-cream-200 transition-colors hover:bg-ash-800 hover:text-cream-100"
                >
                  {locked ? 'Unlock' : 'Lock'}
                </button>
              )}
              {onChangeQuantity && (
                <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
                  <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
                    Qty
                  </span>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        onChangeQuantity(n)
                        closeMenu()
                        sounds.uiClick()
                      }}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center border font-mono text-mono-tag tabular-nums tracking-mono-tag transition-colors',
                        n === quantity
                          ? 'border-ink-red bg-cream-100 text-ash-900'
                          : 'border-hairline text-cream-300 hover:border-hairline-strong hover:text-cream-100',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {onRemove && !locked && (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu()
                    sounds.uiClick()
                    handleRemoveWithExit()
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-mono text-mono-label uppercase tracking-mono-label text-ink-red-bright transition-colors hover:bg-ash-800"
                >
                  Remove
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  )
})
