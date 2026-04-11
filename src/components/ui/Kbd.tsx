import * as React from 'react'
import { cn } from '../../lib/utils'

interface KbdProps {
  children: React.ReactNode
  className?: string
}

/**
 * Specimen keyboard shortcut hint.
 *
 * Small hairline-framed mono label for surfacing shortcuts in marginalia
 * positions (e.g. next to an undo button, or in a marginal rail under
 * a form field). Sharp corners, ash-800 fill, cream-200 text.
 *
 * Use ⌘ for macOS-primary shortcuts, Ctrl for cross-platform, or ⇧
 * for shift. Separate keys with `+` inside a single <Kbd> block.
 *
 *   <Kbd>⌘Z</Kbd>
 *   <Kbd>Ctrl+Shift+Z</Kbd>
 *   <Kbd>↵</Kbd>
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center border border-hairline-strong bg-ash-800',
        'px-1.5 py-0.5 font-mono text-mono-tag leading-none tracking-mono-tag',
        'text-cream-200',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
