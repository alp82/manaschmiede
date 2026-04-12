import { useState, Fragment } from 'react'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import type { WizardState } from '../../lib/wizard-state'
import type { ManaColor } from '../ManaSymbol'
import type { ManaColorState } from '../../lib/wizard-state'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getCardImageUri, getCardName } from '../../lib/scryfall/types'
import { ARCHETYPE_ART } from './StepTraits'

/**
 * Specimen Stepper.
 *
 * Horizontal hairline across the top. Cinzel Roman numerals above,
 * JetBrains Mono labels below. Current step: ink-red numeral, cream label,
 * short vertical slab descending from the hairline. Completed: cream-300,
 * hairline solid. Future: cream-500, hairline dotted.
 *
 * No pills, no circles, no blue, no icons. Click completed steps to navigate
 * back; future steps are inert.
 */

const STEPS = [
  { num: 1, key: 'wizard.strategy', roman: 'I' },
  { num: 2, key: 'wizard.colors', roman: 'II' },
  { num: 3, key: 'wizard.coreCards', roman: 'III' },
  { num: 4, key: 'wizard.buildDeck', roman: 'IV' },
] as const

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3 | 4
  maxStepReached: 1 | 2 | 3 | 4
  onStepClick: (step: 1 | 2 | 3 | 4) => void
  onNext?: () => void
  wizardState: WizardState
  /** Called when the user clicks the seed card anchor — route opens the seed lightbox. */
  onOpenSeed?: () => void
}

const MANA_SYMBOL_URL: Record<ManaColor, string> = {
  W: 'https://svgs.scryfall.io/card-symbols/W.svg',
  U: 'https://svgs.scryfall.io/card-symbols/U.svg',
  B: 'https://svgs.scryfall.io/card-symbols/B.svg',
  R: 'https://svgs.scryfall.io/card-symbols/R.svg',
  G: 'https://svgs.scryfall.io/card-symbols/G.svg',
}

