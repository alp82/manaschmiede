import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/Button'
import { useDeckSounds } from '../lib/sounds'

/**
 * Specimen confirmation modal — a framed plate for destructive / ambiguous
 * decisions. Reuses the lightbox backdrop (ash-900/90, no blur, sharp
 * hairline frame) and the Button primitive for actions.
 *
 * Used for things like "you have a deck in progress — start over?" where
 * a plain browser confirm() would break tone, and a full custom layout
 * per-call would drift from Specimen.
 */
interface ConfirmModalProps {
  open: boolean
  title: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  confirmVariant?: 'primary' | 'destructive'
  showCancel?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'destructive',
  showCancel = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const sounds = useDeckSounds()

  const handleCancel = useCallback(() => {
    sounds.uiClick()
    onCancel()
  }, [onCancel, sounds])

  const handleConfirm = useCallback(() => {
    sounds.uiClick()
    onConfirm()
  }, [onConfirm, sounds])

  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement
    requestAnimationFrame(() => (cancelRef.current ?? confirmRef.current)?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel()
        return
      }
      if (e.key === 'Tab') {
        const focusable = Array.from(
          containerRef.current?.querySelectorAll('button') ?? [],
        ) as HTMLElement[]
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (prevFocusRef.current instanceof HTMLElement) prevFocusRef.current.focus()
    }
  }, [open, handleCancel])

  if (!open) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleCancel()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ash-900/90 px-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-body"
    >
      <div
        ref={containerRef}
        className="w-full max-w-[520px] border border-hairline-strong bg-ash-900 p-6 sm:p-8"
        style={{ animation: 'card-enter 180ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
      >
        <h2
          id="confirm-modal-title"
          className="font-display text-display-eyebrow uppercase leading-tight tracking-display text-cream-100 sm:text-display-section"
        >
          {title}
        </h2>

        <div id="confirm-modal-body" className="mt-4 font-body text-sm leading-relaxed text-cream-300">{body}</div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {showCancel && (
            <Button ref={cancelRef} variant="secondary" size="md" onClick={handleCancel}>
              {cancelLabel}
            </Button>
          )}
          <Button ref={confirmRef} variant={confirmVariant} size="md" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
