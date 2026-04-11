import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface SectionLaneHeaderProps {
  /** Marginal letter in mono-marginal, e.g. "A", "B", "L". Optional. */
  letter?: string
  /** Main lane label in Cinzel display-eyebrow. */
  label: string
  /** Italic description shown sm+ in cream-500. Optional. */
  description?: string
  /**
   * Count slot. Callers pass the already-formatted node
   * (e.g. "12 / 20" with color tone, or a bare number) so the
   * header doesn't need to know about target-count semantics.
   */
  count: ReactNode
  /**
   * Optional progress bar rendered directly beneath the count slot.
   * 0–100. If omitted, no bar is rendered. `progressOver` tints the
   * fill ink-red when the section exceeds its target.
   */
  progressPct?: number
  progressOver?: boolean
  collapsed: boolean
  onToggle: () => void
  className?: string
}

/**
 * Specimen SectionLaneHeader — a deck-lane section header.
 *
 * Shape: marginal mono letter + Cinzel display-eyebrow label (+ optional
 * italic description sm+) on the left, mono count + `+`/`−` collapse
 * glyph on the right. Hairline bottom border, clickable row.
 *
 * Used by the deck view and StepDeckFill section lanes. The ink-red core
 * slab is drawn by the lane wrapper, not this header.
 */
export function SectionLaneHeader({
  letter,
  label,
  description,
  count,
  progressPct,
  progressOver,
  collapsed,
  onToggle,
  className,
}: SectionLaneHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(
        'mb-3 flex w-full flex-col gap-1 border-b border-hairline pb-2 text-left',
        'cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-3">
          {letter && (
            <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
              {letter}
            </span>
          )}
          <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-100">
            {label}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
          <span className="flex items-baseline gap-3 font-mono text-mono-label uppercase leading-none tracking-mono-label">
            {count}
            <span aria-hidden="true" className="text-cream-500">
              {collapsed ? '+' : '\u2212'}
            </span>
          </span>
          {progressPct !== undefined && (
            <span
              aria-hidden="true"
              className="h-[2px] w-20 bg-ash-800"
            >
              <span
                className={cn(
                  'block h-full transition-[width] duration-300',
                  progressOver ? 'bg-ink-red-bright' : 'bg-cream-200',
                )}
                style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
              />
            </span>
          )}
        </span>
      </div>
      {description && (
        <p className="font-body text-sm italic text-cream-500">
          {description}
        </p>
      )}
    </button>
  )
}
