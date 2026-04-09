import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../lib/i18n'
import type { WizardState } from '../../lib/wizard-state'
import type { ManaColor } from '../ManaSymbol'
import type { ManaColorState } from '../../lib/wizard-state'

const STEPS = [
  { num: 1, key: 'wizard.strategy' },
  { num: 2, key: 'wizard.colors' },
  { num: 3, key: 'wizard.coreCards' },
  { num: 4, key: 'wizard.buildDeck' },
] as const

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3 | 4
  maxStepReached: 1 | 2 | 3 | 4
  onStepClick: (step: 1 | 2 | 3 | 4) => void
  wizardState: WizardState
}

const MANA_SYMBOL_URL: Record<ManaColor, string> = {
  W: 'https://svgs.scryfall.io/card-symbols/W.svg',
  U: 'https://svgs.scryfall.io/card-symbols/U.svg',
  B: 'https://svgs.scryfall.io/card-symbols/B.svg',
  R: 'https://svgs.scryfall.io/card-symbols/R.svg',
  G: 'https://svgs.scryfall.io/card-symbols/G.svg',
}

function useStepSummary(stepNum: number, state: WizardState): React.ReactNode[] | null {
  const t = useT()

  if (stepNum === 1) {
    const items: React.ReactNode[] = []
    if (state.selectedArchetypes.length > 0) {
      items.push(
        <span key="arch" className="flex flex-wrap gap-1">
          {state.selectedArchetypes.map((id) => (
            <span key={id} className="rounded bg-accent/20 px-1.5 py-0.5 text-accent">{t(`trait.${id}`)}</span>
          ))}
        </span>,
      )
    }
    if (state.selectedTraits.length > 0) {
      items.push(
        <span key="traits" className="flex flex-wrap gap-1">
          {state.selectedTraits.map((id) => (
            <span key={id} className="rounded bg-surface-600 px-1.5 py-0.5 text-surface-300">{t(`trait.${id}`)}</span>
          ))}
        </span>,
      )
    }
    if (state.format !== 'casual') {
      items.push(<span key="fmt" className="text-surface-400">{state.format}</span>)
    }
    return items.length > 0 ? items : null
  }

  if (stepNum === 2) {
    const entries = Object.entries(state.colors) as [ManaColor, ManaColorState][]
    const selected = entries.filter(([, s]) => s === 'selected').map(([c]) => c)
    const maybe = entries.filter(([, s]) => s === 'maybe').map(([c]) => c)
    if (selected.length === 0 && maybe.length === 0) return null
    const items: React.ReactNode[] = []
    if (selected.length > 0) {
      items.push(
        <span key="sel" className="flex items-center gap-1">
          {selected.map((c) => <img key={c} src={MANA_SYMBOL_URL[c]} alt={c} className="h-4 w-4" />)}
        </span>,
      )
    }
    if (maybe.length > 0) {
      items.push(
        <span key="maybe" className="flex items-center gap-1 opacity-50">
          {maybe.map((c) => <img key={c} src={MANA_SYMBOL_URL[c]} alt={c} className="h-4 w-4" />)}
          <span className="text-surface-500">?</span>
        </span>,
      )
    }
    return items
  }

  if (stepNum === 3) {
    if (state.selectedComboIndex == null || !state.coreCombos[state.selectedComboIndex]) return null
    const combo = state.coreCombos[state.selectedComboIndex]
    return [<span key="combo" className="text-surface-200">{combo.name}</span>]
  }

  return null
}

export function StepIndicator({ currentStep, maxStepReached, onStepClick, wizardState }: StepIndicatorProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {STEPS.map(({ num, key }, i) => {
        const isActive = num === currentStep
        const isReachable = num <= maxStepReached
        const isCompleted = num < currentStep

        return (
          <div key={num} className="flex items-center gap-1 sm:gap-2">
            <StepButton
              num={num}
              label={t(key)}
              isActive={isActive}
              isReachable={isReachable}
              isCompleted={isCompleted}
              wizardState={wizardState}
              onClick={() => {
                if (isReachable && !isActive) onStepClick(num as 1 | 2 | 3 | 4)
              }}
            />
            {i < STEPS.length - 1 && (
              <div className={`h-px w-3 sm:w-6 ${num < maxStepReached ? 'bg-accent/50' : 'bg-surface-700'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepButton({ num, label, isActive, isReachable, isCompleted, wizardState, onClick }: {
  num: number
  label: string
  isActive: boolean
  isReachable: boolean
  isCompleted: boolean
  wizardState: WizardState
  onClick: () => void
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const summary = useStepSummary(num, wizardState)
  const hasTooltip = isCompleted && summary !== null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        disabled={!isReachable}
        onMouseEnter={() => hasTooltip && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-all sm:gap-2 sm:px-3 sm:text-sm ${
          isActive
            ? 'bg-accent text-white'
            : isReachable
              ? 'bg-accent/20 text-accent hover:bg-accent/30 cursor-pointer'
              : 'bg-surface-700/50 text-surface-500 cursor-default'
        }`}
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
          isCompleted ? 'bg-accent text-white' : isActive ? 'bg-white/20 text-white' : isReachable ? 'bg-accent/30 text-accent' : 'bg-surface-600 text-surface-400'
        }`}>
          {isCompleted ? '\u2713' : num}
        </span>
        <span className="hidden sm:inline">{label}</span>
      </button>

      {showTooltip && hasTooltip && buttonRef.current && createPortal(
        <StepTooltip anchorEl={buttonRef.current} summary={summary!} />,
        document.body,
      )}
    </>
  )
}

function StepTooltip({ anchorEl, summary }: { anchorEl: HTMLElement; summary: React.ReactNode[] }) {
  const rect = anchorEl.getBoundingClientRect()
  const left = rect.left + rect.width / 2
  const top = rect.bottom + 8

  return (
    <div
      className="pointer-events-none fixed z-50 flex flex-col gap-1.5 rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-xs shadow-xl"
      style={{
        left,
        top,
        transform: 'translateX(-50%)',
        animation: 'card-enter 120ms cubic-bezier(0.16, 1, 0.3, 1) both',
        maxWidth: 240,
      }}
    >
      {summary}
    </div>
  )
}
