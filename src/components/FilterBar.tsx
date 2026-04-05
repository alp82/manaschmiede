import { ManaSymbol, type ManaColor } from './ManaSymbol'
import { useT } from '../lib/i18n'
import type { DeckFormat } from '../lib/deck-utils'

const CARD_TYPE_KEYS = [
  { value: '', key: 'filter.allTypes' },
  { value: 'creature', key: 'filter.creature' },
  { value: 'instant', key: 'filter.instant' },
  { value: 'sorcery', key: 'filter.sorcery' },
  { value: 'enchantment', key: 'filter.enchantment' },
  { value: 'artifact', key: 'filter.artifact' },
  { value: 'land', key: 'filter.land' },
]

const CMC_OPTIONS = [
  { value: '', key: 'filter.allCmc' },
  { value: '0', key: '' },
  { value: '1', key: '' },
  { value: '2', key: '' },
  { value: '3', key: '' },
  { value: '4', key: '' },
  { value: '5', key: '' },
  { value: '6', key: '' },
  { value: '7+', key: '' },
]

const FORMAT_OPTIONS: { value: DeckFormat | ''; key: string }[] = [
  { value: '', key: 'filter.allFormats' },
  { value: 'standard', key: '' },
  { value: 'modern', key: '' },
  { value: 'casual', key: '' },
]

const BUDGET_OPTIONS = [
  { value: '', label: '' },
  { value: '1', label: '$1' },
  { value: '5', label: '$5' },
  { value: '10', label: '$10' },
  { value: '25', label: '$25' },
  { value: '50', label: '$50' },
]

const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
const RARITY_KEYS: Record<string, string> = {
  common: 'strategy.common',
  uncommon: 'strategy.uncommon',
  rare: 'strategy.rare',
  mythic: 'strategy.mythic',
}

const KEYWORD_OPTIONS = [
  { value: '', key: 'filter.allKeywords' },
  { value: 'flying', key: 'trait.flying' },
  { value: 'trample', key: 'trait.trample' },
  { value: 'deathtouch', key: 'trait.deathtouch' },
  { value: 'lifelink', key: 'trait.lifelink' },
  { value: 'first_strike', key: 'trait.first-strike' },
  { value: 'double_strike', key: 'trait.double-strike' },
  { value: 'vigilance', key: 'trait.vigilance' },
  { value: 'haste', key: 'trait.haste' },
  { value: 'hexproof', key: 'trait.hexproof' },
  { value: 'menace', key: 'trait.menace' },
  { value: 'reach', key: 'trait.reach' },
  { value: 'flash', key: 'trait.flash' },
  { value: 'ward', key: 'trait.ward' },
  { value: 'indestructible', key: 'trait.indestructible' },
]

interface FilterBarProps {
  selectedColors: Set<ManaColor>
  onToggleColor: (color: ManaColor) => void
  cardType: string
  onCardTypeChange: (type: string) => void
  cmc: string
  onCmcChange: (cmc: string) => void
  format: string
  onFormatChange: (format: string) => void
  budget: string
  onBudgetChange: (budget: string) => void
  selectedRarities: Set<string>
  onToggleRarity: (rarity: string) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
}

const selectClass = 'rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 focus:border-accent focus:outline-none'

export function FilterBar({
  selectedColors,
  onToggleColor,
  cardType,
  onCardTypeChange,
  cmc,
  onCmcChange,
  format,
  onFormatChange,
  budget,
  onBudgetChange,
  selectedRarities,
  onToggleRarity,
  keyword,
  onKeywordChange,
}: FilterBarProps) {
  const t = useT()

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Mana color toggles */}
      <div className="flex items-center gap-1.5">
        {(['W', 'U', 'B', 'R', 'G'] as const).map((color) => (
          <ManaSymbol
            key={color}
            color={color}
            selected={selectedColors.has(color)}
            onClick={() => onToggleColor(color)}
          />
        ))}
      </div>

      {/* Card type */}
      <select
        value={cardType}
        onChange={(e) => onCardTypeChange(e.target.value)}
        className={selectClass}
      >
        {CARD_TYPE_KEYS.map((ct) => (
          <option key={ct.value} value={ct.value}>
            {ct.key ? t(ct.key) : ct.value}
          </option>
        ))}
      </select>

      {/* CMC */}
      <select
        value={cmc}
        onChange={(e) => onCmcChange(e.target.value)}
        className={selectClass}
      >
        {CMC_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.key ? t(c.key) : c.value}
          </option>
        ))}
      </select>

      {/* Format */}
      <select
        value={format}
        onChange={(e) => onFormatChange(e.target.value)}
        className={selectClass}
      >
        {FORMAT_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.key ? t(f.key) : f.value.charAt(0).toUpperCase() + f.value.slice(1)}
          </option>
        ))}
      </select>

      {/* Keyword */}
      <select
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        className={selectClass}
      >
        {KEYWORD_OPTIONS.map((kw) => (
          <option key={kw.value} value={kw.value}>
            {t(kw.key)}
          </option>
        ))}
      </select>

      {/* Budget */}
      <select
        value={budget}
        onChange={(e) => onBudgetChange(e.target.value)}
        className={selectClass}
      >
        <option value="">{t('filter.noBudget')}</option>
        {BUDGET_OPTIONS.filter((b) => b.value).map((b) => (
          <option key={b.value} value={b.value}>
            ≤ {b.label}
          </option>
        ))}
      </select>

      {/* Rarity toggles */}
      <div className="flex items-center gap-1">
        {RARITIES.map((r) => {
          const isSelected = selectedRarities.has(r)
          return (
            <button
              key={r}
              type="button"
              onClick={() => onToggleRarity(r)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                isSelected
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
  )
}
