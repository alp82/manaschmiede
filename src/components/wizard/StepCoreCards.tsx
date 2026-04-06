import { useState, useEffect, useCallback, useMemo } from 'react'
import { ComboCard } from './ComboCard'
import { SearchInput } from '../SearchInput'
import { CardImage } from '../CardImage'
import { buildScryfallQueriesFromTraits, buildSearchFilterSuffix, getTraitById } from '../../lib/trait-mappings'
import { WizardNav } from './WizardNav'
import { searchCards, getCardByName } from '../../lib/scryfall/client'
import { getCardRejectionReason } from '../../lib/card-validation'
import { useT, useI18n } from '../../lib/i18n'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { WizardState, WizardAction, CoreCombo } from '../../lib/wizard-state'
import { getActiveColors } from '../../lib/wizard-state'

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

async function fetchAndResolveCombos(
  state: WizardState,
  locale: string,
  rejectedCards?: RejectedCard[],
): Promise<{ combos: CoreCombo[]; rejected: RejectedCard[] }> {
  const activeColors = getActiveColors(state.colors)
  const allTraitIds = [...state.selectedArchetypes, ...state.selectedTraits]

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
        if (c.oracle_text) parts.push(c.oracle_text.slice(0, 80))
        cardPoolText.push(parts.join(' — '))
      }
    } catch {
      // Skip failed queries
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  const uniquePool = [...new Set(cardPoolText)]
  const archetypeLabels = state.selectedArchetypes.map((id) => getTraitById(id)?.label || id)
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
    customStrategy: state.customStrategy || undefined,
    format: state.format,
    budgetLimit: state.budgetLimit ?? undefined,
    rejectedCards: rejectedCards && rejectedCards.length > 0 ? rejectedCards : undefined,
    language: locale,
  })

  // Resolve card images and validate
  const validCombos: CoreCombo[] = []
  const newRejected: RejectedCard[] = [...(rejectedCards ?? [])]

  for (const combo of result.combos) {
    const validCards: CoreCombo['cards'] = []
    let hasRejection = false

    for (const cardName of combo.cards) {
      try {
        const scryfallCard = await getCardByName(cardName, locale !== 'en' ? locale : undefined)
        const rejection = getCardRejectionReason(scryfallCard)
        if (rejection) {
          newRejected.push({ name: cardName, reason: rejection })
          hasRejection = true
        } else {
          validCards.push({ name: cardName, scryfallId: scryfallCard.id, scryfallCard })
        }
      } catch {
        validCards.push({ name: cardName })
      }
    }

    // Keep the combo if it still has at least 2 valid cards
    if (validCards.length >= 2 && !hasRejection) {
      validCombos.push({
        name: combo.name,
        cards: validCards,
        explanation: combo.explanation,
      })
    } else if (validCards.length >= 2) {
      validCombos.push({
        name: combo.name,
        cards: validCards,
        explanation: combo.explanation,
      })
    }
  }

  return { combos: validCombos, rejected: newRejected }
}

export function StepCoreCards({ state, dispatch, onNext, onBack }: StepCoreCardsProps) {
  const t = useT()
  const { locale } = useI18n()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState<ScryfallCard[]>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [comboFingerprint, setComboFingerprint] = useState('')

  // Fingerprint of strategy inputs that affect combo generation
  const currentFingerprint = useMemo(() =>
    JSON.stringify([state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format]),
    [state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.colors, state.format],
  )
  const combosAreStale = comboFingerprint !== '' && comboFingerprint !== currentFingerprint && state.coreCombos.length > 0

  const fetchCombos = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const first = await fetchAndResolveCombos(state, locale)

      if (first.combos.length > 0) {
        dispatch({ type: 'SET_CORE_COMBOS', combos: first.combos })
        setComboFingerprint(currentFingerprint)
        setIsLoading(false)
        return
      }

      if (first.rejected.length > 0) {
        const second = await fetchAndResolveCombos(state, locale, first.rejected)

        if (second.combos.length > 0) {
          dispatch({ type: 'SET_CORE_COMBOS', combos: second.combos })
          setComboFingerprint(currentFingerprint)
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
  }, [state.colors, state.selectedArchetypes, state.selectedTraits, state.customStrategy, state.format, state.budgetLimit, state.rarityFilter, locale, dispatch, t, currentFingerprint])

  useEffect(() => {
    if (state.coreCombos.length === 0 && !isLoading) {
      fetchCombos()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Build filter suffix from step 1 & 2 selections
  const searchSuffix = useMemo(() => {
    const activeColors = getActiveColors(state.colors)
    return buildSearchFilterSuffix(activeColors, {
      format: state.format,
      budgetLimit: state.budgetLimit,
      rarities: state.rarityFilter,
    })
  }, [state.colors, state.format, state.budgetLimit, state.rarityFilter])

  // Manual card search
  useEffect(() => {
    if (manualSearch.length < 2) {
      setManualResults([])
      return
    }
    const timer = setTimeout(async () => {
      setManualSearching(true)
      try {
        const result = await searchCards(`${manualSearch}${searchSuffix}`)
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
            onClick={fetchCombos}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t('core.tryAgain')}
          </button>
        </div>
      )}

      {/* Stale combos banner */}
      {combosAreStale && !isLoading && (
        <div className="flex items-center justify-between rounded-lg border border-mana-multi/30 bg-mana-multi/5 px-4 py-3">
          <p className="text-sm text-mana-multi">{t('core.strategyChanged')}</p>
          <button
            type="button"
            onClick={fetchCombos}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t('core.refreshCombos')}
          </button>
        </div>
      )}

      {/* Combo suggestions */}
      {!isLoading && state.coreCombos.length > 0 && (
        <div className="space-y-3">
          {state.coreCombos.map((combo, i) => (
            <ComboCard
              key={i}
              combo={combo}
              selected={state.selectedComboIndex === i}
              onSelect={() => dispatch({ type: 'SELECT_COMBO', index: i })}
            />
          ))}

          <button
            type="button"
            onClick={fetchCombos}
            disabled={isLoading}
            className="w-full rounded-lg border border-surface-600 py-2 text-sm text-surface-400 hover:border-surface-500 hover:text-surface-200"
          >
            {t('core.suggestDifferent')}
          </button>
        </div>
      )}

      {/* Manual card search */}
      <div className="border-t border-surface-700 pt-4">
        <h3 className="mb-2 text-sm font-medium text-surface-300">{t('core.orSearch')}</h3>
        <SearchInput value={manualSearch} onChange={setManualSearch} placeholder={t('core.searchPlaceholder')} />
        {manualSearching && <p className="mt-2 text-xs text-surface-500">{t('search.searching')}</p>}
        {manualResults.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {manualResults.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  const existingCombo = state.coreCombos.find((c) =>
                    c.cards.some((cc) => cc.scryfallId === card.id),
                  )
                  if (!existingCombo) {
                    const newCombo: CoreCombo = {
                      name: 'Custom: ' + card.name,
                      cards: [{ name: card.name, scryfallId: card.id, scryfallCard: card }],
                      explanation: 'Manually selected card',
                    }
                    const newCombos = [...state.coreCombos, newCombo]
                    dispatch({ type: 'SET_CORE_COMBOS', combos: newCombos })
                    dispatch({ type: 'SELECT_COMBO', index: newCombos.length - 1 })
                  }
                }}
                className="group relative"
              >
                <CardImage card={card} size="small" />
              </button>
            ))}
          </div>
        )}
      </div>

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
