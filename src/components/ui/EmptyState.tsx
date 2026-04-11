import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/**
 * Specimen EmptyState — centered Cinzel display-section title over a
 * Geist body-small italic subtitle, with an optional caller-supplied
 * action (Button/Pill). No illustrations, no icons.
 *
 * The caller owns the action variant — this component does not hardcode
 * any CTA styling.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-center',
        className,
      )}
    >
      <p className="font-display text-display-section tracking-section text-cream-100">
        {title}
      </p>
      {description && (
        <p className="font-body text-sm italic text-cream-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
