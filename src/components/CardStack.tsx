import { memo, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardImageUri } from '../lib/scryfall/types'
import { CardImage } from './CardImage'
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

/** Visual card stack: 1x single, 2-4x offset stack edges, 5+ thicker edges */
export const CardStack = memo(function CardStack({ card, quantity, locked, highlighted, isNew, onClick, onToggleLock, onChangeQuantity, onRemove, innerRef }: CardStackProps) {
  const sounds = useDeckSounds()
  const extraCount = quantity <= 1 ? 0 : Math.min(quantity - 1, 3)
  const offset = extraCount * 3

  const hasContextMenu = !!(onToggleLock || onChangeQuantity || onRemove)

  // Context menu state
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)

  // Hover preview state (desktop only)
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewUrl = getCardImageUri(card, 'normal')

  const openMenu = useCallback((x: number, y: number) => {
    // Keep menu within viewport
    const mx = Math.min(x, window.innerWidth - 180)
    const my = Math.min(y, window.innerHeight - 200)
    setMenuPos({ x: mx, y: my })
  }, [])

  const closeMenu = useCallback(() => setMenuPos(null), [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!hasContextMenu) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY)
  }, [hasContextMenu, openMenu])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!hasContextMenu) return
    longPressTriggered.current = false
    const touch = e.touches[0]
    const x = touch.clientX
    const y = touch.clientY
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      openMenu(x, y)
    }, 400)
  }, [hasContextMenu, openMenu])

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
    setPreviewPos(null)
    onClick?.()
  }, [onClick])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (window.matchMedia('(hover: none)').matches || menuPos) return
    previewTimer.current = setTimeout(() => {
      setPreviewPos({ x: e.clientX, y: e.clientY })
    }, 400)
  }, [menuPos])

  const handleMouseMovePreview = useCallback((e: React.MouseEvent) => {
    if (previewPos) setPreviewPos({ x: e.clientX, y: e.clientY })
  }, [previewPos])

  const handleMouseLeave = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current)
      previewTimer.current = null
    }
    setPreviewPos(null)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMovePreview}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onClick?.() }
          if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove && !locked) { e.preventDefault(); onRemove() }
        }}
        aria-label={`${card.name}, ${quantity}x${locked ? ', locked' : ''}`}
        ref={innerRef as React.Ref<HTMLButtonElement>}
        className={`group relative rounded-lg transition-all duration-300 ${
          highlighted ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-900 scale-105' : ''
        } ${isNew && !locked ? 'animate-[glow-pulse_1.5s_ease-in-out_1]' : ''}`}
        style={{
          boxShadow: 'var(--shadow-raised)',
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

      {/* Context menu - portal to body to escape transforms */}
      {menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeMenu} />
          <div
            className="fixed z-[61] rounded-xl border border-surface-700 bg-surface-800 p-1.5 shadow-2xl"
            style={{ left: menuPos.x, top: menuPos.y, animation: 'card-enter 150ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
          >
            {onToggleLock && (
              <button
                type="button"
                onClick={() => { onToggleLock(); closeMenu(); sounds.uiClick() }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-200 hover:bg-surface-700"
              >
                {locked ? '\u{1F513}' : '\u{1F512}'} {locked ? 'Unlock' : 'Lock'}
              </button>
            )}
            {onChangeQuantity && (
              <div className="flex items-center gap-1 rounded-lg px-3 py-2">
                <span className="text-sm text-surface-400 mr-2">Qty</span>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { onChangeQuantity(n); closeMenu(); sounds.uiClick() }}
                    className={`flex h-7 w-7 items-center justify-center rounded text-sm font-medium transition-colors ${
                      n === quantity ? 'bg-accent text-white' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            {onRemove && !locked && (
              <button
                type="button"
                onClick={() => { onRemove(); closeMenu(); sounds.uiClick() }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-mana-red hover:bg-surface-700"
              >
                ✕ Remove
              </button>
            )}
          </div>
        </>,
        document.body,
      )}

      {/* Hover card preview - desktop only */}
      {previewPos && previewUrl && !menuPos && createPortal(
        <div
          className="pointer-events-none fixed z-[55]"
          style={{
            left: previewPos.x + 260 > window.innerWidth ? previewPos.x - 250 : previewPos.x + 16,
            top: Math.max(8, Math.min(previewPos.y - 60, window.innerHeight - 380)),
            animation: 'card-enter 150ms cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          <img
            src={previewUrl}
            alt=""
            className="w-[240px] rounded-xl shadow-2xl"
            style={{ aspectRatio: '488/680' }}
          />
        </div>,
        document.body,
      )}
    </>
  )
})
