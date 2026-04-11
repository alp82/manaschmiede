import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useReducer, useCallback, useEffect, useState, useRef } from 'react'
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs'
import { Layout } from '../../components/Layout'
import { StepIndicator } from '../../components/wizard/StepIndicator'
import { StepColors } from '../../components/wizard/StepColors'
import { StepTraits } from '../../components/wizard/StepTraits'
import { StepCoreCards } from '../../components/wizard/StepCoreCards'
import { StepDeckFill } from '../../components/wizard/StepDeckFill'
import { ConfirmModal } from '../../components/ConfirmModal'
import { CardLightbox } from '../../components/CardLightbox'
import { Button } from '../../components/ui/Button'
import {
  wizardReducer,
  initialWizardState,
  persistWizardState,
  clearWizardState,
  clearWizardAux,
  isWizardStateDirty,
} from '../../lib/wizard-state'
import { persistDeck } from '../../lib/deck-storage'
import { generateDeckName } from '../../lib/deck-naming'
import { getCardById } from '../../lib/scryfall/client'
import { getCardName } from '../../lib/scryfall/types'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { extractCostColors } from '../../lib/mana-cost-colors'
import { useT } from '../../lib/i18n'

export const Route = createFileRoute('/deck/new')({
  head: () => ({
    meta: [{ title: 'New Deck — Manaschmiede' }],
  }),
  component: NewDeckWizard,
})

