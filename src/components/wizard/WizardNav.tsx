import type { ReactNode } from 'react'

interface WizardNavProps {
  children: ReactNode
}

/** Fixed bottom navigation bar for wizard steps */
export function WizardNav({ children }: WizardNavProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-surface-700 bg-surface-900/95 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        {children}
      </div>
    </div>
  )
}
