import { useState, useEffect, useCallback, useMemo } from 'react'
import { ComboCard } from './ComboCard'
import { SearchInput } from '../SearchInput'
import { CardImage } from '../CardImage'
import { CardLightbox } from '../CardLightbox'
import { buildScryfallQueriesFromTraits, buildSearchFilterSuffix, getTraitById, getOracleTermsForTraits } from '../../lib/trait-mappings'
import { WizardNav } from './WizardNav'
import { searchCards, getCardByName } from '../../lib/scryfall/client'
import { getCardRejectionReason, getFilterRejectionReason, type DeckFilters } from '../../lib/card-validation'
import { analyzeComposition, findSynergyIssue } from '../../lib/synergy-validation'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { WizardState, WizardAction, CoreCombo } from '../../lib/wizard-state'
import { getActiveColors, loadWizardAux, persistWizardAux } from '../../lib/wizard-state'

interface StepCoreCardsProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
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
): Promise<FetchResult> {
  const activeColors = getActiveColors(state.colors)
  const allTraitIds = [...state.selectedArchetypes, ...state.selectedTraits]

  // Extract verifiable oracle terms from selected traits
  const oracleTerms = getOracleTermsForTraits(state.selectedTraits)

  // Build Scryfall queries from trait mappings
  const queries = buildScryfallQueriesFromTraits(allTraitIds, activeColors, {
    format: state.format,
    budgetLimit: state.budgetLimit,
    rarities: state.rarityFilter,
  })

  // Fetch card pools from Scryfall
  const cardPoolText: string[] = []
  for (const query of queries) {
    try {
      const result = await searchCards(query)
      const cards = result.data ?? []
      for (const c of cards.slice(0, 15)) {
        const parts = [c.name]
        if (c.mana_cost) parts.push(c.mana_cost)
        parts.push(`[${c.type_line}]`)
        if (c.oracle_text) parts.push(c.oracle_text.slice(0, 150))
        cardPoolText.push(parts.join(' - '))
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
    colors: activeColors,
    archetypes: archetypeLabels,
    traits: traitLabels,
    requiredKeywords: oracleTerms.length > 0 ? oracleTerms : undefined,
    pinnedCard: pinnedCard || undefined,
    customStrategy: state.customStrategy || undefined,
    format: state.format,
    budgetLimit: state.budgetLimit ?? undefined,
    rejectedCards: rejectedCards && rejectedCards.length > 0 ? rejectedCards : undefined,
    rejectedCombos: rejectedCombos && rejectedCombos.length > 0 ? rejectedCombos : undefined,
    language: locale,
  })

  // Resolve card images and validate
  const deckFilters: DeckFilters = {
    colors: activeColors,
    format: state.format,
    budgetLimit: state.budgetLimit,
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

  return { combos: validCombos, rejectedCards: newRejectedCards, rejectedCombos: newRejectedCombos }
}

const DISPLAY_COUNT = 3

export function StepCoreCards({ state, dispatch, onNext, onBack }: StepCoreCardsProps) {
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
    JSON.stringify([state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format]),
    [state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format],
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
    // Try buffer first when requesting different combos (not pinned)
    if (rejectCurrent && !pinCard && comboBuffer.length >= DISPLAY_COUNT) {
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
        pinCard,
      )

      if (first.combos.length > 0) {
        applyBatch(first.combos)
        setIsLoading(false)
        return
      }

      // Retry with rejection feedback if we had any rejections
      if (first.rejectedCards.length > 0 || first.rejectedCombos.length > 0) {
        const second = await fetchAndResolveCombos(state, locale, first.rejectedCards, first.rejectedCombos, pinCard)

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
  }, [state.colors, state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.format, state.budgetLimit, state.rarityFilter, state.coreCombos, locale, dispatch, t, currentFingerprint, previouslyRejected, applyBatch, comboBuffer])

  useEffect(() => {
    if (state.coreCombos.length === 0 && !isLoading) {
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
      budgetLimit: state.budgetLimit,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetLimit, state.rarityFilter])

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
    <button
      type="button"
      onClick={() => suggestWithCard(card)}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
    >
      {t('core.suggestWithCard')}
    </button>
  ), [suggestWithCard, t])

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6 pb-20">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-surface-100">{t('core.title')}</h2>
        <p className="mt-2 text-sm text-surface-400">
          {t('core.subtitle')}
        </p>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-sm text-surface-400">{t('core.analyzing')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-mana-red/10 p-4 text-center">
          <p className="text-sm text-mana-red">{error}</p>
          <button
            type="button"
            onClick={() => fetchCombos(false)}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t('core.tryAgain')}
          </button>
        </div>
      )}

      {/* Combo suggestions */}
      {!isLoading && state.coreCombos.length > 0 && (
        <div className="space-y-3">
          {/* Stale combos - prominent warning above combos */}
          {combosAreStale && (
            <div className="rounded-xl border-2 border-mana-multi/40 bg-mana-multi/10 px-5 py-4 text-center">
              <p className="font-medium text-mana-multi">{t('core.strategyChanged')}</p>
              <p className="mt-1 text-xs text-surface-400">{t('core.strategyChangedHint')}</p>
              <button
                type="button"
                onClick={() => { setPreviouslyRejected([]); setComboHistory([]); setComboBuffer([]); fetchCombos(false) }}
                className="mt-3 rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                {t('core.refreshCombos')}
              </button>
            </div>
          )}

          {!combosAreStale && (
            <button
              type="button"
              onClick={() => fetchCombos(true)}
              disabled={isLoading}
              className="w-full rounded-xl border border-accent/30 bg-accent/10 py-3 text-sm font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/20"
            >
              {t('core.suggestDifferent')}
            </button>
          )}

          {/* History nav - top */}
          {comboHistory.length > 1 && (
            <div className="flex items-center justify-center gap-3 py-1">
              <button
                type="button"
                disabled={historyIndex <= 0}
                onClick={() => { navigateHistory(historyIndex - 1); sounds.uiClick() }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-surface-400 hover:bg-surface-700 hover:text-surface-200 disabled:opacity-20 disabled:pointer-events-none"
              >
                &lsaquo;
              </button>
              <div className="flex items-center gap-2">
                {comboHistory.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { navigateHistory(i); sounds.uiClick() }}
                    className={`rounded-full transition-all ${
                      i === historyIndex ? 'h-2.5 w-7 bg-accent' : 'h-2.5 w-2.5 bg-surface-600 hover:bg-surface-500'
                    }`}
                    aria-label={`Suggestion batch ${i + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={historyIndex >= comboHistory.length - 1}
                onClick={() => { navigateHistory(historyIndex + 1); sounds.uiClick() }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-surface-400 hover:bg-surface-700 hover:text-surface-200 disabled:opacity-20 disabled:pointer-events-none"
              >
                &rsaquo;
              </button>
            </div>
          )}

          <div className={combosAreStale ? 'opacity-40 pointer-events-none' : ''}>
            {state.coreCombos.map((combo, i) => (
              <div key={i} className="mt-3">
                <ComboCard
                  combo={combo}
                  selected={state.selectedComboIndex === i}
                  onSelect={() => { dispatch({ type: 'SELECT_COMBO', index: i }); sounds.uiClick() }}
                  renderLightboxActions={renderLightboxActions}
                />
              </div>
            ))}
          </div>

          {/* History nav - bottom */}
          {comboHistory.length > 1 && (
            <div className="flex items-center justify-center gap-3 py-1">
              <button
                type="button"
                disabled={historyIndex <= 0}
                onClick={() => { navigateHistory(historyIndex - 1); sounds.uiClick() }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-surface-400 hover:bg-surface-700 hover:text-surface-200 disabled:opacity-20 disabled:pointer-events-none"
              >
                &lsaquo;
              </button>
              <div className="flex items-center gap-2">
                {comboHistory.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { navigateHistory(i); sounds.uiClick() }}
                    className={`rounded-full transition-all ${
                      i === historyIndex ? 'h-2.5 w-7 bg-accent' : 'h-2.5 w-2.5 bg-surface-600 hover:bg-surface-500'
                    }`}
                    aria-label={`Suggestion batch ${i + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={historyIndex >= comboHistory.length - 1}
                onClick={() => { navigateHistory(historyIndex + 1); sounds.uiClick() }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-surface-400 hover:bg-surface-700 hover:text-surface-200 disabled:opacity-20 disabled:pointer-events-none"
              >
                &rsaquo;
              </button>
            </div>
          )}

          {!combosAreStale && (
            <button
              type="button"
              onClick={() => fetchCombos(true)}
              disabled={isLoading}
              className="w-full rounded-xl border border-accent/30 bg-accent/10 py-3 text-sm font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/20"
            >
              {t('core.suggestDifferent')}
            </button>
          )}
        </div>
      )}

      {/* Card search */}
      <div className="border-t border-surface-700 pt-4">
        <h3 className="mb-2 text-sm font-medium text-surface-300">{t('core.orSearch')}</h3>
        <SearchInput value={manualSearch} onChange={setManualSearch} placeholder={t('core.searchPlaceholder')} />
        {manualSearching && <p className="mt-2 text-xs text-surface-500">{t('search.searching')}</p>}
        {manualResults.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {manualResults.map((card, i) => (
              <button
                key={card.id}
                type="button"
                onClick={() => { setLightboxIndex(i); sounds.cardOpen() }}
                className="group relative overflow-hidden rounded-lg transition-transform hover:scale-[1.03]"
              >
                <CardImage card={card} size="small" />
              </button>
            ))}
          </div>
        )}
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
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-surface-600 px-6 py-2.5 text-sm text-surface-300 hover:border-surface-500 hover:text-surface-100"
        >
          {t('wizard.back')}
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'SELECT_COMBO', index: -1 })
              onNext()
            }}
            className="text-sm text-surface-400 hover:text-surface-200 underline underline-offset-4"
          >
            <span className="sm:hidden">{t('wizard.skip')}</span><span className="hidden sm:inline">{t('core.skipLong')}</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={state.selectedComboIndex == null}
            className="rounded-lg bg-accent px-8 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('core.nextBuildDeck')}
          </button>
        </div>
      </WizardNav>
    </div>
  )
}
