import { useState } from 'react'
import { TRAITS, getRelevantTraits, getTraitsByCategory, type TraitCategory } from '../../lib/trait-mappings'
import { useDeckSounds } from '../../lib/sounds'
import { WizardNav } from './WizardNav'
import { Pill } from '../ui/Pill'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { RangeSlider } from '../ui/RangeSlider'
import { HighlightText } from '../HighlightText'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import type { ManaColor } from '../ManaSymbol'
import type { ManaColorState, WizardAction } from '../../lib/wizard-state'
import type { DeckFormat } from '../../lib/deck-utils'

interface StepTraitsProps {
  colors: Record<ManaColor, ManaColorState>
  selectedArchetypes: string[]
  selectedTraits: string[]
  customStrategy: string
  budgetMin: number | null
  budgetMax: number | null
  rarityFilter: string[]
  format: DeckFormat
  dispatch: React.Dispatch<WizardAction>
  onNext: () => void
  onBack?: () => void
  onSkipToDeck?: () => void
  onReset: () => void
}

function formatBudgetRange(
  min: number | null,
  max: number | null,
  unlimitedLabel: string,
): string {
  const minStr = min != null ? `$${min}` : '$0'
  const maxStr = max != null ? `$${max}` : unlimitedLabel
  if (min == null && max == null) return unlimitedLabel
  return `${minStr} \u2013 ${maxStr}`
}

const FORMATS: { value: DeckFormat; key: string }[] = [
  { value: 'casual', key: 'colors.formatCasual' },
  { value: 'modern', key: 'colors.formatModern' },
  { value: 'standard', key: 'colors.formatStandard' },
]