function useStepSummary(stepNum: number, state: WizardState): React.ReactNode | null {
  const t = useT()

  if (stepNum === 1) {
    const hasArchetypes = state.selectedArchetypes.length > 0
    const hasTraits = state.selectedTraits.length > 0
    if (!hasArchetypes && !hasTraits) return null

    return (
      <>
        {/* Mini archetype plates — small versions of the strategy cards
            (art bg, title dominantly on top, no description). */}
        {hasArchetypes && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {state.selectedArchetypes.map((id) => {
              const art = ARCHETYPE_ART[id]
              return (
                <div
                  key={id}
                  className="relative h-14 w-24 overflow-hidden border border-hairline-strong"
                >
                  {art && (
                    <img
                      src={art}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover brightness-[0.55]"
                    />
                  )}
                  {/* Uniform scrim so the centered title is readable against
                      any part of the art — a gradient would only darken one
                      edge of the mini-card. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-ash-900/70"
                  />
                  <span className="absolute inset-0 flex items-center justify-center px-1 text-center font-display text-xs font-bold uppercase leading-none tracking-display text-cream-100">
                    {t(`trait.${id}`)}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Trait tags — mono-tag, wrapped under the cards if present */}
        {hasTraits && (
          <div className="flex flex-wrap justify-center gap-1">
            {state.selectedTraits.map((id) => (
              <span
                key={id}
                className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400"
              >
                {t(`trait.${id}`)}
              </span>
            ))}
          </div>
        )}

        {/* Format marginalia (only if non-default) */}
        {state.format !== 'casual' && (
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
            {state.format}
          </span>
        )}
      </>
    )
  }

  if (stepNum === 2) {
    const entries = Object.entries(state.colors) as [ManaColor, ManaColorState][]
    const selected = entries.filter(([, s]) => s === 'selected').map(([c]) => c)
    const maybe = entries.filter(([, s]) => s === 'maybe').map(([c]) => c)
    if (selected.length === 0 && maybe.length === 0) return null

    return (
      <>
        {/* Large color icons — much bigger than the inline tag version */}
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {selected.map((c) => (
              <img key={c} src={MANA_SYMBOL_URL[c]} alt={c} className="h-12 w-12" />
            ))}
          </div>
        )}
        {maybe.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 opacity-60">
            <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
              maybe
            </span>
            {maybe.map((c) => (
              <img key={c} src={MANA_SYMBOL_URL[c]} alt={c} className="h-7 w-7" />
            ))}
          </div>
        )}
      </>
    )
  }

  if (stepNum === 3) {
    if (state.selectedComboIndex == null || !state.coreCombos[state.selectedComboIndex]) return null
    const combo = state.coreCombos[state.selectedComboIndex]
    return (
      <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-100">
        {combo.name}
      </span>
    )
  }

  return null
}

export function StepIndicator({ currentStep, maxStepReached, onStepClick, onNext, wizardState, onOpenSeed }: StepIndicatorProps) {
  const t = useT()
  const seed = wizardState.seedCard

  return (
    <div className="flex w-full max-w-3xl items-start">
      {seed && <SeedAnchor seed={seed} onOpen={onOpenSeed} />}
      {STEPS.map(({ num, key, roman }, i) => {
        const isActive = num === currentStep
        const isReachable = num <= maxStepReached
        const isNextStep = num === currentStep + 1
        const isClickable = (isReachable && !isActive) || (isNextStep && !!onNext)
        const isCompleted = num < currentStep
        const hasNext = i < STEPS.length - 1
        const connectorReached = num < currentStep

        return (
          <Fragment key={num}>
            <StepMarker
              num={num}
              roman={roman}
              label={t(key)}
              isActive={isActive}
              isCompleted={isCompleted}
              isReachable={isReachable || isNextStep}
              wizardState={wizardState}
              onClick={() => {
                if (!isClickable) return
                if (isNextStep && onNext) {
                  onNext()
                } else {
                  onStepClick(num as 1 | 2 | 3 | 4)
                }
              }}
            />
            {hasNext && (
              <div
                aria-hidden="true"
                className={cn(
                  // Connector rule sits at y=52 — aligns with the bottom
                  // of the 40px numeral row inside the button's py-3
                  // top padding (12 + 40 = 52), so the hairline sits in
                  // the gap between numerals and labels.
                  'mt-[52px] h-0 flex-1 min-w-4',
                  connectorReached
                    ? 'border-t border-solid border-cream-200'
                    : 'border-t border-dotted border-cream-500/70',
                )}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function StepMarker({
  num,
  roman,
  label,
  isActive,
  isCompleted,
  isReachable,
  wizardState,
  onClick,
}: {
  num: number
  roman: string
  label: string
  isActive: boolean
  isCompleted: boolean
  isReachable: boolean
  wizardState: WizardState
  onClick: () => void
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const summary = useStepSummary(num, wizardState)
  const hasTooltip = isCompleted && summary !== null

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={!isReachable || isActive}
        onMouseEnter={() => hasTooltip && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          'group relative flex shrink-0 flex-col items-center gap-2 px-2.5 py-3 mx-2.5 sm:px-3 sm:mx-3',
          'focus:outline-none focus-visible:outline-none',
          'transition-colors duration-150',
          'disabled:cursor-default',
          isReachable && !isActive && 'cursor-pointer hover:bg-ash-800',
          // Active state — subtle ash-800 wash + ink-red accents (numeral,
          // signature slab below label). No bg fill; the red marks carry
          // the "current step" signal per the original Specimen spec:
          // "ink-red numeral, cream label, short vertical slab".
          isActive && 'bg-ash-800/60',
        )}
      >
        {/* Roman numeral — uniformly large across all states. No size
            change on selection; only the color shifts. Active step is
            ink-red; completed/future use cream hierarchy. */}
        <div className="flex h-[40px] items-center justify-center">
          <span
            className={cn(
              'font-display font-bold leading-none tracking-display text-[2rem] transition-colors duration-150',
              isActive && 'text-ink-red-bright',
              isCompleted && !isActive && 'text-cream-200 group-hover:text-cream-100',
              !isActive && !isCompleted && 'text-cream-500',
            )}
          >
            {roman}
          </span>
        </div>

        {/* Mono label */}
        <span
          className={cn(
            'hidden font-mono text-mono-label uppercase leading-none tracking-mono-label transition-colors duration-150 sm:inline',
            isActive && 'text-cream-100',
            isCompleted && !isActive && 'text-cream-200 group-hover:text-cream-100',
            !isActive && !isCompleted && 'text-cream-500',
          )}
        >
          {label}
        </span>

        {/* Signature slab — short ink-red mark below the label, centered.
            Only on the active step. The punctuation that says "you are
            here" without resorting to a full bg tint. */}
        {isActive && (
          <span
            aria-hidden="true"
            className="mt-1 h-[2px] w-6 bg-ink-red-bright"
          />
        )}

        {/* Tooltip — absolutely positioned inside the `relative` button
            so it auto-centers below the step without needing viewport
            math. Portaling and `getBoundingClientRect` produced
            off-center placement due to subtle ancestor layout quirks;
            CSS handles it correctly. */}
        {showTooltip && hasTooltip && (
          <StepTooltip summary={summary} />
        )}
      </button>
    </>
  )
}

function StepTooltip({ summary }: { summary: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 flex min-w-[240px] max-w-[340px] -translate-x-1/2 flex-col items-center gap-3 border border-hairline-strong bg-ash-800 px-4 py-3"
      style={{
        animation: 'card-enter 120ms cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
    >
      {summary}
    </div>
  )
}

/**
 * Seed-card anchor that precedes the step markers when the wizard was
 * launched from a "forge deck with this card" action. Not a step — it's
 * a persistent reminder of the thesis card threading through all four
 * steps. Clicking the thumbnail opens the seed lightbox (hosted by the
 * route), which explains the card's role and offers a Remove action.
 *
 * Sized to roughly match the numeral+label stack of a step marker
 * (~72px tall inside py-3 padding) so the row reads as visually even.
 */
function SeedAnchor({
  seed,
  onOpen,
}: {
  seed: ScryfallCard
  onOpen?: () => void
}) {
  const imageUri = getCardImageUri(seed, 'small') ?? getCardImageUri(seed, 'normal')
  const name = getCardName(seed)
  return (
    <div className="mr-3 flex shrink-0 items-center py-3 sm:mr-4">
      <button
        type="button"
        onClick={onOpen}
        aria-label={name}
        title={name}
        className="h-[72px] w-[52px] shrink-0 cursor-pointer overflow-hidden border border-hairline-strong bg-ash-800 transition-colors hover:border-ink-red focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900"
      >
        {imageUri && (
          <img
            src={imageUri}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </button>
    </div>
  )
}
