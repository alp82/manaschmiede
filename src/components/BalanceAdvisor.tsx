import type { BalanceAnalysis } from '../lib/balance'
import { manaSymbolUrl, type ManaColor } from './ManaSymbol'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

interface BalanceAdvisorProps {
  analysis: BalanceAnalysis | null
  activeTypeFilter?: string | null
  activeColorFilter?: string | null
  activeCmcFilter?: number | null
  onFilterByType?: (type: string | null) => void
  onFilterByColor?: (color: string | null) => void
  onFilterByCmc?: (cmc: number | null) => void
}

const MANA_COLOR_SET = new Set<string>(['W', 'U', 'B', 'R', 'G'])
const COLORLESS_SYMBOL_URL = 'https://svgs.scryfall.io/card-symbols/C.svg'

/**
 * Card type labels produced by balance.ts are always English (they come
 * from a hardcoded switch on the Scryfall type line). Map them to filter.*
 * i18n keys so the BalanceAdvisor breakdown renders in the active locale.
 */
const TYPE_I18N_KEY: Record<string, string> = {
  Creature: 'filter.creature',
  Instant: 'filter.instant',
  Sorcery: 'filter.sorcery',
  Enchantment: 'filter.enchantment',
  Artifact: 'filter.artifact',
  Planeswalker: 'filter.planeswalker',
  Land: 'filter.land',
}

/**
 * Specimen severity treatment — left-edge slab + tinted body.
 * Error: ink-red, Warning: warm cream on ash, Info: hairline on ash.
 */
const SEVERITY_STYLES: Record<string, string> = {
  error: 'border-l-2 border-ink-red bg-ash-800/60 text-ink-red-bright',
  warning: 'border-l-2 border-cream-300 bg-ash-800/60 text-cream-200',
  info: 'border-l-2 border-hairline-strong bg-ash-800/40 text-cream-300',
}

/**
 * Specimen balance advisor — a framed statistical ledger.
 *
 * Hairline-bordered panel. Mono-marginal section headers, tabular mono
 * numerals, hairline dividers between sections. Mana curve renders as
 * a flat-cream bar chart (ink-red on the active bar). Color distribution
 * uses hairline tracks with cream fills. Severity slabs replace bubbles.
 */
