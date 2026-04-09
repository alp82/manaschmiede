import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface WizardNavProps {
  children: ReactNode
}

/** Fixed bottom navigation bar for wizard steps - portaled to body to escape transform ancestors */
export function WizardNav({ children }: WizardNavProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-surface-700 bg-surface-900/95 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        {children}
      </div>
    </div>,
    document.body,
  )
}
