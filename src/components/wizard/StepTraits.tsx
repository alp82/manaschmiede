import { useState } from 'react'
import { TRAITS, getRelevantTraits, type TraitCategory } from '../../lib/trait-mappings'
import { WizardNav } from './WizardNav'
import { useT } from '../../lib/i18n'
import type { ManaColor } from '../ManaSymbol'
import type { ManaColorState, WizardAction } from '../../lib/wizard-state'

interface StepTraitsProps {
  colors: Record<ManaColor, ManaColorState>
  selectedArchetypes: string[]
  selectedTraits: string[]
  customStrategy: string
  budgetLimit: number | null
  rarityFilter: string[]
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack: () => void
}

const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
const RARITY_KEYS: Record<string, string> = {
  common: 'strategy.common',
  uncommon: 'strategy.uncommon',
  rare: 'strategy.rare',
  mythic: 'strategy.mythic',
}

const CATEGORY_KEYS: Record<TraitCategory, string> = {
  archetype: 'strategy.archetypes',
  keyword: 'strategy.combatKeywords',
  mechanic: 'strategy.mechanics',
  tribal: 'strategy.creatureTypes',
}

export function StepTraits({
  colors,
  selectedArchetypes,
  selectedTraits,
  customStrategy,
  budgetLimit,
  rarityFilter,
  dispatch,
  onNext,
  onBack,
}: StepTraitsProps) {
  const t = useT()
  const [showAllTraits, setShowAllTraits] = useState(false)
  const [traitSearch, setTraitSearch] = useState('')

  const activeColors = (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, s]) => s !== 'unselected')
    .map(([c]) => c)

  const archetypes = getRelevantTraits(activeColors, 'archetype')

  // For keywords/mechanics/tribal, show relevant first
  const getTraitsForCategory = (cat: TraitCategory) => {
    const all = getRelevantTraits(activeColors, cat)
    if (traitSearch) {
      return all.filter((tr) => {
        const label = t(`trait.${tr.id}`)
        return label.toLowerCase().includes(traitSearch.toLowerCase())
      })
    }
    if (showAllTraits) return all
    return all.slice(0, 8)
  }

  const hasSelections = selectedArchetypes.length > 0 || selectedTraits.length > 0 || customStrategy.trim().length > 0

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-surface-100">{t('strategy.title')}</h2>
        <p className="mt-2 text-sm text-surface-400">
          {t('strategy.subtitle')}
        </p>
      </div>

      {/* Archetypes (max 2) */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-surface-300">
          {t('strategy.archetypes')} <span className="text-surface-500">{t('strategy.pickUpTo2')}</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {archetypes.map((trait) => {
            const isSelected = selectedArchetypes.includes(trait.id)
            return (
              <button
                key={trait.id}
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_ARCHETYPE', traitId: trait.id })}
                title={t(`trait.desc.${trait.id}`)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-all ${
                  isSelected
                    ? 'bg-accent text-white'
                    : 'bg-surface-700/50 text-surface-300 hover:bg-surface-600/50'
                }`}
              >
                {t(`trait.${trait.id}`)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Trait tags by category */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-surface-300">{t('strategy.traitsThemes')}</h3>
          <input
            type="text"
            value={traitSearch}
            onChange={(e) => setTraitSearch(e.target.value)}
            placeholder={t('strategy.filterPlaceholder')}
            className="ml-auto rounded-lg border border-surface-600 bg-surface-800 px-2 py-1 text-xs text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none"
          />
        </div>

        {(['keyword', 'mechanic', 'tribal'] as TraitCategory[]).map((cat) => {
          const traits = getTraitsForCategory(cat)
          if (traits.length === 0) return null
          return (
            <div key={cat}>
              <h4 className="mb-1.5 text-xs font-medium text-surface-500">{t(CATEGORY_KEYS[cat])}</h4>
              <div className="flex flex-wrap gap-1.5">
                {traits.map((trait) => {
                  const isSelected = selectedTraits.includes(trait.id)
                  return (
                    <button
                      key={trait.id}
                      type="button"
                      onClick={() => dispatch({ type: 'TOGGLE_TRAIT', traitId: trait.id })}
                      title={t(`trait.desc.${trait.id}`)}
                      className={`rounded-md px-2 py-1 text-xs transition-all ${
                        isSelected
                          ? 'bg-accent/80 text-white'
                          : 'bg-surface-700/50 text-surface-400 hover:bg-surface-600/50 hover:text-surface-200'
                      }`}
                    >
                      {t(`trait.${trait.id}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        {!showAllTraits && !traitSearch && (
          <button
            type="button"
            onClick={() => setShowAllTraits(true)}
            className="text-xs text-accent hover:underline"
          >
            {t('strategy.showAllTraits', { count: TRAITS.filter((tr) => tr.category !== 'archetype').length })}
          </button>
        )}
      </div>

      {/* Custom strategy text */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-surface-300">{t('strategy.describeStrategy')}</h3>
        <textarea
          value={customStrategy}
          onChange={(e) => dispatch({ type: 'SET_CUSTOM_STRATEGY', text: e.target.value })}
          placeholder={t('strategy.strategyPlaceholder')}
          rows={3}
          className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none"
        />
      </div>

      {/* Budget + Rarity */}
      <div className="flex gap-6">
        <div className="flex-1">
          <h3 className="mb-2 text-sm font-medium text-surface-300">
            {t('strategy.budgetPerCard')}
            <span className="ml-2 text-surface-500">
              {budgetLimit != null ? `$${budgetLimit}` : t('strategy.unlimited')}
            </span>
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={budgetLimit ?? 100}
              onChange={(e) => {
                const val = parseInt(e.target.value)
                dispatch({ type: 'SET_BUDGET', limit: val >= 100 ? null : val })
              }}
              className="flex-1 accent-accent"
            />
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET_BUDGET', limit: null })}
              className={`rounded px-2 py-0.5 text-xs ${
                budgetLimit == null ? 'bg-accent text-white' : 'bg-surface-700 text-surface-400'
              }`}
            >
              {t('strategy.noLimit')}
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-surface-300">{t('strategy.rarity')}</h3>
          <div className="flex gap-2">
            {RARITIES.map((r) => {
              const isIncluded = rarityFilter.includes(r)
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const next = isIncluded
                      ? rarityFilter.filter((x) => x !== r)
                      : [...rarityFilter, r]
                    if (next.length > 0) dispatch({ type: 'SET_RARITY_FILTER', rarities: next })
                  }}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    isIncluded
                      ? 'bg-accent/20 text-accent'
                      : 'bg-surface-700/50 text-surface-500 hover:text-surface-300'
                  }`}
                >
                  {t(RARITY_KEYS[r])}
                </button>
              )
            })}
          </div>
        </div>
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
            onClick={() => dispatch({ type: 'GO_TO_STEP', step: 4 })}
            className="text-sm text-surface-400 hover:text-surface-200 underline underline-offset-4"
          >
            <span className="sm:hidden">{t('wizard.skip')}</span><span className="hidden sm:inline">{t('strategy.skipLong')}</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasSelections}
            className="rounded-lg bg-accent px-8 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('strategy.nextCoreCards')}
          </button>
        </div>
      </WizardNav>
    </div>
  )
}
