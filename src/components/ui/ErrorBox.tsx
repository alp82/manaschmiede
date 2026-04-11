import { cn } from '../../lib/utils'
import { Button } from './Button'

interface ErrorBoxProps {
  title?: string
  message: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Specimen ErrorBox — ink-red hairline frame, mono eyebrow title,
 * Geist body error message, optional "TRY AGAIN" destructive Button.
 *
 * Used for section-level errors (combo generation, section fill, etc.)
 * that aren't severe enough to warrant a top-banner toast.
 */
export function ErrorBox({
  title = 'ERROR',
  message,
  onRetry,
  retryLabel = 'TRY AGAIN',
  className,
}: ErrorBoxProps) {
  return (
    <div className={cn('border border-ink-red bg-ash-800/40 p-4', className)}>
      <p className="font-display text-display-eyebrow uppercase tracking-eyebrow text-ink-red">
        {title}
      </p>
      <p className="mt-2 font-body text-sm text-cream-200">{message}</p>
      {onRetry && (
        <div className="mt-3">
          <Button variant="destructive" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
