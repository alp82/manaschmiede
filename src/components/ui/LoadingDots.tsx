import { cn } from '../../lib/utils'

interface LoadingDotsProps {
  size?: 'sm' | 'md'
  tone?: 'bright' | 'muted'
  className?: string
}

/**
 * Specimen LoadingDots — three bouncing cream squares, the one allowed
 * `animate-bounce` loop (waiting signal). Sharp squares, never circles.
 *
 * sizes: sm = 6px, md = 8px
 * tones: bright = cream-100 (foreground loading), muted = cream-300 (ambient)
 */
export function LoadingDots({ size = 'md', tone = 'bright', className }: LoadingDotsProps) {
  const square = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
  const gap = size === 'sm' ? 'gap-1' : 'gap-1.5'
  const color = tone === 'bright' ? 'bg-cream-100' : 'bg-cream-300'

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex items-center', gap, className)}
    >
      <span className={cn(square, color, 'animate-bounce')} style={{ animationDelay: '0ms' }} />
      <span className={cn(square, color, 'animate-bounce')} style={{ animationDelay: '150ms' }} />
      <span className={cn(square, color, 'animate-bounce')} style={{ animationDelay: '300ms' }} />
    </span>
  )
}
