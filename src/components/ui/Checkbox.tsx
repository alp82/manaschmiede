import { cn } from '../../lib/utils'

interface CheckboxProps {
  checked: boolean
  className?: string
}

/**
 * Specimen checkbox — visual-only selection mark.
 *
 * Empty state: hairline-bordered square with subtle ash fill — a clear
 * "you can select this" affordance.
 * Checked state: cream-100 fill with ash-900 ✓ glyph. The check mark
 * reads as "this is selected"; an X with an ink-red fill read as a
 * close/delete button in user testing, so this primitive uses ✓ despite
 * the older "X glyph" preference.
 *
 * Non-interactive on its own; drop it inside a clickable parent (card,
 * button, row) and the parent owns the click.
 */
export function Checkbox({ checked, className }: CheckboxProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center border transition-colors',
        checked
          ? 'border-cream-100 bg-cream-100'
          : 'border-hairline-strong bg-ash-900/60',
        className,
      )}
    >
      {checked && (
        <span className="font-mono text-lg font-bold leading-none text-ash-900">
          {'\u2713'}
        </span>
      )}
    </span>
  )
}
