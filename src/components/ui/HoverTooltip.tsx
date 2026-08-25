import { useState } from 'react'
import { useDeckSounds } from '../../lib/sounds'
import { cn } from '../../lib/utils'

/**
 * Specimen hover tooltip — the only tooltip in the app.
 *
 * Per AGENTS.md: a tiny mono-tag label with a hairline rule 1px above it, no
 * box, 6px offset, and a rate-limited `click-soft` tick on mount. The rule is
 * the structure — it is what ties the label to the control it annotates. It
 * used to draw a hairline-bordered ash-900 panel at an 8px offset with no
 * sound, which is a box, and boxes are not the Specimen's structural language.
 *
 * Used by the color-mode switch in `FilterBar` and by the stats filter's
 * LINKED yoke.
 */
export function HoverTooltip({
  hint,
  children,
  className,
}: {
  hint: string
  children: React.ReactNode
  className?: string
}) {
  const [hovered, setHovered] = useState(false)
  const sounds = useDeckSounds()

  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => {
        setHovered(true)
        sounds.hoverTick()
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div
          role="tooltip"
          className={cn(
            // 6px offset (mt-1.5), and the hairline is a top border on the
            // label itself — one rule, no frame, no fill.
            'pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap',
            'border-t border-hairline-strong pt-1',
            'font-mono text-mono-tag uppercase tracking-mono-tag text-cream-200',
          )}
          style={{ animation: 'drawer-enter 120ms ease-out both' }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}
