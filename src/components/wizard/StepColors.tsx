import { useMemo } from 'react'
import { ManaSymbol, type ManaColor } from '../ManaSymbol'
import { useDeckSounds } from '../../lib/sounds'
import { WizardNav } from './WizardNav'
import { useT } from '../../lib/i18n'
import type { ManaColorState, WizardAction } from '../../lib/wizard-state'
import type { DeckFormat } from '../../lib/deck-utils'
import { getTraitById } from '../../lib/trait-mappings'

interface StepColorsProps {
  colors: Record<ManaColor, ManaColorState>
  format: DeckFormat
  selectedArchetypes: string[]
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
}

const ALL_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
const COLOR_KEYS: Record<ManaColor, string> = {
  W: 'color.white',
  U: 'color.blue',
  B: 'color.black',
  R: 'color.red',
  G: 'color.green',
}

const FORMATS: { value: DeckFormat; key: string }[] = [
  { value: 'casual', key: 'colors.formatCasual' },
  { value: 'modern', key: 'colors.formatModern' },
  { value: 'standard', key: 'colors.formatStandard' },
]

export function StepColors({ colors, format, selectedArchetypes, dispatch, onNext, onBack }: StepColorsProps) {
  const t = useT()
  const selectedColors = ALL_COLORS.filter((c) => colors[c] === 'selected')
  const maybeColors = ALL_COLORS.filter((c) => colors[c] === 'maybe')
  const hasAnyColor = selectedColors.length > 0 || maybeColors.length > 0
  const unselectedColors = ALL_COLORS.filter((c) => colors[c] !== 'selected')

  // Compute recommended colors from selected archetypes
  const recommendedColors = useMemo(() => {
    const colorCounts = new Map<string, number>()
    for (const id of selectedArchetypes) {
      const trait = getTraitById(id)
      if (trait?.colorAffinity) {
        for (const c of trait.colorAffinity) {
          colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1)
        }
      }
    }
    return new Set(
      [...colorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c),
    )
  }, [selectedArchetypes])

  const sounds = useDeckSounds()

  function toggleSelected(color: ManaColor) {
    const current = colors[color]
    if (current === 'selected') {
      dispatch({ type: 'SET_COLOR', color, state: 'unselected' })
    } else {
      dispatch({ type: 'SET_COLOR', color, state: 'selected' })
    }
    sounds.uiClick()
  }

  function toggleMaybe(color: ManaColor) {
    const current = colors[color]
    if (current === 'maybe') {
      dispatch({ type: 'SET_COLOR', color, state: 'unselected' })
    } else {
      dispatch({ type: 'SET_COLOR', color, state: 'maybe' })
    }
    sounds.uiClick()
  }

  return (
    <div className="flex flex-col items-center gap-8 py-8 pb-20">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-surface-100">{t('colors.title')}</h2>
        <p className="mt-2 text-sm text-surface-400">
          {t('colors.subtitle')}
        </p>
      </div>

      {/* Main color selection */}
      <div className="flex items-center gap-5">
        {ALL_COLORS.map((color) => {
          const isSelected = colors[color] === 'selected'
          const isRecommended = recommendedColors.has(color) && !isSelected
          return (
            <button
              key={color}
              type="button"
              onClick={() => toggleSelected(color)}
              className="group flex flex-col items-center gap-2"
            >
              <ManaSymbol
                color={color}
                size="lg"
                selected={isSelected}
                recommended={isRecommended}
              />
              <span className={`text-xs ${isSelected ? 'text-surface-100 font-medium' : isRecommended ? 'text-surface-200 font-medium' : 'text-surface-500'}`}>
                {t(COLOR_KEYS[color])}
              </span>
              <span className={`h-3 text-[10px] text-surface-400 transition-opacity duration-150 ${isRecommended ? 'opacity-100' : 'opacity-0'}`}>
                {t('colors.recommended')}
              </span>
            </button>
          )
        })}
      </div>

      {/* "Open to splashing?" - only show when 1+ colors are selected */}
      {selectedColors.length > 0 && unselectedColors.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          <span className="text-xs text-surface-500">{t('colors.splashQuestion')}</span>
          <div className="flex items-center gap-3">
            {unselectedColors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => toggleMaybe(color)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all ${
                  colors[color] === 'maybe'
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-surface-600 text-surface-400 hover:border-surface-500 hover:text-surface-200'
                }`}
              >
                <ManaSymbol color={color} size="sm" selected={colors[color] === 'maybe'} />
                <span>{t('colors.maybe')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Not sure button */}
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'CLEAR_COLORS' })
          onNext()
        }}
        className="text-sm text-surface-400 hover:text-surface-200 underline underline-offset-4"
      >
        {t('colors.aiDecide')}
      </button>

      {/* Format toggle */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs text-surface-500">{t('colors.format')}</span>
        <div className="flex rounded-lg border border-surface-600 p-0.5">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => dispatch({ type: 'SET_FORMAT', format: f.value })}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                format === f.value
                  ? 'bg-accent text-white'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-surface-500">
          {format === 'casual' && t('colors.descCasual')}
          {format === 'modern' && t('colors.descModern')}
          {format === 'standard' && t('colors.descStandard')}
        </p>
      </div>

      <WizardNav>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-surface-600 px-6 py-2.5 text-sm text-surface-300 hover:border-surface-500 hover:text-surface-100"
        >
          {t('wizard.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasAnyColor}
          className="rounded-lg bg-accent px-8 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {t('colors.nextCoreCards')}
        </button>
      </WizardNav>
    </div>
  )
}
