import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface WizardNavProps {
  children: ReactNode
}

/** Fixed-bottom wizard nav — portaled to body so transform ancestors don't
 *  trap it. Specimen treatment: thin hairline top border, ash-900
 *  translucent background, no backdrop blur. */
export function WizardNav({ children }: WizardNavProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-hairline bg-ash-900/95 px-4 py-3 sm:py-4 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {children}
      </div>
    </div>,
    document.body,
  )
}
