import { useEffect } from 'react'

/**
 * PROTOTYPE — throwaway. Floating variant switcher for UI prototypes.
 * Deliberately NOT Specimen (rounded, shadowed) so it reads as scaffolding,
 * not as part of the design under review. Hidden in production builds.
 */
export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: Array<{ key: string; name: string }>
  current: string
  onChange: (key: string) => void
}) {
  const idx = Math.max(0, variants.findIndex((v) => v.key === current))
  const prev = () => onChange(variants[(idx - 1 + variants.length) % variants.length].key)
  const next = () => onChange(variants[(idx + 1) % variants.length].key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (import.meta.env.PROD) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-cream-100 px-4 py-2 font-mono text-sm text-ash-900 shadow-lg">
      <button type="button" className="cursor-pointer px-2" onClick={prev} aria-label="Previous variant">
        ←
      </button>
      <span>
        {variants[idx]?.key} — {variants[idx]?.name}
      </span>
      <button type="button" className="cursor-pointer px-2" onClick={next} aria-label="Next variant">
        →
      </button>
    </div>
  )
}
