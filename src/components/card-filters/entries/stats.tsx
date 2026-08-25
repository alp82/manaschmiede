import { useState } from 'react'
import { RangeSlider } from '../../ui/RangeSlider'
import { HoverTooltip } from '../../ui/HoverTooltip'
import { Pill } from '../../ui/Pill'
import { useT } from '../../../lib/i18n'
import type { FilterControlProps, FilterSlice, FilterSpec } from '../spec'

const STAT_SLIDER_MAX = 12

export function formatStatRange(
  min: number | null,
  max: number | null,
  sliderMax: number,
  anyLabel: string,
): string {
  if (min == null && max == null) return anyLabel
  const minStr = min != null ? `${min}` : '0'
  const maxStr = max != null ? `${max}` : `${sliderMax}+`
  return `${minStr} – ${maxStr}`
}

/**
 * Power and toughness on one control.
 *
 * This is the filter that used to need an escape-hatch prop
 * (`onPowerAndToughnessChange`): in LINKED mode one drag has to write four URL
 * params in a single patch. A slice is the whole filter, so the atomic write is
 * simply what `onChange` does — no special case survives.
 */
export const statsFilter = {
  id: 'stats' as const,
  labelKey: 'filter.stats',
  ariaLabelKey: 'filter.stats',
  glyph: '⚔',
  fullWidth: true,
  queryRank: 6,
  params: ['pmin', 'pmax', 'tmin', 'tmax'],
  decode: (raw) => ({
    powerMin: raw.pmin,
    powerMax: raw.pmax,
    toughnessMin: raw.tmin,
    toughnessMax: raw.tmax,
  }),
  encode: (slice) => ({
    pmin: slice.powerMin ?? null,
    pmax: slice.powerMax ?? null,
    tmin: slice.toughnessMin ?? null,
    tmax: slice.toughnessMax ?? null,
  }),
  isActive: (state) =>
    state.powerMin != null ||
    state.powerMax != null ||
    state.toughnessMin != null ||
    state.toughnessMax != null,
  toQuery: (state) => {
    const parts: string[] = []
    if (state.powerMin != null) parts.push(`pow>=${state.powerMin}`)
    if (state.powerMax != null) parts.push(`pow<=${state.powerMax}`)
    if (state.toughnessMin != null) parts.push(`tou>=${state.toughnessMin}`)
    if (state.toughnessMax != null) parts.push(`tou<=${state.toughnessMax}`)
    return parts
  },
  Control: StatsControl,
} satisfies FilterSpec

/**
 * `linked` is deliberately component state, not URL state: it is a way of
 * driving the two sliders, not a property of the search. It therefore resets to
 * linked when the filter is removed and re-added, and does not travel in a
 * shared link.
 */
function StatsControl({ state, onChange, ariaLabel }: FilterControlProps) {
  const t = useT()
  const [linked, setLinked] = useState(true)

  function write(slice: FilterSlice) {
    onChange({
      powerMin: state.powerMin,
      powerMax: state.powerMax,
      toughnessMin: state.toughnessMin,
      toughnessMax: state.toughnessMax,
      ...slice,
    })
  }

  function handlePowerChange(min: number | null, max: number | null) {
    if (linked) write({ powerMin: min, powerMax: max, toughnessMin: min, toughnessMax: max })
    else write({ powerMin: min, powerMax: max })
  }

  function handleToughnessChange(min: number | null, max: number | null) {
    if (linked) write({ powerMin: min, powerMax: max, toughnessMin: min, toughnessMax: max })
    else write({ toughnessMin: min, toughnessMax: max })
  }

  // Mirrored stereo sliders with the LINKED yoke pulled out to the side.
  // Labels sit above POWER and below TOUGHNESS (reflected around the
  // centerline between the two tracks), and the link button lives in its
  // own column on the right, vertically centered against the slider stack.
  // Compresses the whole control to ~4 tight rows.
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
            {t('filter.power')}
          </span>
          <span className="font-mono text-mono-tag tabular-nums text-cream-500">
            {formatStatRange(state.powerMin, state.powerMax, STAT_SLIDER_MAX, t('filter.anyPower'))}
          </span>
        </div>
        <StatSlider min={state.powerMin} max={state.powerMax} onChange={handlePowerChange} />
        <StatSlider
          min={state.toughnessMin}
          max={state.toughnessMax}
          onChange={handleToughnessChange}
        />
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
            {t('filter.toughness')}
          </span>
          <span className="font-mono text-mono-tag tabular-nums text-cream-500">
            {formatStatRange(
              state.toughnessMin,
              state.toughnessMax,
              STAT_SLIDER_MAX,
              t('filter.anyToughness'),
            )}
          </span>
        </div>
      </div>

      {/* The yoke is a toggle, so it is a <Pill>, not a hand-rolled button: a
          selected toggle inverts to cream fill + ash glyph + ink-red border.
          It used to take the ink-red FILL, which is the primary-CTA look. Only
          the square hit area is overridden, so the rest stays the primitive. */}
      <HoverTooltip hint={linked ? t('filter.statsLinkedHint') : t('filter.statsUnlinkedHint')}>
        <Pill
          selected={linked}
          onClick={() => setLinked((l) => !l)}
          aria-label={linked ? t('filter.statsLinked') : t('filter.statsUnlinked')}
          className="h-10 w-10 shrink-0 p-0"
        >
          <span aria-hidden="true" className="text-xl leading-none">{linked ? '⇌' : '⇵'}</span>
        </Pill>
      </HoverTooltip>
    </div>
  )
}

function StatSlider({
  min,
  max,
  onChange,
}: {
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}) {
  return (
    <RangeSlider
      min={0}
      max={STAT_SLIDER_MAX}
      step={1}
      value={[min ?? 0, max ?? STAT_SLIDER_MAX]}
      onChange={([nextMin, nextMax]) => {
        onChange(nextMin <= 0 ? null : nextMin, nextMax >= STAT_SLIDER_MAX ? null : nextMax)
      }}
    />
  )
}
