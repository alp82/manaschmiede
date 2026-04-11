import * as React from 'react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

/**
 * Specimen Toast — notification primitive.
 *
 * Per the locked Specimen decision:
 *   - Default: bottom-left margin panel (hairline-framed, mono). Persists
 *     until dismissed by the user or replaced by a newer toast of the same
 *     level. `success` / `info` use this variant.
 *   - `error`: top-banner full-width ink-red hairline slab. Auto-dismisses
 *     after 4s.
 *
 * No sliders, no progress rings, no rounded chips. Sharp hairline frames,
 * mono labels. At most one toast of each variant is visible at a time —
 * replacing a message replaces the current one in place.
 */

export type ToastLevel = 'success' | 'info' | 'error'

interface ToastItem {
  id: number
  level: ToastLevel
  message: string
}

interface ToastContextValue {
  success: (message: string) => void
  info: (message: string) => void
  error: (message: string) => void
  dismiss: (id: number) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const ERROR_AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const idRef = React.useRef(0)

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = React.useCallback((level: ToastLevel, message: string) => {
    const id = ++idRef.current
    // Replace any existing toast of the same level.
    setToasts((prev) => [...prev.filter((t) => t.level !== level), { id, level, message }])
    if (level === 'error') {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, ERROR_AUTO_DISMISS_MS)
    }
  }, [])

  const value = React.useMemo<ToastContextValue>(
    () => ({
      success: (message) => push('success', message),
      info: (message) => push('info', message),
      error: (message) => push('error', message),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  const errorToast = toasts.find((t) => t.level === 'error')
  const marginToasts = toasts.filter((t) => t.level !== 'error')

  return createPortal(
    <>
      {/* Top error banner */}
      {errorToast && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-0 top-0 z-[80] border-b border-ink-red bg-ash-900/95 px-4 py-3"
          style={{ animation: 'card-enter 180ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
                Error &mdash;
              </span>
              <span className="font-body text-sm text-cream-100">{errorToast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(errorToast.id)}
              className={cn(
                'font-mono text-mono-tag uppercase tracking-mono-tag text-cream-300 transition-colors hover:text-cream-100',
                'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              )}
              aria-label="Dismiss"
            >
              {'\u00D7'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom-left margin panel stack */}
      {marginToasts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 z-[70] flex flex-col gap-2"
        >
          {marginToasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-baseline gap-3 border border-hairline-strong bg-ash-900/95 px-4 py-3"
              style={{ animation: 'card-enter 180ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
            >
              <span
                className={cn(
                  'font-mono text-mono-marginal uppercase tracking-mono-marginal',
                  toast.level === 'success' ? 'text-cream-200' : 'text-cream-400',
                )}
              >
                {toast.level === 'success' ? 'Done \u2014' : 'Note \u2014'}
              </span>
              <span className="font-body text-sm text-cream-100">{toast.message}</span>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className={cn(
                  'ml-2 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500 transition-colors hover:text-cream-100',
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
                )}
                aria-label="Dismiss"
              >
                {'\u00D7'}
              </button>
            </div>
          ))}
        </div>
      )}
    </>,
    document.body,
  )
}
