import { ManaSymbol } from '../ManaSymbol'
import type { ManaColor } from '../ManaSymbol'
import { FORMAT_LABELS } from '../../lib/deck-utils'
import type { DeckFormat } from '../../lib/deck-utils'
import { useT } from '../../lib/i18n'

interface DeckMetaProps {
  format: DeckFormat
  totalCards: number
  colors?: ManaColor[]
  tone?: 'normal' | 'overlay'
}

export function DeckMeta({ format, totalCards, colors, tone = 'normal' }: DeckMetaProps) {
  const t = useT()

  if (tone === 'overlay') {
    return (
      <div className="flex items-center gap-2 font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-200">
        <span className="text-ink-red-bright">{FORMAT_LABELS[format]}</span>
        <span className="h-px w-3 bg-hairline-strong" aria-hidden="true" />
        <span className="tabular-nums">{t('deck.cards', { count: totalCards })}</span>
        {colors && colors.length > 0 && (
          <>
            <span className="h-px w-3 bg-hairline-strong" aria-hidden="true" />
            <span className="flex items-center gap-1">
              {colors.map((c) => (
                <ManaSymbol key={c} color={c} size="sm" selected />
              ))}
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400">
      <span className="text-ink-red-bright">{FORMAT_LABELS[format]}</span>
      <span className="h-px w-4 bg-hairline" aria-hidden="true" />
      <span className="tabular-nums">{t('deck.cards', { count: totalCards })}</span>
      {colors && colors.length > 0 && (
        <>
          <span className="h-px w-4 bg-hairline" aria-hidden="true" />
          <span className="flex items-center gap-1">
            {colors.map((c) => (
              <ManaSymbol key={c} color={c} size="sm" selected />
            ))}
          </span>
        </>
      )}
    </div>
  )
}
