import { useT } from '../../lib/i18n'

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
}

export function StepIndicator({ currentStep, maxStepReached, onStepClick }: StepIndicatorProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {STEPS.map(({ num, key }, i) => {
        const isActive = num === currentStep
        const isReachable = num <= maxStepReached
        const isCompleted = num < currentStep

        return (
          <div key={num} className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                if (isReachable && !isActive) onStepClick(num as 1 | 2 | 3 | 4)
              }}
              disabled={!isReachable}
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
              <span className="hidden sm:inline">{t(key)}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-3 sm:w-6 ${num < maxStepReached ? 'bg-accent/50' : 'bg-surface-700'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
