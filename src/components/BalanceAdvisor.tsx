import type { BalanceAnalysis } from '../lib/balance'
import { manaSymbolUrl, type ManaColor } from './ManaSymbol'
import { ManaCost } from './ManaCost'
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

const SEVERITY_STYLES = {
  error: 'border-l-2 border-mana-red bg-mana-red/10 text-mana-red',
  warning: 'border-l-2 border-mana-multi bg-mana-multi/10 text-mana-multi',
  info: 'border-l-2 border-mana-blue bg-mana-blue/10 text-mana-blue',
}

export function BalanceAdvisor({ analysis, activeTypeFilter, activeColorFilter, activeCmcFilter, onFilterByType, onFilterByColor, onFilterByCmc }: BalanceAdvisorProps) {
  const t = useT()
  if (!analysis) return null

  const errorCount = analysis.warnings.filter((w) => w.severity === 'error').length
  const warnCount = analysis.warnings.filter((w) => w.severity === 'warning').length
  const maxCurve = Math.max(...analysis.manaCurve.map((e) => e.count), 1)
  const healthColor = errorCount > 0 ? 'text-mana-red' : warnCount > 0 ? 'text-mana-multi' : 'text-mana-green'

  return (
    <div className="space-y-4 rounded-xl border border-surface-700 bg-surface-800/50 p-4">
      {/* Header stats row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {analysis.colorDistribution.map(({ color }) => (
            MANA_COLOR_SET.has(color)
              ? <img key={color} src={manaSymbolUrl(color as ManaColor)} alt={color} className="h-5 w-5" />
              : <div key={color} className="h-4 w-4 rounded-full bg-surface-600" />
          ))}
        </div>
        <span className={`text-sm font-bold ${healthColor}`}>
          {analysis.maindeckSize} / 60
        </span>
      </div>

      {/* Key stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox label={t('balance.lands')} value={analysis.landCount} target="22-26" />
        <StatBox label={t('balance.spells')} value={analysis.nonLandCount} target="34-38" />
        <StatBox label={t('balance.avgCmc')} value={analysis.averageCmc.toFixed(1)} />
      </div>

      {/* Mana Curve */}
      <div>
        <h4 className="mb-2 text-xs font-medium text-surface-400">{t('balance.manaCurve')}</h4>
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
                className={`flex flex-1 flex-col items-center gap-0.5 rounded transition-colors ${
                  isClickable ? 'cursor-pointer hover:bg-surface-700/50' : ''
                } ${isActive ? 'bg-surface-700/70' : ''}`}
              >
                {entry.count > 0 && (
                  <span className="text-[9px] font-medium text-surface-300">{entry.count}</span>
                )}
                <div
                  className={`w-full rounded-t transition-all ${isActive ? 'bg-accent' : 'bg-accent/60'}`}
                  style={{ height: `${barHeight}px`, minHeight: entry.count > 0 ? '4px' : '0' }}
                />
                <span className={`text-[10px] ${isActive ? 'font-medium text-accent' : 'text-surface-500'}`}>
                  {entry.cmc === 7 ? '7+' : entry.cmc}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Color Distribution */}
      {analysis.colorDistribution.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-surface-400">{t('balance.colorDist')}</h4>
          <div className="space-y-1.5">
            {analysis.colorDistribution.map(({ color, count }) => {
              const pct = analysis.nonLandCount > 0 ? (count / analysis.nonLandCount) * 100 : 0
              const isActive = activeColorFilter === color
              const isClickable = !!onFilterByColor && MANA_COLOR_SET.has(color)
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => isClickable && onFilterByColor!(isActive ? null : color)}
                  className={`flex items-center gap-2 rounded px-1 -mx-1 transition-colors ${
                    isClickable ? 'hover:bg-surface-700/50 cursor-pointer' : ''
                  } ${isActive ? 'bg-surface-700/70' : ''}`}
                >
                  {MANA_COLOR_SET.has(color)
                    ? <img src={manaSymbolUrl(color as ManaColor)} alt={color} className="h-4 w-4 flex-shrink-0" />
                    : <div className="h-4 w-4 flex-shrink-0 rounded-full bg-surface-600" />
                  }
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-700">
                      <div
                        className="h-full rounded-full bg-accent/70 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-6 text-right text-[10px] font-medium text-surface-300">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Card Type Breakdown */}
      {analysis.cardTypeBreakdown.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-surface-400">{t('balance.cardTypes')}</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {analysis.cardTypeBreakdown.map(({ type, count }) => {
              const isActive = activeTypeFilter === type.toLowerCase()
              const isClickable = !!onFilterByType
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => isClickable && onFilterByType!(isActive ? null : type.toLowerCase())}
                  className={`flex items-center justify-between rounded px-1 -mx-1 transition-colors ${
                    isClickable ? 'hover:bg-surface-700/50 cursor-pointer' : ''
                  } ${isActive ? 'bg-surface-700/70' : ''}`}
                >
                  <span className="text-xs text-surface-400">{type}</span>
                  <span className="text-xs font-medium text-surface-200">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Land Color Support */}
      {analysis.landColorDistribution.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-surface-400">{t('balance.landColors')}</h4>
          <div className="flex gap-3">
            {analysis.landColorDistribution.map(({ color, count }) => (
              <div key={color} className="flex items-center gap-1">
                {MANA_COLOR_SET.has(color)
                  ? <img src={manaSymbolUrl(color as ManaColor)} alt={color} className="h-4 w-4" />
                  : <div className="h-3 w-3 rounded-full bg-surface-600" />
                }
                <span className="text-xs font-medium text-surface-200">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {analysis.warnings.length > 0 && (
        <div className="space-y-1.5">
          {analysis.warnings.map((w, i) => (
            <div
              key={i}
              className={`rounded-md px-2.5 py-1.5 text-xs ${SEVERITY_STYLES[w.severity]}`}
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {analysis.suggestions.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-surface-400">{t('balance.suggestions')}</h4>
          {analysis.suggestions.map((s, i) => (
            <div key={i} className="rounded-md border-l-2 border-mana-green bg-mana-green/10 px-2.5 py-1.5 text-xs text-mana-green">
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, target }: { label: string; value: string | number; target?: string }) {
  return (
    <div className="rounded-lg bg-surface-700/30 px-3 py-2 text-center">
      <div className="text-lg font-bold text-surface-100">{value}</div>
      <div className="text-[10px] text-surface-500">
        {label}
        {target && <span className="text-surface-600"> ({target})</span>}
      </div>
    </div>
  )
}