export function BalanceAdvisor({
  analysis,
  activeTypeFilter,
  activeColorFilter,
  activeCmcFilter,
  onFilterByType,
  onFilterByColor,
  onFilterByCmc,
}: BalanceAdvisorProps) {
  const t = useT()
  if (!analysis) return null

  const errorCount = analysis.warnings.filter((w) => w.severity === 'error').length
  const warnCount = analysis.warnings.filter((w) => w.severity === 'warning').length
  const maxCurve = Math.max(...analysis.manaCurve.map((e) => e.count), 1)

  const healthClass = errorCount > 0 ? 'text-ink-red-bright' : warnCount > 0 ? 'text-cream-200' : 'text-cream-100'

  return (
    <div className="divide-y divide-hairline/60 border border-hairline bg-ash-800/40">
      {/* Header stats row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {analysis.colorDistribution.map(({ color }) => (
            <img
              key={color}
              src={MANA_COLOR_SET.has(color) ? manaSymbolUrl(color as ManaColor) : COLORLESS_SYMBOL_URL}
              alt={color}
              className="h-5 w-5"
            />
          ))}
        </div>
        <span className={cn('font-mono text-mono-num tabular-nums', healthClass)}>
          {analysis.maindeckSize} / 60
        </span>
      </div>

      {/* Key stats grid */}
      <div className="grid grid-cols-3 divide-x divide-hairline/60">
        <StatBox label={t('balance.lands')} value={analysis.landCount} target="22-26" />
        <StatBox label={t('balance.spells')} value={analysis.nonLandCount} target="34-38" />
        <StatBox label={t('balance.avgCmc')} value={analysis.averageCmc.toFixed(1)} />
      </div>

      {/* Mana Curve */}
      <div className="px-4 py-4">
        <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
          {t('balance.manaCurve')}
        </h4>
        <div className="flex items-end gap-1">
          {analysis.manaCurve.map((entry) => {
            const barHeight = maxCurve > 0 ? Math.round((entry.count / maxCurve) * 48) : 0
            const isActive = activeCmcFilter === entry.cmc
            const isClickable = !!onFilterByCmc && entry.count > 0
            return (
              <button
                key={entry.cmc}
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onFilterByCmc!(isActive ? null : entry.cmc)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 px-0.5 transition-colors',
                  isClickable && 'cursor-pointer hover:bg-ash-700/40',
                  isActive && 'bg-ash-700/60',
                )}
              >
                {entry.count > 0 && (
                  <span className="font-mono text-mono-marginal tabular-nums text-cream-300">
                    {entry.count}
                  </span>
                )}
                <div
                  className={cn('w-full transition-colors', isActive ? 'bg-ink-red' : 'bg-cream-300')}
                  style={{ height: `${barHeight}px`, minHeight: entry.count > 0 ? '2px' : '0' }}
                />
                <span
                  className={cn(
                    'font-mono text-mono-marginal tabular-nums',
                    isActive ? 'text-ink-red-bright' : 'text-cream-500',
                  )}
                >
                  {entry.cmc === 7 ? '7+' : entry.cmc}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Color Distribution */}
      {analysis.colorDistribution.length > 0 && (
        <div className="px-4 py-4">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('balance.colorDist')}
          </h4>
          <div className="space-y-1">
            {analysis.colorDistribution.map(({ color, count }) => {
              const pct = analysis.nonLandCount > 0 ? (count / analysis.nonLandCount) * 100 : 0
              const isActive = activeColorFilter === color
              const isClickable = !!onFilterByColor && MANA_COLOR_SET.has(color)
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => isClickable && onFilterByColor!(isActive ? null : color)}
                  className={cn(
                    'relative flex w-full items-center gap-3 px-2 py-1.5 transition-colors',
                    isClickable && 'cursor-pointer hover:bg-ash-700/30',
                  )}
                >
                  {/* Background distribution bar */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-300',
                      isActive ? 'bg-ink-red/40' : 'bg-cream-300/15',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                  <img
                    src={MANA_COLOR_SET.has(color) ? manaSymbolUrl(color as ManaColor) : COLORLESS_SYMBOL_URL}
                    alt={color}
                    className="relative h-4 w-4 flex-shrink-0"
                  />
                  <span className="relative ml-auto font-mono text-mono-tag tabular-nums text-cream-200">
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Card Type Breakdown */}
      {analysis.cardTypeBreakdown.length > 0 && (
        <div className="px-4 py-4">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('balance.cardTypes')}
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {analysis.cardTypeBreakdown.map(({ type, count }) => {
              const isActive = activeTypeFilter === type.toLowerCase()
              const isClickable = !!onFilterByType
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => isClickable && onFilterByType!(isActive ? null : type.toLowerCase())}
                  className={cn(
                    'flex items-center justify-between px-2 py-1 transition-colors',
                    isClickable && 'cursor-pointer hover:bg-ash-700/30',
                    isActive && 'bg-ink-red/20',
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-mono-tag uppercase tracking-mono-tag',
                      isActive ? 'text-ink-red-bright' : 'text-cream-400',
                    )}
                  >
                    {TYPE_I18N_KEY[type] ? t(TYPE_I18N_KEY[type]) : type}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-mono-tag tabular-nums',
                      isActive ? 'text-ink-red-bright' : 'text-cream-100',
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {analysis.warnings.length > 0 && (
        <div className="space-y-2 px-4 py-4">
          {analysis.warnings.map((w, i) => (
            <div
              key={i}
              className={cn('px-3 py-2 font-body text-sm', SEVERITY_STYLES[w.severity])}
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {analysis.suggestions.length > 0 && (
        <div className="px-4 py-4">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('balance.suggestions')}
          </h4>
          <div className="space-y-2">
            {analysis.suggestions.map((s, i) => (
              <div
                key={i}
                className="border-l-2 border-hairline-strong bg-ash-800/40 px-3 py-2 font-body text-sm text-cream-300"
              >
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({
  label,
  value,
  target,
}: {
  label: string
  value: string | number
  target?: string
}) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="font-display text-2xl font-bold tabular-nums text-cream-100">{value}</div>
      <div className="mt-1 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
        {label}
        {target && <span className="ml-1 text-cream-500/70"> ({target})</span>}
      </div>
    </div>
  )
}
