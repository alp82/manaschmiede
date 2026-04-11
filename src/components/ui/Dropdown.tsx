import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * Specimen Dropdown — the drawer primitive from the component kit.
 *
 * Replaces native <select> with a custom hairline-framed drawer: click
 * the trigger, a flat hairline panel slides down showing all options as
 * mono-label rows. Selected option inverts to cream fill + ash label +
 * ink-red left slab. Hover lifts the row bg to ash-800. Keyboard: arrow
 * keys to move, Enter to commit, Escape to close.
 *
 * Closes on outside click. The panel is absolutely positioned beneath the
 * trigger (no portal) so it flows naturally in the FilterBar row.
 *
 * API intentionally mirrors the subset of <select> we use: value, onChange,
 * options (with value + label). No multi-select, no search — that's deferred.
 */

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  className?: string
  ariaLabel?: string
  disabled?: boolean
}

export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
  disabled,
}: DropdownProps) {
  const [open, setOpen] = React.useState(false)
  const [highlightIndex, setHighlightIndex] = React.useState(-1)
  const [alignRight, setAlignRight] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const typeBufferRef = React.useRef('')
  const typeBufferTimer = React.useRef<number | null>(null)
  // Track whether the previous render had the panel open, so we can
  // return focus to the trigger exactly once on close.
  const wasOpenRef = React.useRef(false)

  const selectedOption = options.find((o) => o.value === value)
  const displayLabel = selectedOption?.label ?? placeholder ?? ''

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Scroll highlighted into view
  React.useEffect(() => {
    if (!open || highlightIndex < 0 || !panelRef.current) return
    const row = panelRef.current.children[highlightIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightIndex])

  // Measure on open: if the panel would clip the right edge of the
  // viewport, flip to right-aligned.
  React.useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    const triggerRect = trigger.getBoundingClientRect()
    const panelWidth = panel.offsetWidth
    if (triggerRect.left + panelWidth > window.innerWidth) {
      setAlignRight(true)
    } else {
      setAlignRight(false)
    }
  }, [open])

  // Focus return on close
  React.useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerRef.current?.focus()
    }
    wasOpenRef.current = open
  }, [open])

  function commit(v: string) {
    onChange(v)
    setOpen(false)
    setHighlightIndex(-1)
  }

  function handleTypeToJump(char: string) {
    if (typeBufferTimer.current) {
      window.clearTimeout(typeBufferTimer.current)
    }
    typeBufferRef.current += char.toLowerCase()
    const prefix = typeBufferRef.current
    const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(prefix))
    if (idx >= 0) {
      setHighlightIndex(idx)
    }
    typeBufferTimer.current = window.setTimeout(() => {
      typeBufferRef.current = ''
      typeBufferTimer.current = null
    }, 500)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return

    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        const currentIndex = options.findIndex((o) => o.value === value)
        setHighlightIndex(currentIndex >= 0 ? currentIndex : 0)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setHighlightIndex(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIndex >= 0) commit(options[highlightIndex].value)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setHighlightIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setHighlightIndex(options.length - 1)
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-to-jump: single printable character, buffer for 500ms
      e.preventDefault()
      handleTypeToJump(e.key)
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'flex w-full items-center justify-between gap-2 border border-hairline-strong bg-ash-800 pl-3 pr-2 py-2',
          'font-mono text-mono-label uppercase tracking-mono-label text-cream-100',
          'cursor-pointer transition-colors',
          'hover:border-hairline-strong',
          'focus-visible:outline-none focus-visible:border-ink-red',
          open && 'border-ink-red',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <span
          aria-hidden="true"
          className={cn(
            'font-mono text-mono-tag text-cream-400 transition-transform duration-150',
            open && 'rotate-180',
          )}
        >
          {'\u25BE'}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute top-[calc(100%+2px)] z-30 max-h-72 min-w-full overflow-y-auto border border-hairline-strong bg-ash-900',
            alignRight ? 'right-0 left-auto' : 'left-0 right-auto',
          )}
          style={{ animation: 'drawer-enter 150ms ease-out both' }}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value
            const isHighlighted = i === highlightIndex
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => commit(opt.value)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={cn(
                  'relative flex w-full items-center border-b border-hairline/40 px-4 py-2 text-left',
                  'font-mono text-mono-label uppercase tracking-mono-label whitespace-nowrap',
                  'transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
                  isSelected
                    ? 'bg-cream-100 text-ash-900'
                    : isHighlighted
                      ? 'bg-ash-800 text-cream-100'
                      : 'text-cream-200 hover:bg-ash-800 hover:text-cream-100',
                  'last:border-b-0',
                )}
              >
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 top-0 w-[3px] bg-ink-red"
                  />
                )}
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
