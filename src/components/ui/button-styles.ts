/**
 * Specimen button-like shared styles.
 *
 * <Button> (action trigger) and <Pill> (toggleable value) share identical
 * visual language — the only thing that differs is semantics and state.
 * These constants are the single source of truth so the two components
 * can't drift.
 *
 * If you need to adjust Specimen button visuals, edit here — both consumers
 * pick it up automatically.
 */

export const buttonLikeBase =
  'relative inline-flex items-center justify-center ' +
  'font-mono uppercase whitespace-nowrap ' +
  'border transition-colors duration-150 ease-out ' +
  'cursor-pointer select-none rounded-none ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none'

export const buttonLikeVariants = {
  primary:
    'bg-ink-red text-cream-100 border-ink-red ' +
    'hover:bg-ink-red-bright hover:border-ink-red-bright',
  secondary:
    'bg-transparent text-cream-100 border-hairline ' +
    'hover:border-hairline-strong',
  destructive:
    'bg-transparent text-ink-red border-ink-red ' +
    'hover:bg-ink-red hover:text-cream-100',
  ghost:
    'bg-transparent text-cream-300 border-transparent ' +
    // Pre-set the underline decoration color/thickness so it doesn't
    // paint cream-300 for a frame before transitioning to ink-red
    // when `underline` toggles on hover. The `underline` class itself
    // still only applies on hover.
    'underline-offset-4 decoration-ink-red decoration-2 ' +
    'hover:text-cream-100 hover:underline',
} as const

export const buttonLikeSizes = {
  sm: 'px-2.5 py-1 text-mono-tag tracking-mono-tag gap-1',
  md: 'px-4 py-2 text-mono-label tracking-mono-label gap-1.5',
  lg: 'px-6 py-3 text-mono-label tracking-mono-label gap-2',
} as const
