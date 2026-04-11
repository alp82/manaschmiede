import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import { buttonLikeBase, buttonLikeVariants, buttonLikeSizes } from './button-styles'

/**
 * Specimen Pill — toggleable value / filter / chip / tag / badge.
 *
 * Variants:
 *   default — hairline secondary look; inverts to cream fill + ash label +
 *             ink-red border when selected
 *   ghost   — link-style; turns ink-red when selected
 *
 * State:
 *   selected — toggles the inverted / active look. Pills without a selected
 *              state (e.g. static badges) simply omit this prop.
 *
 * Optional:
 *   indexLabel — tiny letter in the top-left (a, b, c…) — turns a wall of
 *                pills into a cataloged specimen
 *
 * For action buttons (Next, Back, Save, Delete, Skip), use <Button> instead.
 */

const pillVariants = cva(buttonLikeBase, {
  variants: {
    variant: {
      default: cn(
        buttonLikeVariants.secondary,
        'data-[selected=true]:bg-cream-100 data-[selected=true]:text-ash-900 data-[selected=true]:border-ink-red',
      ),
      ghost: cn(
        buttonLikeVariants.ghost,
        'data-[selected=true]:text-ink-red',
      ),
    },
    size: buttonLikeSizes,
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
})

export interface PillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillVariants> {
  selected?: boolean
  indexLabel?: string
}

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  (
    {
      variant,
      size,
      selected,
      indexLabel,
      type = 'button',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        data-selected={selected ? 'true' : undefined}
        aria-pressed={typeof selected === 'boolean' ? selected : undefined}
        className={cn(pillVariants({ variant, size }), className)}
        {...props}
      >
        {indexLabel ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1 top-0.5 font-mono text-mono-marginal leading-none tracking-mono-marginal text-cream-400"
          >
            {indexLabel}
          </span>
        ) : null}
        {children}
      </button>
    )
  },
)
Pill.displayName = 'Pill'
