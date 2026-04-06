import { useState } from 'react'
import { TRAITS, getRelevantTraits, getTraitsByCategory, type TraitCategory } from '../../lib/trait-mappings'
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
  onBack?: () => void
  onSkipToDeck?: () => void
}

// Scryfall art_crop URLs for each archetype (iconic cards)
const ARCHETYPE_ART: Record<string, string> = {
  aggro: 'https://cards.scryfall.io/art_crop/front/3/c/3c0f5411-1940-410f-96ce-6f92513f753a.jpg?1599706366',
  midrange: 'https://cards.scryfall.io/art_crop/front/9/0/9011126a-20bd-4c86-a63b-1691f79ac247.jpg?1562790317',
  control: 'https://cards.scryfall.io/art_crop/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1751282477',
  combo: 'https://cards.scryfall.io/art_crop/front/5/8/580fbbf8-ba7e-4889-a5ea-d066f3ea8cea.jpg?1734350261',
  tribal: 'https://cards.scryfall.io/art_crop/front/5/1/513d4c36-6ad4-4ee9-b161-3136eb59504f.jpg?1592761864',
  ramp: 'https://cards.scryfall.io/art_crop/front/6/d/6d5537da-112e-4679-a113-b5d7ce32a66b.jpg?1562850064',
  tokens: 'https://cards.scryfall.io/art_crop/front/8/2/824b2d73-2151-4e5e-9f05-8f63e2bdcaa9.jpg?1730632010',
  voltron: 'https://cards.scryfall.io/art_crop/front/8/9/897a134e-7e61-4fe1-bbae-23ef1fe5c0cf.jpg?1631588878',
  mill: 'https://cards.scryfall.io/art_crop/front/c/5/c54a2256-673d-4d93-9e1d-7790bf254881.jpg?1673148665',
  lifegain: 'https://cards.scryfall.io/art_crop/front/3/2/3245ff74-1f9c-4518-a23f-1579f338f232.jpg?1689995727',
  reanimator: 'https://cards.scryfall.io/art_crop/front/3/6/368b6903-5fc4-43e7-bd44-46b8107c8bb4.jpg?1738000013',
  burn: 'https://cards.scryfall.io/art_crop/front/7/7/77c6fa74-5543-42ac-9ead-0e890b188e99.jpg?1706239968',
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
  onSkipToDeck,
}: StepTraitsProps) {
  const t = useT()
  const [traitSearch, setTraitSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const activeColors = (Object.entries(colors) as [ManaColor, ManaColorState][])
    .filter(([, s]) => s !== 'unselected')
    .map(([c]) => c)

  // Archetypes don't need color filtering since this is now step 1
  const archetypes = getTraitsByCategory('archetype')

  // For keywords/mechanics/tribal, show relevant first if colors are set
  const getTraitsForCategory = (cat: TraitCategory) => {
    const all = activeColors.length > 0 ? getRelevantTraits(activeColors, cat) : getTraitsByCategory(cat)
    if (traitSearch) {
      return all.filter((tr) => {
        const label = t(`trait.${tr.id}`)
        return label.toLowerCase().includes(traitSearch.toLowerCase())
      })
    }
    return all
  }

  const hasSelections = selectedArchetypes.length > 0 || selectedTraits.length > 0 || customStrategy.trim().length > 0

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-surface-100">{t('strategy.title')}</h2>
        <p className="mt-2 text-sm text-surface-400">
          {t('strategy.subtitle')}
        </p>
      </div>

      {/* Archetype hero cards */}
      <div>
        <h3 className="mb-4 text-center text-sm font-medium text-surface-300">
          {t('strategy.archetypes')} <span className="text-surface-500">{t('strategy.pickUpTo2')}</span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {archetypes.map((trait) => {
            const isSelected = selectedArchetypes.includes(trait.id)
            const artUrl = ARCHETYPE_ART[trait.id]
            return (
              <button
                key={trait.id}
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_ARCHETYPE', traitId: trait.id })}
                className={`group relative aspect-[3/2] overflow-hidden rounded-2xl border-2 transition-all ${
                  isSelected
                    ? 'border-accent ring-2 ring-accent ring-offset-2 ring-offset-surface-900'
                    : 'border-transparent hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30'
                }`}
              >
                {/* Art background */}
                <img
                  src={artUrl}
                  alt=""
                  loading="lazy"
                  className={`absolute inset-0 h-full w-full object-cover transition-[filter] duration-[--duration-quick] ${
                    isSelected ? 'brightness-100' : 'brightness-[0.7] group-hover:brightness-[0.85]'
                  }`}
                />

                {/* Gradient scrim */}
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

                {/* Selected checkmark */}
                {isSelected && (
                  <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white" style={{ animation: 'card-enter 150ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
                    ✓
                  </div>
                )}

                {/* Text area */}
                <div className="absolute inset-x-0 bottom-0 p-4 text-left">
                  <div className="font-display text-xl font-bold text-white">
                    {t(`trait.casual.${trait.id}`)}
                  </div>
                  <div className="mt-0.5 text-sm text-surface-300">
                    {t(`trait.desc.${trait.id}`)}
                  </div>
                  {isSelected && (
                    <div className="mt-1 text-xs italic text-surface-400" style={{ animation: 'card-enter 200ms ease-out both' }}>
                      {t(`trait.${trait.id}`)}
                    </div>
                  )}
                </div>
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
                      className={`rounded-md px-3 py-2 text-xs transition-all ${
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

      {/* Advanced: Budget + Rarity (collapsed by default) */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200"
        >
          <span className={`transition-transform duration-[--duration-quick] ${showAdvanced ? 'rotate-90' : ''}`}>▸</span>
          {t('strategy.advanced')}
        </button>
        {showAdvanced && (
          <div className="mt-3 flex gap-6">
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
        )}
      </div>

      <WizardNav>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-surface-600 px-6 py-2.5 text-sm text-surface-300 hover:border-surface-500 hover:text-surface-100"
          >
            {t('wizard.back')}
          </button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          {onSkipToDeck && (
            <button
              type="button"
              onClick={onSkipToDeck}
              className="text-sm text-surface-400 hover:text-surface-200 underline underline-offset-4"
            >
              <span className="sm:hidden">{t('wizard.skip')}</span><span className="hidden sm:inline">{t('strategy.skipLong')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={!hasSelections}
            className="rounded-lg bg-accent px-8 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('strategy.nextColors')}
          </button>
        </div>
      </WizardNav>
    </div>
  )
}
