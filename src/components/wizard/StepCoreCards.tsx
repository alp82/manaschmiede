import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ComboCard } from './ComboCard'
import { SearchInput } from '../SearchInput'
import { CardImage } from '../CardImage'
import { CardLightbox } from '../CardLightbox'
import { buildScryfallQueriesFromTraits, buildSearchFilterSuffix, getTraitById, getOracleTermsForTraits } from '../../lib/trait-mappings'
import { WizardNav } from './WizardNav'
import { Button } from '../ui/Button'
import { LoadingDots } from '../ui/LoadingDots'
import { ErrorBox } from '../ui/ErrorBox'
import { cn } from '../../lib/utils'
import { searchCards, getCardByName } from '../../lib/scryfall/client'
import { getCardRejectionReason, getFilterRejectionReason, type DeckFilters } from '../../lib/card-validation'
import { analyzeComposition, findSynergyIssue } from '../../lib/synergy-validation'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { WizardState, WizardAction, CoreCombo } from '../../lib/wizard-state'
import { getActiveColors, getSelectedColors, getMaybeColors, loadWizardAux, persistWizardAux } from '../../lib/wizard-state'

interface StepCoreCardsProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
  onReset: () => void
}

interface RejectedCard {
  name: string
  reason: string
}

interface RejectedCombo {
  name: string
  reason: string
}

interface FetchResult {
  combos: CoreCombo[]
  rejectedCards: RejectedCard[]
  rejectedCombos: RejectedCombo[]
  /** Maybe colors the batch failed to cover across all valid combos. */
  missingMaybes: string[]
}

/** Check if any card in a combo has at least one of the required oracle terms. */
function comboMatchesKeywords(cards: Array<{ scryfallCard?: ScryfallCard }>, oracleTerms: string[]): boolean {
  if (oracleTerms.length === 0) return true
  for (const { scryfallCard } of cards) {
    if (!scryfallCard) continue
    const text = (scryfallCard.oracle_text || '').toLowerCase()
    const keywordsLower = (scryfallCard.keywords ?? []).map((k) => k.toLowerCase())
    for (const term of oracleTerms) {
      if (text.includes(term) || keywordsLower.includes(term)) return true
    }
  }
  return false
}

