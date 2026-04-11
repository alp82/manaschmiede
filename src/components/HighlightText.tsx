interface HighlightTextProps {
  text: string
  term: string
}

/** Highlights matches of `term` within `text`. Specimen treatment: faint
 *  ink-red background tint with cream text, no rounding, no bold. */
export function HighlightText({ text, term }: HighlightTextProps) {
  if (!term || term.length < 1) return <>{text}</>

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)

  if (parts.length === 1) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="bg-ink-red/30 px-0.5 text-cream-100">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
