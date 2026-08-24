import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ComboCard } from './ComboCard'
import { SearchInput } from '../SearchInput'
import { CardImage } from '../CardImage'
import { CardLightbox } from '../CardLightbox'
import { buildSearchFilterSuffix } from '../../lib/trait-mappings'
import { WizardNav } from './WizardNav'
import { Button } from '../ui/Button'
import { LoadingDots } from '../ui/LoadingDots'
import { ErrorBox } from '../ui/ErrorBox'
import { cn } from '../../lib/utils'
import { searchCards } from '../../lib/scryfall/client'
import { getCardRejectionReason } from '../../lib/card-validation'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { WizardState, WizardAction, CoreCombo } from '../../lib/wizard-state'
import { getActiveColors, getSelectedColors, getMaybeColors, loadWizardAux, persistWizardAux } from '../../lib/wizard-state'
import { sectionFillIntentFromWizard } from '../../lib/section-fill-intent'
import { generateCombos, type RejectedCard, type RejectedCombo } from '../../lib/combo-generation'

interface StepCoreCardsProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
  onReset: () => void
}

interface FetchResult {
  combos: CoreCombo[]
  rejectedCards: RejectedCard[]
  rejectedCombos: RejectedCombo[]
  /** Maybe colors the batch failed to cover across all valid combos. */
  missingMaybes: string[]
}

async function fetchAndResolveCombos(
  state: WizardState,
  locale: string,
  rejectedCards?: RejectedCard[],
  rejectedCombos?: RejectedCombo[],
  pinnedCard?: string,
  missingMaybeColors?: string[],
): Promise<FetchResult> {
  const { combos, rejectedCards: newRejectedCards, rejectedCombos: newRejectedCombos } = await generateCombos(
    sectionFillIntentFromWizard(state),
    locale,
    {
      activeColors: getActiveColors(state.colors),
      selectedColors: getSelectedColors(state.colors),
      maybeColors: getMaybeColors(state.colors),
      rejectedCards,
      rejectedCombos,
      pinnedCard,
      missingMaybeColors,
    },
  )

  // Maybe-color coverage: across the full valid batch, every maybe color the
  // user picked must appear in at least one combo's color identity. Anything
  // missing is fed back to the retry prompt so the next batch can cover it.
  const maybeColors = getMaybeColors(state.colors)
  const coveredMaybes = new Set<string>()
  for (const combo of combos) {
    for (const card of combo.cards) {
      if (!card.scryfallCard) continue
      for (const c of card.scryfallCard.color_identity) {
        if (maybeColors.includes(c as typeof maybeColors[number])) {
          coveredMaybes.add(c)
        }
      }
    }
  }
  const missingMaybes = maybeColors.filter((c) => !coveredMaybes.has(c))

  return {
    combos,
    rejectedCards: newRejectedCards,
    rejectedCombos: newRejectedCombos,
    missingMaybes,
  }
}

const DISPLAY_COUNT = 3

