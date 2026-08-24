import { useState } from 'react'
import { cn } from '../../lib/utils'

/**
 * Specimen hover tooltip — hairline-framed, tiny mono-tag label, no box beyond
 * the frame, no shadow, no rounding.
 *
 * Wraps whatever it is given and shows `hint` below it on hover. Used by the
 * color-mode switch in `FilterBar` and by the stats filter's LINKED yoke.
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
  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap',
            'border border-hairline-strong bg-ash-900 px-2 py-1',
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
