import { Fragment } from 'react'
import { HighlightText } from './HighlightText'

interface OracleTextProps {
  text: string
  term?: string
}

const SYMBOL_REGEX = /\{([^}]+)\}/g

/**
 * Renders Magic oracle/rules text with inline mana symbols.
 *
 * Parses `{W}`, `{2}`, `{W/B}`, `{T}` etc. into Scryfall SVG icons and
 * runs the remaining text through `HighlightText` so search matches still
 * highlight. Mirrors the parser used in `ManaCost` but walks arbitrary
 * prose instead of a cost string.
 */
export function OracleText({ text, term = '' }: OracleTextProps) {
  if (!text) return null

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  SYMBOL_REGEX.lastIndex = 0

  while ((match = SYMBOL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      nodes.push(
        <Fragment key={`t-${lastIndex}`}>
          <HighlightText text={chunk} term={term} />
        </Fragment>,
      )
    }

    const code = match[1]
    const urlCode = code.replace('/', '%2F')
    nodes.push(
      <img
        key={`s-${match.index}`}
        src={`https://svgs.scryfall.io/card-symbols/${urlCode}.svg`}
        alt={`{${code}}`}
        className="inline-block h-[1em] w-[1em] align-[-0.15em]"
        draggable={false}
      />,
    )

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex)
    nodes.push(
      <Fragment key={`t-${lastIndex}`}>
        <HighlightText text={chunk} term={term} />
      </Fragment>,
    )
  }

  return <>{nodes}</>
}