export function StepCoreCards({ state, dispatch, onNext, onBack, onReset }: StepCoreCardsProps) {
  const t = useT()
  const sounds = useDeckSounds()
  const { locale } = useI18n()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState<ScryfallCard[]>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [auxLoaded] = useState(() => loadWizardAux())
  const [comboFingerprint, setComboFingerprint] = useState(auxLoaded.comboFingerprint)
  const [previouslyRejected, setPreviouslyRejected] = useState<RejectedCombo[]>(auxLoaded.previouslyRejected)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // Suggestion history: each entry is a batch of valid combos
  const [comboHistory, setComboHistory] = useState<CoreCombo[][]>(() =>
    auxLoaded.comboHistory.length > 0 ? auxLoaded.comboHistory : state.coreCombos.length > 0 ? [state.coreCombos] : [],
  )
  const [historyIndex, setHistoryIndex] = useState(auxLoaded.historyIndex)
  // Buffer: extras beyond DISPLAY_COUNT, used as fallback for "suggest different"
  const [comboBuffer, setComboBuffer] = useState<CoreCombo[]>(auxLoaded.comboBuffer)

  // Fingerprint of strategy inputs that affect combo generation
  const currentFingerprint = useMemo(() =>
    JSON.stringify([state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.seedCard?.id ?? null]),
    [state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.seedCard],
  )
  const combosAreStale = comboFingerprint !== '' && comboFingerprint !== currentFingerprint && state.coreCombos.length > 0

  // Persist combo aux state whenever it changes
  useEffect(() => {
    persistWizardAux({ comboFingerprint, comboHistory, historyIndex, comboBuffer, previouslyRejected })
  }, [comboFingerprint, comboHistory, historyIndex, comboBuffer, previouslyRejected])

  /** Store a new batch: show first 3, buffer the rest, add to history. */
  const applyBatch = useCallback((combos: CoreCombo[]) => {
    const display = combos.slice(0, DISPLAY_COUNT)
    const extras = combos.slice(DISPLAY_COUNT)
    dispatch({ type: 'SET_CORE_COMBOS', combos: display })
    setComboBuffer((prev) => [...prev, ...extras])
    setComboHistory((prev) => {
      const next = [...prev, display]
      setHistoryIndex(next.length - 1)
      return next
    })
    setComboFingerprint(currentFingerprint)
  }, [dispatch, currentFingerprint])

  const fetchCombos = useCallback(async (rejectCurrent = false, pinCard?: string) => {
    // A wizard-level seed card is a hard MUST-INCLUDE across every
    // generation. An explicit `pinCard` arg (ad-hoc "suggest with this
    // card" from the in-step lightbox) always wins when passed —
    // otherwise the seed takes over.
    const effectivePin = pinCard ?? state.seedCard?.name

    // Try buffer first when requesting different combos (not pinned)
    if (rejectCurrent && !effectivePin && comboBuffer.length >= DISPLAY_COUNT) {
      const fromBuffer = comboBuffer.slice(0, DISPLAY_COUNT)
      const remaining = comboBuffer.slice(DISPLAY_COUNT)
      dispatch({ type: 'SET_CORE_COMBOS', combos: fromBuffer })
      setComboBuffer(remaining)
      setComboHistory((prev) => {
        const next = [...prev, fromBuffer]
        setHistoryIndex(next.length - 1)
        return next
      })
      return
    }

    setIsLoading(true)
    setError(null)

    // When user explicitly asks for different combos, reject the current ones
    let seedRejectedCombos = previouslyRejected
    if (rejectCurrent && state.coreCombos.length > 0) {
      const newRejections = state.coreCombos.map((c) => ({
        name: c.name,
        reason: `User wants different suggestions (cards: ${c.cards.map((card) => card.name).join(', ')})`,
      }))
      seedRejectedCombos = [...previouslyRejected, ...newRejections]
      setPreviouslyRejected(seedRejectedCombos)
    }

    try {
      const first = await fetchAndResolveCombos(
        state, locale, undefined,
        seedRejectedCombos.length > 0 ? seedRejectedCombos : undefined,
        effectivePin,
      )

      // Accept the first batch if it produced any valid combos.
      // The user can hit "suggest different" to reroll if quality is low.
      if (first.combos.length > 0) {
        applyBatch(first.combos)
        setIsLoading(false)
        return
      }

      // Zero valid combos — retry once with rejection feedback so the
      // model avoids the same bad cards/combos.
      const shouldRetry =
        first.rejectedCards.length > 0 ||
        first.rejectedCombos.length > 0
      if (shouldRetry) {
        const second = await fetchAndResolveCombos(
          state,
          locale,
          first.rejectedCards,
          first.rejectedCombos,
          effectivePin,
          first.missingMaybes.length > 0 ? first.missingMaybes : undefined,
        )

        if (second.combos.length > 0) {
          applyBatch(second.combos)
          setIsLoading(false)
          return
        }
      }

      setError(t('core.noValidCombos'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get suggestions')
    } finally {
      setIsLoading(false)
    }
  }, [state.colors, state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.budgetMin, state.budgetMax, state.rarityFilter, state.coreCombos, state.seedCard, locale, dispatch, t, currentFingerprint, previouslyRejected, applyBatch, comboBuffer])

  const didFetch = useRef(false)
  useEffect(() => {
    if (state.coreCombos.length === 0 && !didFetch.current) {
      didFetch.current = true
      fetchCombos(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const navigateHistory = useCallback((idx: number) => {
    if (idx < 0 || idx >= comboHistory.length) return
    setHistoryIndex(idx)
    dispatch({ type: 'SET_CORE_COMBOS', combos: comboHistory[idx] })
  }, [comboHistory, dispatch])

  // Build filter suffix from step 1 & 2 selections
  const searchSuffix = useMemo(() => {
    const activeColors = getActiveColors(state.colors)
    return buildSearchFilterSuffix(activeColors, {
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.budgetMin, state.budgetMax, state.rarityFilter])

  // Manual card search - searches name + oracle text
  useEffect(() => {
    if (manualSearch.length < 1) {
      setManualResults([])
      return
    }
    const timer = setTimeout(async () => {
      setManualSearching(true)
      try {
        const escaped = manualSearch.replace(/[()]/g, '')
        // Search results render in default (usually English) for rate-limit reasons; localization happens when the card is added or viewed in detail.
        const result = await searchCards(`(${escaped} or o:${escaped})${searchSuffix}`)
        const filtered = (result.data ?? [])
          .filter((c) => !getCardRejectionReason(c))
          .slice(0, 8)
        setManualResults(filtered)
      } catch {
        setManualResults([])
      } finally {
        setManualSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [manualSearch, searchSuffix])

  const suggestWithCard = useCallback((card: ScryfallCard) => {
    setLightboxIndex(null)
    fetchCombos(false, card.name)
  }, [fetchCombos])

  const renderLightboxActions = useCallback((card: ScryfallCard) => (
    <Button
      variant="primary"
      size="md"
      onClick={() => suggestWithCard(card)}
      className="w-full"
    >
      {t('core.suggestNewWithCard')}
    </Button>
  ), [suggestWithCard, t])

  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl space-y-8 px-4 pb-24 pt-16">
        {/* Section header */}
        <header className="flex flex-col items-center text-center">
          <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-400">
            Chapter III
          </span>
          <h2 className="mt-4 font-display text-display-title leading-[1.1] tracking-display text-cream-100">
            {t('core.title')}
          </h2>
          <p className="mt-4 max-w-md font-body text-base text-cream-300">
            {t('core.subtitle')}
          </p>
        </header>

        {/* Loading state — marching hairline squares */}
        {isLoading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <LoadingDots size="md" tone="bright" />
            <p className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
              {t('core.analyzing')}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <ErrorBox
            message={error}
            onRetry={() => fetchCombos(false)}
            retryLabel={t('core.tryAgain')}
          />
        )}

        {/* Combo suggestions */}
        {!isLoading && state.coreCombos.length > 0 && (
          <div className="space-y-4">
            {/* Stale combos — prominent warning above combos */}
            {combosAreStale && (
              <div className="border border-ink-red px-5 py-4 text-center">
                <p className="font-mono text-mono-label uppercase tracking-mono-label text-ink-red-bright">
                  {t('core.strategyChanged')}
                </p>
                <p className="mt-2 font-body text-sm text-cream-400">{t('core.strategyChangedHint')}</p>
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => { setPreviouslyRejected([]); setComboHistory([]); setComboBuffer([]); fetchCombos(false) }}
                  >
                    {t('core.refreshCombos')}
                  </Button>
                </div>
              </div>
            )}

            {!combosAreStale && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => fetchCombos(true)}
                disabled={isLoading}
                className="w-full"
              >
                {t('core.suggestDifferent')}
              </Button>
            )}

            {/* History nav — top */}
            {comboHistory.length > 1 && (
              <HistoryNav
                historyIndex={historyIndex}
                length={comboHistory.length}
                onNavigate={(i) => { navigateHistory(i); sounds.uiClick() }}
              />
            )}

            <div className={cn('space-y-4', combosAreStale && 'pointer-events-none opacity-40')}>
              {state.coreCombos.map((combo, i) => (
                <ComboCard
                  key={i}
                  combo={combo}
                  selected={state.selectedComboIndex === i}
                  onSelect={() => { dispatch({ type: 'SELECT_COMBO', index: i }); sounds.uiClick() }}
                  renderLightboxActions={renderLightboxActions}
                />
              ))}
            </div>

            {/* History nav — bottom */}
            {comboHistory.length > 1 && (
              <HistoryNav
                historyIndex={historyIndex}
                length={comboHistory.length}
                onNavigate={(i) => { navigateHistory(i); sounds.uiClick() }}
              />
            )}

            {!combosAreStale && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => fetchCombos(true)}
                disabled={isLoading}
                className="w-full"
              >
                {t('core.suggestDifferent')}
              </Button>
            )}
          </div>
        )}

        {/* Ornamental rule separating combos from card search */}
        <div className="flex items-center justify-center gap-4" aria-hidden="true">
          <span className="h-px w-16 bg-hairline" />
          <span className="font-mono text-mono-marginal text-cream-500">§</span>
          <span className="h-px w-16 bg-hairline" />
        </div>

        {/* Card search */}
        <div>
          <h3 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-200">
            {t('core.orSearch')}
          </h3>
          <SearchInput value={manualSearch} onChange={setManualSearch} placeholder={t('core.searchPlaceholder')} />
          {manualSearching && (
            <p className="mt-2 font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
              {t('search.searching')}
            </p>
          )}
          {manualResults.length > 0 && (
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {manualResults.map((card, i) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => { setLightboxIndex(i); sounds.cardOpen() }}
                  className="group relative overflow-hidden border border-hairline transition-transform hover:-translate-y-1 hover:border-hairline-strong"
                >
                  <CardImage card={card} size="small" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox for search results */}
      {lightboxIndex !== null && manualResults.length > 0 && (
        <CardLightbox
          cards={manualResults}
          currentIndex={lightboxIndex}
          searchTerm={manualSearch}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          renderActions={renderLightboxActions}
        />
      )}

      <WizardNav>
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="lg" onClick={onBack}>
            {t('wizard.back')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={onNext}
            // Enabled once a combo is picked — or once the user has already
            // been to step 4, so returning here after a skip doesn't strand
            // them behind a disabled primary CTA. The `-1` sentinel used to
            // do this by accident.
            disabled={state.selectedComboIndex == null && state.maxStepReached < 4}
          >
            {t('core.nextBuildDeck')}
          </Button>
        </div>
        <div className="flex items-center justify-center gap-6">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('wizard.reset')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatch({ type: 'SKIP_COMBO' })
              onNext()
            }}
          >
            {t('core.skipLong')}
          </Button>
        </div>
      </WizardNav>
    </section>
  )
}

/** History pagination — slabs instead of dots. */
function HistoryNav({
  historyIndex,
  length,
  onNavigate,
}: {
  historyIndex: number
  length: number
  onNavigate: (i: number) => void
}) {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-5">
      <button
        type="button"
        disabled={historyIndex <= 0}
        onClick={() => onNavigate(historyIndex - 1)}
        className="flex h-9 cursor-pointer items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
        aria-label={t('core.prevBatch')}
      >
        <span aria-hidden="true" className="text-base leading-none">{'\u2039'}</span>
        <span className="hidden sm:inline">{t('core.prevBatch')}</span>
      </button>
      <div className="flex items-center gap-2">
        {Array.from({ length }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onNavigate(i)}
            className={cn(
              'h-1 cursor-pointer transition-all',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              i === historyIndex ? 'w-8 bg-ink-red-bright' : 'w-3 bg-cream-500/50 hover:bg-cream-300',
            )}
            aria-label={`Suggestion batch ${i + 1}`}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={historyIndex >= length - 1}
        onClick={() => onNavigate(historyIndex + 1)}
        className="flex h-9 cursor-pointer items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
        aria-label={t('core.nextBatch')}
      >
        <span className="hidden sm:inline">{t('core.nextBatch')}</span>
        <span aria-hidden="true" className="text-base leading-none">{'\u203A'}</span>
      </button>
    </div>
  )
}
