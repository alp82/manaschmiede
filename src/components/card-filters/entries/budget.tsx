import { RangeSlider } from '../../ui/RangeSlider'
import { useT } from '../../../lib/i18n'
import type { FilterControlProps, FilterSpec } from '../spec'

const BUDGET_SLIDER_MAX = 100

export function formatBudgetRange(
  min: number | null,
  max: number | null,
  unlimitedLabel: string,
): string {
  const minStr = min != null ? `$${min}` : '$0'
  const maxStr = max != null ? `$${max}` : unlimitedLabel
  if (min == null && max == null) return unlimitedLabel
  return `${minStr} – ${maxStr}`
}

/** Price in USD. A bound parked at the end of its track means "no bound". */
export const budgetFilter = {
  id: 'budget' as const,
  labelKey: 'filter.budget',
  ariaLabelKey: 'filter.budget',
  glyph: '$',
  queryRank: 3,
  params: ['bmin', 'bmax'],
  decode: (raw) => ({ budgetMin: raw.bmin, budgetMax: raw.bmax }),
  encode: (slice) => ({ bmin: slice.budgetMin ?? null, bmax: slice.budgetMax ?? null }),
  isActive: (state) => state.budgetMin != null || state.budgetMax != null,
  toQuery: (state) => {
    const parts: string[] = []
    if (state.budgetMin != null) parts.push(`usd>=${state.budgetMin.toFixed(2)}`)
    if (state.budgetMax != null) parts.push(`usd<=${state.budgetMax.toFixed(2)}`)
    return parts
  },
  Control: BudgetControl,
} satisfies FilterSpec

function BudgetControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-col gap-2">
      <span className="font-mono text-mono-tag tabular-nums text-cream-400">
        {formatBudgetRange(state.budgetMin, state.budgetMax, t('filter.noBudget'))}
      </span>
      <RangeSlider
        min={0}
        max={BUDGET_SLIDER_MAX}
        step={1}
        value={[state.budgetMin ?? 0, state.budgetMax ?? BUDGET_SLIDER_MAX]}
        onChange={([nextMin, nextMax]) => {
          onChange({
            budgetMin: nextMin <= 0 ? null : nextMin,
            budgetMax: nextMax >= BUDGET_SLIDER_MAX ? null : nextMax,
          })
        }}
        formatValue={(v) => (v >= BUDGET_SLIDER_MAX ? t('filter.noBudget') : `$${v}`)}
      />
    </div>
  )
}
