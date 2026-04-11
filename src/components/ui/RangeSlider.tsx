import { Slider } from '@base-ui/react/slider'
import { cn } from '../../lib/utils'

interface RangeSliderProps {
  min: number
  max: number
  step?: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  /** Optional formatter for the thumb aria-labels. */
  formatValue?: (value: number) => string
  className?: string
  disabled?: boolean
}

/**
 * Specimen RangeSlider — double-handle horizontal range input.
 *
 * Built on base-ui's Slider primitive so keyboard a11y and touch behavior
 * come for free; the visual treatment is fully custom specimen:
 *
 * - Track: 4px ash-800 rail bounded by hairlines, sharp corners
 * - Indicator (filled portion between the two thumbs): cream-200
 * - Thumbs: 14×14 cream-100 squares with 1px ash-900 inner border
 *   (so they read as "plates" on top of the rail), ink-red on hover/drag
 *
 * Use for any dual-bound numeric range — budget, price, year, etc.
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  formatValue,
  className,
  disabled,
}: RangeSliderProps) {
  return (
    <Slider.Root
      value={value}
      onValueChange={(next) => {
        if (Array.isArray(next) && next.length === 2) {
          onChange([next[0], next[1]])
        }
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn('relative w-full', className)}
    >
      <Slider.Control className="flex h-6 w-full cursor-pointer items-center">
        <Slider.Track className="relative h-1 w-full bg-ash-800">
          <Slider.Indicator className="absolute h-full bg-cream-200 transition-colors data-[dragging]:bg-ink-red-bright" />
          <Slider.Thumb
            aria-label={formatValue ? `Minimum: ${formatValue(value[0])}` : 'Minimum'}
            className={cn(
              'relative z-10 block size-4 -translate-y-1/2 cursor-grab border border-ash-900 bg-cream-100',
              'transition-colors',
              'hover:bg-ink-red-bright',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              'data-[dragging]:cursor-grabbing data-[dragging]:bg-ink-red-bright',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          />
          <Slider.Thumb
            aria-label={formatValue ? `Maximum: ${formatValue(value[1])}` : 'Maximum'}
            className={cn(
              'relative z-10 block size-4 -translate-y-1/2 cursor-grab border border-ash-900 bg-cream-100',
              'transition-colors',
              'hover:bg-ink-red-bright',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              'data-[dragging]:cursor-grabbing data-[dragging]:bg-ink-red-bright',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  )
}
