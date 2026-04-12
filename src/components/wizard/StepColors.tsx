import { useMemo } from 'react'
import { ManaSymbol, type ManaColor } from '../ManaSymbol'
import { useDeckSounds } from '../../lib/sounds'
import { WizardNav } from './WizardNav'
import { Pill } from '../ui/Pill'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import type { ManaColorState, WizardAction } from '../../lib/wizard-state'
import { getTraitById } from '../../lib/trait-mappings'

interface StepColorsProps {
  colors: Record<ManaColor, ManaColorState>
  selectedArchetypes: string[]
  selectedTraits: string[]
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
  onReset: () => void
}

const ALL_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
const COLOR_KEYS: Record<ManaColor, string> = {
  W: 'color.white',
  U: 'color.blue',
  B: 'color.black',
  R: 'color.red',
  G: 'color.green',
}

// Ambient mana-color tints used when a color is selected. Each tint
// uses the mana color's own hue so selection reads as "this color lives
// here now" rather than a generic red wash (which also collides with
// the red mana tile).
const COLOR_TINT_CLASS: Record<ManaColor, string> = {
  W: 'bg-mana-white/10 sm:bg-mana-white/15',
  U: 'bg-mana-blue/10 sm:bg-mana-blue/20',
  B: 'bg-mana-black/25 sm:bg-mana-black/40',
  R: 'bg-mana-red/10 sm:bg-mana-red/20',
  G: 'bg-mana-green/10 sm:bg-mana-green/20',
}

export function StepColors({
  colors,
  selectedArchetypes,
  selectedTraits,
  dispatch,
  onNext,
  onBack,
  onReset,
}: StepColorsProps) {
  const t = useT()
  const selectedColors = ALL_COLORS.filter((c) => colors[c] === 'selected')
  const maybeColors = ALL_COLORS.filter((c) => colors[c] === 'maybe')
  const hasAnyColor = selectedColors.length > 0 || maybeColors.length > 0
  const unselectedColors = ALL_COLORS.filter((c) => colors[c] !== 'selected')

  // Compute recommended colors from selected archetypes
  const recommendedColors = useMemo(() => {
    const colorCounts = new Map<string, number>()
    for (const id of [...selectedArchetypes, ...selectedTraits]) {
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
  }, [selectedArchetypes, selectedTraits])

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
    <section className="relative">
      {/* Reading-mode content column */}
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-16">
        {/* Section header */}
        <header className="flex flex-col items-center text-center">
          <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-400">
            Chapter II
          </span>
          <h2 className="mt-4 font-display text-display-title leading-[1.1] tracking-display text-cream-100">
            {t('colors.title')}
          </h2>
          <p className="mt-4 max-w-md font-body text-base text-cream-300">
            {t('colors.subtitle')}
          </p>
        </header>

        {/* Primary color selector — forced single row */}
        <div className="mt-20 flex items-start justify-between gap-1 sm:gap-4">
          {ALL_COLORS.map((color) => {
            const isSelected = colors[color] === 'selected'
            const isGoodFit = recommendedColors.has(color)
            return (
              <button
                key={color}
                type="button"
                onClick={() => toggleSelected(color)}
                className={cn(
                  'group relative flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-2 pb-3 pt-6 outline-none transition-colors duration-150 sm:gap-3 sm:pb-4 sm:pt-10',
                  isSelected && COLOR_TINT_CLASS[color],
                )}
              >
                <ManaSymbol
                  color={color}
                  size="lg"
                  selected={isSelected}
                  recommended={isGoodFit && !isSelected}
                />
                <span
                  className={cn(
                    'font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal transition-colors duration-150 sm:text-mono-label sm:tracking-mono-label',
                    isSelected
                      ? 'text-cream-100'
                      : isGoodFit
                        ? 'text-cream-400 group-hover:text-cream-200'
                        : 'text-cream-500 group-hover:text-cream-200',
                  )}
                >
                  {t(COLOR_KEYS[color])}
                </span>
                <span
                  className={cn(
                    'h-3 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500 transition-opacity duration-150',
                    isGoodFit ? 'opacity-60' : 'opacity-0',
                  )}
                >
                  {t('colors.recommended')}
                </span>
              </button>
            )
          })}
        </div>

        {/* Splash row — "Open to splashing?" */}
        {selectedColors.length > 0 && unselectedColors.length > 0 && (
          <div className="mt-16 flex flex-col items-center gap-4">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('colors.splashQuestion')}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {unselectedColors.map((color) => (
                <Pill
                  key={color}
                  size="md"
                  selected={colors[color] === 'maybe'}
                  onClick={() => toggleMaybe(color)}
                  className="px-4 py-2.5"
                >
                  <ManaSymbol color={color} size="sm" />
                  <span>{t('colors.maybe')}</span>
                </Pill>
              ))}
            </div>
          </div>
        )}

        {/* AI decide escape hatch */}
        <div className="mt-16 flex justify-center">
          <Button
            variant="secondary"
            size="md"
            className="whitespace-normal text-center"
            onClick={() => {
              dispatch({ type: 'CLEAR_COLORS' })
              onNext()
            }}
          >
            {t('colors.aiDecide')}
          </Button>
        </div>

      </div>

      <WizardNav>
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="lg" onClick={onBack}>
            {t('wizard.back')}
          </Button>
          <Button variant="primary" size="lg" onClick={onNext} disabled={!hasAnyColor}>
            {t('colors.nextCoreCards')}
          </Button>
        </div>
        <div className="flex items-center justify-center">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('wizard.reset')}
          </Button>
        </div>
      </WizardNav>
    </section>
  )
}
