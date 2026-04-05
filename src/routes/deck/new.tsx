import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useReducer, useCallback, useEffect } from 'react'
import { useQueryState, parseAsInteger } from 'nuqs'
import { Layout } from '../../components/Layout'
import { StepIndicator } from '../../components/wizard/StepIndicator'
import { StepColors } from '../../components/wizard/StepColors'
import { StepTraits } from '../../components/wizard/StepTraits'
import { StepCoreCards } from '../../components/wizard/StepCoreCards'
import { StepDeckFill } from '../../components/wizard/StepDeckFill'
import {
  wizardReducer,
  initialWizardState,
  persistWizardState,
  clearWizardState,
} from '../../lib/wizard-state'
import { useT } from '../../lib/i18n'

export const Route = createFileRoute('/deck/new')({
  component: NewDeckWizard,
})

function NewDeckWizard() {
  const t = useT()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState)

  // Sync step to URL via nuqs
  const [urlStep, setUrlStep] = useQueryState(
    'step',
    parseAsInteger.withDefault(1),
  )

  // On mount: if URL has a step, jump to it; otherwise set URL from stored state
  useEffect(() => {
    if (urlStep >= 1 && urlStep <= 4 && urlStep !== state.step) {
      dispatch({ type: 'GO_TO_STEP', step: urlStep as 1 | 2 | 3 | 4 })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist wizard state to localStorage on every change
  useEffect(() => {
    persistWizardState(state)
  }, [state])

  // Keep URL step in sync when state.step changes & scroll to top
  useEffect(() => {
    if (state.step !== urlStep) {
      setUrlStep(state.step)
    }
    window.scrollTo({ top: 0 })
  }, [state.step]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    dispatch({ type: 'NEXT_STEP' })
  }, [])

  const handleBack = useCallback(() => {
    dispatch({ type: 'PREV_STEP' })
  }, [])

  const handleFinish = useCallback(() => {
    const deckId = crypto.randomUUID()
    const deck = {
      id: deckId,
      name: state.deckName || 'New Deck',
      description: state.deckDescription || '',
      format: state.format,
      cards: state.deckCards,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const decks = JSON.parse(localStorage.getItem('manaschmiede-decks') || '[]')
    decks.push(deck)
    localStorage.setItem('manaschmiede-decks', JSON.stringify(decks))
    // Clean up wizard state
    clearWizardState()
    navigate({ to: '/deck/$id', params: { id: deckId } })
  }, [state, navigate])

  const handleStartOver = useCallback(() => {
    dispatch({ type: 'RESET' })
    setUrlStep(1)
  }, [setUrlStep])

  return (
    <Layout>
      <div className="space-y-6">
        {/* Step indicator + start over */}
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
          <StepIndicator
            currentStep={state.step}
            maxStepReached={state.maxStepReached}
            onStepClick={(step) => dispatch({ type: 'GO_TO_STEP', step })}
          />
          <button
            type="button"
            onClick={handleStartOver}
            className="text-xs text-surface-500 hover:text-surface-300"
            title={t('wizard.reset')}
          >
            {t('wizard.reset')}
          </button>
        </div>

        {/* Step content */}
        {state.step === 1 && (
          <StepColors
            colors={state.colors}
            format={state.format}
            dispatch={dispatch}
            onNext={handleNext}
          />
        )}

        {state.step === 2 && (
          <StepTraits
            colors={state.colors}
            selectedArchetypes={state.selectedArchetypes}
            selectedTraits={state.selectedTraits}
            customStrategy={state.customStrategy}
            budgetLimit={state.budgetLimit}
            rarityFilter={state.rarityFilter}
            dispatch={dispatch}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}

        {state.step === 3 && (
          <StepCoreCards
            state={state}
            dispatch={dispatch}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}

        {state.step === 4 && (
          <StepDeckFill
            state={state}
            dispatch={dispatch}
            onBack={handleBack}
            onFinish={handleFinish}
          />
        )}
      </div>
    </Layout>
  )
}
