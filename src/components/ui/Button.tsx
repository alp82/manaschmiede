import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import { buttonLikeBase, buttonLikeVariants, buttonLikeSizes } from './button-styles'

/**
 * Specimen Button — the action trigger.
 *
 * Variants:
 *   primary     — ink-red fill, cream label — main CTAs (Next, Save, Forge)
 *   secondary   — hairline, cream label — Back, Cancel
 *   destructive — ink-red border + label, inverts on hover — Delete, Discard
 *   ghost       — no border, cream label, ink-red underline on hover — Skip, tertiary
 *
 * For toggleable filters / tags / chips / badges, use <Pill> instead.
 */

const buttonVariants = cva(buttonLikeBase, {
  variants: {
    variant: buttonLikeVariants,
    size: buttonLikeSizes,
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
})

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, type = 'button', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