function NewDeckWizard() {
  const navigate = useNavigate()
  const t = useT()
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState)

  // Sync step to URL via nuqs
  const [urlStep, setUrlStep] = useQueryState(
    'step',
    parseAsInteger.withDefault(1),
  )

  // Seed card — Scryfall ID carried in the URL when the user clicks
  // "forge deck with this card" from a lightbox elsewhere.
  const [seedParam, setSeedParam] = useQueryState('seed', parseAsString)

  // Pending seed — set while the conflict modal is open; applied (or
  // discarded) when the user picks an option.
  const [pendingSeed, setPendingSeed] = useState<ScryfallCard | null>(null)

  // Seed lightbox — opened by clicking the anchor in the stepper.
  const [seedLightboxOpen, setSeedLightboxOpen] = useState(false)

  // On mount: if URL has a step, jump to it; otherwise set URL from stored state
  useEffect(() => {
    if (urlStep >= 1 && urlStep <= 4 && urlStep !== state.step) {
      dispatch({ type: 'GO_TO_STEP', step: urlStep as 1 | 2 | 3 | 4 })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On mount / when seedParam changes: resolve the seed card and either
  // apply it immediately (clean wizard) or stash as pending (dirty wizard,
  // show confirm modal). Re-entry with the same seed already set is a no-op.
  useEffect(() => {
    if (!seedParam) return
    if (state.seedCard?.id === seedParam) return

    let cancelled = false
    ;(async () => {
      try {
        const card = await getCardById(seedParam)
        if (cancelled) return
        if (isWizardStateDirty(state)) {
          setPendingSeed(card)
        } else {
          dispatch({ type: 'SET_SEED_CARD', card, costColors: extractCostColors(card) })
        }
      } catch {
        // Invalid / unreachable Scryfall ID — drop the param silently.
        if (!cancelled) setSeedParam(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [seedParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyPendingSeed = useCallback(() => {
    if (!pendingSeed) return
    // Full reset first so the fresh seed lands on a clean slate, then
    // drop the resolved card in with its cost colors.
    dispatch({ type: 'RESET' })
    clearWizardAux()
    dispatch({ type: 'SET_SEED_CARD', card: pendingSeed, costColors: extractCostColors(pendingSeed) })
    setPendingSeed(null)
    setUrlStep(1)
  }, [pendingSeed, setUrlStep])

  const cancelPendingSeed = useCallback(() => {
    setPendingSeed(null)
    setSeedParam(null)
  }, [setSeedParam])

  const handleClearSeed = useCallback(() => {
    dispatch({ type: 'CLEAR_SEED_CARD' })
    setSeedParam(null)
    setSeedLightboxOpen(false)
  }, [setSeedParam])

  const renderSeedLightboxActions = useCallback(
    () => (
      <div className="space-y-3">
        <p className="font-body text-sm leading-relaxed text-cream-300">
          {t('wizard.seedExplanation')}
        </p>
        <Button
          variant="destructive"
          size="md"
          className="w-full"
          onClick={handleClearSeed}
        >
          {t('wizard.seedClear')}
        </Button>
      </div>
    ),
    [handleClearSeed, t],
  )

  // Persist wizard state to localStorage on every change
  useEffect(() => {
    persistWizardState(state)
  }, [state])

  // Keep URL step in sync when state.step changes & scroll to top
  useEffect(() => {
    if (state.step !== urlStep) {
      setUrlStep(state.step)
    }
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' })
  }, [state.step]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = useCallback(() => {
    dispatch({ type: 'NEXT_STEP' })
  }, [])

  const handleBack = useCallback(() => {
    dispatch({ type: 'PREV_STEP' })
  }, [])

  const handleSkipToDeck = useCallback(() => {
    // Advance maxStepReached so GO_TO_STEP works
    dispatch({ type: 'NEXT_STEP' })
    dispatch({ type: 'NEXT_STEP' })
    dispatch({ type: 'NEXT_STEP' })
    dispatch({ type: 'GO_TO_STEP', step: 4 })
  }, [])

  const handleFinish = useCallback(() => {
    const deckId = crypto.randomUUID()
    const selectedCombo =
      state.selectedComboIndex != null ? state.coreCombos[state.selectedComboIndex] : undefined
    const name =
      state.deckName ||
      selectedCombo?.name ||
      generateDeckName(state.selectedArchetypes, state.selectedTraits)
    const description = state.deckDescription || selectedCombo?.explanation || ''
    persistDeck({
      id: deckId,
      name,
      description,
      format: state.format,
      cards: state.deckCards,
      sectionPlan: state.sectionPlan,
      sectionAssignments: state.sectionAssignments,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    clearWizardState()
    navigate({ to: '/deck/$id', params: { id: deckId } })
  }, [state, navigate])

  const handleStartOver = useCallback(() => {
    dispatch({ type: 'RESET' })
    clearWizardAux()
    setUrlStep(1)
    setSeedParam(null)
  }, [setUrlStep, setSeedParam])

  // Step transition animation
  const [transitioning, setTransitioning] = useState(false)
  const [displayStep, setDisplayStep] = useState(state.step)
  const prevStepRef = useRef(state.step)
  const directionRef = useRef<'forward' | 'backward'>('forward')
  const hasTransitioned = useRef(false)

  useEffect(() => {
    if (state.step !== prevStepRef.current) {
      directionRef.current = state.step > prevStepRef.current ? 'forward' : 'backward'
      hasTransitioned.current = true
      setTransitioning(true)
      const timer = setTimeout(() => {
        setDisplayStep(state.step)
        setTransitioning(false)
      }, 200)
      prevStepRef.current = state.step
      return () => clearTimeout(timer)
    }
  }, [state.step])

  const stepAnimClass = !hasTransitioned.current
    ? '' // no animation on initial mount
    : transitioning
      ? directionRef.current === 'forward'
        ? 'animate-[step-out-forward_200ms_ease-in_both]'
        : 'animate-[step-out-backward_200ms_ease-in_both]'
      : directionRef.current === 'forward'
        ? 'animate-[step-in-forward_300ms_cubic-bezier(0.16,1,0.3,1)_both]'
        : 'animate-[step-in-backward_300ms_cubic-bezier(0.16,1,0.3,1)_both]'

  return (
    <Layout>
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex justify-center">
          <StepIndicator
            currentStep={state.step}
            maxStepReached={state.maxStepReached}
            onStepClick={(step) => dispatch({ type: 'GO_TO_STEP', step })}
            wizardState={state}
            onOpenSeed={() => setSeedLightboxOpen(true)}
          />
        </div>

        <ConfirmModal
          open={pendingSeed !== null}
          title={t('wizard.seedConflictTitle')}
          body={t('wizard.seedConflictBody').replace('{name}', pendingSeed ? getCardName(pendingSeed) : '')}
          confirmLabel={t('wizard.seedConflictConfirm')}
          cancelLabel={t('wizard.seedConflictCancel')}
          confirmVariant="destructive"
          onConfirm={applyPendingSeed}
          onCancel={cancelPendingSeed}
        />

        {seedLightboxOpen && state.seedCard && (
          <CardLightbox
            cards={[state.seedCard]}
            currentIndex={0}
            onClose={() => setSeedLightboxOpen(false)}
            onNavigate={() => {}}
            renderActions={renderSeedLightboxActions}
          />
        )}

        {/* Step content with transition animation */}
        <div key={displayStep} className={stepAnimClass}>
          {displayStep === 1 && (
            <StepTraits
              colors={state.colors}
              selectedArchetypes={state.selectedArchetypes}
              selectedTraits={state.selectedTraits}
              customStrategy={state.customStrategy}
              budgetMin={state.budgetMin}
              budgetMax={state.budgetMax}
              rarityFilter={state.rarityFilter}
              format={state.format}
              dispatch={dispatch}
              onNext={handleNext}
              onSkipToDeck={handleSkipToDeck}
              onReset={handleStartOver}
            />
          )}

          {displayStep === 2 && (
            <StepColors
              colors={state.colors}
              selectedArchetypes={state.selectedArchetypes}
              selectedTraits={state.selectedTraits}
              dispatch={dispatch}
              onNext={handleNext}
              onBack={handleBack}
              onReset={handleStartOver}
            />
          )}

          {displayStep === 3 && (
            <StepCoreCards
              state={state}
              dispatch={dispatch}
              onNext={handleNext}
              onBack={handleBack}
              onReset={handleStartOver}
            />
          )}

          {displayStep === 4 && (
            <StepDeckFill
              state={state}
              dispatch={dispatch}
              onBack={handleBack}
              onFinish={handleFinish}
              onReset={handleStartOver}
            />
          )}
        </div>
      </div>
    </Layout>
  )
}