// Scryfall art_crop URLs for each archetype (iconic cards)
export const ARCHETYPE_ART: Record<string, string> = {
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
  goodstuff: 'https://cards.scryfall.io/art_crop/front/6/8/68625010-3e4e-4400-b503-bf381a7fd81b.jpg',
  sacrifice: 'https://cards.scryfall.io/art_crop/front/2/8/282099f3-e2a7-470d-8097-b6cc247eb033.jpg',
  drain: 'https://cards.scryfall.io/art_crop/front/0/7/0783365b-c54f-471e-bdf2-1f384e065a48.jpg',
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
  budgetMin,
  budgetMax,
  rarityFilter,
  format,
  dispatch,
  onNext,
  onBack,
  onSkipToDeck,
  onReset,
}: StepTraitsProps) {
  const t = useT()
  const [traitSearch, setTraitSearch] = useState('')
  const sounds = useDeckSounds()
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
    <section className="relative">
      <div className="mx-auto max-w-4xl space-y-16 px-4 pb-24 pt-16">
        {/* Section header */}
        <header className="flex flex-col items-center text-center">
          <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-400">
            Chapter I
          </span>
          <h2 className="mt-4 font-display text-display-title leading-[1.1] tracking-display text-cream-100">
            {t('strategy.title')}
          </h2>
          <p className="mt-4 max-w-md font-body text-base text-cream-300">
            {t('strategy.subtitle')}
          </p>
        </header>

        {/* Archetype hero cards */}
        <div className="mt-16">
          <div className="mb-6 flex items-center justify-center gap-3">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-200">
              {t('strategy.archetypes')}
            </span>
            <span className="font-mono text-mono-tag tracking-mono-tag text-cream-400">
              {t('strategy.pickUpToLimit')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archetypes.map((trait, i) => {
              const isSelected = selectedArchetypes.includes(trait.id)
              const artUrl = ARCHETYPE_ART[trait.id]
              const letterIndex = String.fromCharCode(97 + i) // a, b, c…
              return (
                <button
                  key={trait.id}
                  type="button"
                  onClick={() => {
                    const wouldBeNoOp = !isSelected && selectedArchetypes.length >= 3
                    dispatch({ type: 'TOGGLE_ARCHETYPE', traitId: trait.id })
                    if (!wouldBeNoOp) sounds.cardSlide()
                  }}
                  className={cn(
                    'group relative aspect-[3/2] cursor-pointer overflow-hidden border transition-colors duration-150',
                    isSelected
                      ? 'border-cream-100 outline outline-2 -outline-offset-2 outline-cream-100'
                      : 'border-hairline opacity-60 hover:border-hairline-strong hover:opacity-90',
                  )}
                >
                  {/* Art background — card art gets painterly treatment
                      (specimen exception mirrors foil-shimmer rule).
                      Selected cards render at full brightness; unselected
                      ones are dimmed via `opacity-60` on the button
                      wrapper so the selected cards "light up" against
                      faded neighbours. */}
                  <img
                    src={artUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />

                  {/* Soft ink scrim — gradient fade so the text base blends
                      into the art instead of cutting it with a hard line.
                      This is a card-art exception to the no-gradients rule. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[70%]"
                    style={{
                      background:
                        'linear-gradient(to top, oklch(0.14 0.008 55 / 0.95) 0%, oklch(0.14 0.008 55 / 0.8) 45%, oklch(0.14 0.008 55 / 0) 100%)',
                    }}
                  />

                  {/* Selected slab — thick cream bar on the LEFT edge,
                      combined with the cream outline above for a loud
                      "this is selected" signal. */}
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-2 bg-cream-100"
                    />
                  )}

                  {/* Marginal letter-index (catalog entry feel) */}
                  <span
                    aria-hidden="true"
                    className="absolute left-3 top-2 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-200/80"
                  >
                    {letterIndex}
                  </span>

                  {/* Selection checkbox — empty when not selected (a hint
                      that the card is selectable), cream-filled X when
                      selected. */}
                  <Checkbox
                    checked={isSelected}
                    className="absolute right-2 top-2"
                  />

                  {/* Text area */}
                  <div className="absolute inset-x-0 bottom-0 p-4 pl-5 text-left">
                    <div className="font-display text-xl font-bold uppercase leading-tight tracking-display text-cream-100">
                      {t(`trait.${trait.id}`)}
                    </div>
                    <div className="mt-1 font-body text-sm text-cream-300">
                      {t(`trait.desc.${trait.id}`)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

      {/* Trait tags by category */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-200">
            {t('strategy.traitsThemes')}
          </span>
          <input
            type="text"
            value={traitSearch}
            onChange={(e) => setTraitSearch(e.target.value)}
            onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
            placeholder={t('strategy.filterPlaceholder')}
            className="ml-auto border border-hairline-strong bg-ash-800 px-3 py-2 font-mono text-mono-label text-cream-100 placeholder-cream-400 focus:border-cream-200 focus:outline-none"
          />
        </div>

        {(['keyword', 'mechanic', 'tribal'] as TraitCategory[]).map((cat) => {
          const traits = getTraitsForCategory(cat)
          if (traits.length === 0) return null
          return (
            <div key={cat}>
              <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                {t(CATEGORY_KEYS[cat])}
              </h4>
              <div className="flex flex-wrap gap-2">
                {traits.map((trait) => {
                  const isSelected = selectedTraits.includes(trait.id)
                  return (
                    <Pill
                      key={trait.id}
                      size="md"
                      selected={isSelected}
                      title={t(`trait.desc.${trait.id}`)}
                      onClick={() => { dispatch({ type: 'TOGGLE_TRAIT', traitId: trait.id }); sounds.uiClick() }}
                    >
                      <HighlightText text={t(`trait.${trait.id}`)} term={traitSearch} />
                    </Pill>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Custom strategy text */}
      <div>
        <h3 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-200">
          {t('strategy.describeStrategy')}
        </h3>
        <textarea
          value={customStrategy}
          onChange={(e) => dispatch({ type: 'SET_CUSTOM_STRATEGY', text: e.target.value })}
          onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
          placeholder={t('strategy.strategyPlaceholder')}
          rows={3}
          className="w-full resize-none border border-hairline-strong bg-ash-800 px-3 py-2.5 font-body text-base text-cream-100 placeholder-cream-400 focus:border-cream-200 focus:outline-none"
        />
      </div>

      {/* Advanced: Budget + Rarity (collapsed by default) */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-colors hover:text-cream-100"
        >
          <span aria-hidden="true">{showAdvanced ? '\u2212' : '+'}</span>
          {t('strategy.advanced')}
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-6">
            {/* Budget per card — double-range slider (min + max) */}
            <div>
              <h3 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                {t('strategy.budgetPerCard')}
                <span className="ml-2 font-body text-sm normal-case tracking-normal text-cream-500">
                  {formatBudgetRange(budgetMin, budgetMax, t('strategy.unlimited'))}
                </span>
              </h3>
              <RangeSlider
                min={0}
                max={100}
                step={1}
                value={[budgetMin ?? 0, budgetMax ?? 100]}
                onChange={([nextMin, nextMax]) => {
                  dispatch({
                    type: 'SET_BUDGET',
                    min: nextMin <= 0 ? null : nextMin,
                    max: nextMax >= 100 ? null : nextMax,
                  })
                }}
                formatValue={(v) => (v >= 100 ? t('strategy.unlimited') : `$${v}`)}
              />
            </div>

            {/* Rarity — full-width row */}
            <div>
              <h3 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                {t('strategy.rarity')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {RARITIES.map((r) => {
                  const isIncluded = rarityFilter.includes(r)
                  return (
                    <Pill
                      key={r}
                      size="sm"
                      selected={isIncluded}
                      onClick={() => {
                        const next = isIncluded
                          ? rarityFilter.filter((x) => x !== r)
                          : [...rarityFilter, r]
                        if (next.length > 0) dispatch({ type: 'SET_RARITY_FILTER', rarities: next })
                      }}
                    >
                      {t(RARITY_KEYS[r])}
                    </Pill>
                  )
                })}
              </div>
            </div>

            {/* Format selector — moved from the Colors step */}
            <div>
              <h3 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                {t('colors.format')}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {FORMATS.map((f) => (
                  <Pill
                    key={f.value}
                    size="sm"
                    selected={format === f.value}
                    onClick={() => dispatch({ type: 'SET_FORMAT', format: f.value })}
                  >
                    {t(f.key)}
                  </Pill>
                ))}
              </div>
              <p className="mt-2 font-body text-sm italic text-cream-400">
                {format === 'casual' && t('colors.descCasual')}
                {format === 'modern' && t('colors.descModern')}
                {format === 'standard' && t('colors.descStandard')}
              </p>
            </div>
          </div>
        )}
      </div>

      <WizardNav>
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="secondary" size="lg" onClick={onBack}>
              {t('wizard.back')}
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={onReset}>
            {t('wizard.reset')}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {onSkipToDeck && (
            <Button variant="ghost" size="md" onClick={onSkipToDeck}>
              <span className="sm:hidden">{t('wizard.skip')}</span>
              <span className="hidden sm:inline">{t('strategy.skipLong')}</span>
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={onNext} disabled={!hasSelections}>
            {t('strategy.nextColors')}
          </Button>
        </div>
      </WizardNav>
      </div>
    </section>
  )
}