async function fetchAndResolveCombos(
  state: WizardState,
  locale: string,
  rejectedCards?: RejectedCard[],
  rejectedCombos?: RejectedCombo[],
  pinnedCard?: string,
  missingMaybeColors?: string[],
): Promise<FetchResult> {
  const activeColors = getActiveColors(state.colors)
  const allTraitIds = [...state.selectedArchetypes, ...state.selectedTraits]

  // Extract verifiable oracle terms from selected traits
  const oracleTerms = getOracleTermsForTraits(state.selectedTraits)

  // Build Scryfall queries from trait mappings
  const queries = buildScryfallQueriesFromTraits(allTraitIds, activeColors, {
    format: state.format,
    budgetMin: state.budgetMin,
    budgetMax: state.budgetMax,
    rarities: state.rarityFilter,
  })

  // Fetch card pools from Scryfall
  const cardPoolText: string[] = []
  for (const query of queries) {
    try {
      const result = await searchCards(query)
      const cards = result.data ?? []
      for (const c of cards.slice(0, 10)) {
        const type = c.type_line.replace(/ —.*/, '')
        cardPoolText.push(`${c.name} (${c.mana_cost ?? '0'}) [${type}]`)
      }
    } catch {
      // Skip failed queries
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  const uniquePool = [...new Set(cardPoolText)]
  const archetypeLabels = state.selectedArchetypes.map((id) => {
    const trait = getTraitById(id)
    return trait ? `${trait.label} (${trait.description})` : id
  })
  const traitLabels = state.selectedTraits.map((id) => getTraitById(id)?.label || id)

  // Call Convex action
  const { ConvexHttpClient } = await import('convex/browser')
  const { api } = await import('../../../convex/_generated/api')
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string
  const client = new ConvexHttpClient(convexUrl)

  const result = await client.action(api.suggestCombos.suggest, {
    cardPool: uniquePool.join('\n'),
    selectedColors: getSelectedColors(state.colors),
    maybeColors: getMaybeColors(state.colors),
    archetypes: archetypeLabels,
    traits: traitLabels,
    requiredKeywords: oracleTerms.length > 0 ? oracleTerms : undefined,
    pinnedCard: pinnedCard || undefined,
    customStrategy: state.customStrategy || undefined,
    format: state.format,
    budgetLimit: state.budgetMax ?? undefined,
    rejectedCards: rejectedCards && rejectedCards.length > 0 ? rejectedCards : undefined,
    rejectedCombos: rejectedCombos && rejectedCombos.length > 0 ? rejectedCombos : undefined,
    missingMaybeColors: missingMaybeColors && missingMaybeColors.length > 0 ? missingMaybeColors : undefined,
    language: locale,
  })

  // Resolve card images and validate
  const deckFilters: DeckFilters = {
    colors: activeColors,
    format: state.format,
    budgetMin: state.budgetMin,
    budgetMax: state.budgetMax,
    rarities: state.rarityFilter,
  }
  const validCombos: CoreCombo[] = []
  const newRejectedCards: RejectedCard[] = [...(rejectedCards ?? [])]
  const newRejectedCombos: RejectedCombo[] = [...(rejectedCombos ?? [])]

  // Resolve all combos - reject entire combo if any card fails (description references all cards)
  const matchingCombos: CoreCombo[] = []
  const nonMatchingCombos: CoreCombo[] = []

  for (const combo of result.combos) {
    const resolvedCards: CoreCombo['cards'] = []
    let hasRejection = false

    for (const cardName of combo.cards) {
      try {
        const scryfallCard = await getCardByName(cardName, locale !== 'en' ? locale : undefined)
        const rejection = getCardRejectionReason(scryfallCard) ?? getFilterRejectionReason(scryfallCard, deckFilters)
        if (rejection) {
          newRejectedCards.push({ name: cardName, reason: rejection })
          hasRejection = true
        } else {
          resolvedCards.push({ name: cardName, scryfallId: scryfallCard.id, scryfallCard })
        }
      } catch {
        newRejectedCards.push({ name: cardName, reason: 'Card not found on Scryfall - may not exist' })
        hasRejection = true
      }
    }

    // All cards must resolve - partial combos have broken descriptions
    if (hasRejection || resolvedCards.length < 2) continue

    // Internal synergy check: each card's tribal/type/keyword references
    // must be satisfied by at least one OTHER card in the combo. A combo
    // that includes "Dragon Tempest" without any Dragon is broken.
    const comboComposition = analyzeComposition(
      resolvedCards
        .filter((c) => c.scryfallCard)
        .map((c) => ({ card: c.scryfallCard!, quantity: 1 })),
    )
    let comboSynergyOk = true
    for (const card of resolvedCards) {
      if (!card.scryfallCard) continue
      const issue = findSynergyIssue(card.scryfallCard, comboComposition, {
        tribalThreshold: 1,
        cardTypeThreshold: 1,
        keywordThreshold: 1,
      })
      if (issue) {
        newRejectedCombos.push({ name: combo.name, reason: issue.reason })
        comboSynergyOk = false
        break
      }
    }
    if (!comboSynergyOk) continue

    const resolved: CoreCombo = { name: combo.name, cards: resolvedCards, explanation: combo.explanation }

    if (comboMatchesKeywords(resolvedCards, oracleTerms)) {
      matchingCombos.push(resolved)
    } else {
      nonMatchingCombos.push(resolved)
    }
  }

  // Prefer keyword-matching combos, then fill with non-matching as fallback
  for (const combo of matchingCombos) {
    validCombos.push(combo)
  }
  for (const combo of nonMatchingCombos) {
    validCombos.push(combo)
  }

  // Maybe-color coverage: across the full valid batch, every maybe color the
  // user picked must appear in at least one combo's color identity. Anything
  // missing is fed back to the retry prompt so the next batch can cover it.
  const maybeColors = getMaybeColors(state.colors)
  const coveredMaybes = new Set<string>()
  for (const combo of validCombos) {
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
    combos: validCombos,
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
    JSON.stringify([state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format, state.seedCard?.id ?? null]),
    [state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format, state.seedCard],
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
  }, [state.colors, state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.format, state.budgetMin, state.budgetMax, state.rarityFilter, state.coreCombos, state.seedCard, locale, dispatch, t, currentFingerprint, previouslyRejected, applyBatch, comboBuffer])

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
      format: state.format,
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetMin, state.budgetMax, state.rarityFilter])

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
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="lg" onClick={onBack}>
            {t('wizard.back')}
          </Button>
          <Button variant="ghost" size="md" onClick={onReset}>
            {t('wizard.reset')}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              dispatch({ type: 'SELECT_COMBO', index: -1 })
              onNext()
            }}
          >
            <span className="sm:hidden">{t('wizard.skip')}</span>
            <span className="hidden sm:inline">{t('core.skipLong')}</span>
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={onNext}
            disabled={state.selectedComboIndex == null}
          >
            {t('core.nextBuildDeck')}
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
