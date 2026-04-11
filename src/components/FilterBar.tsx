import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ManaSymbol, type ManaColor } from './ManaSymbol'
import { Pill } from './ui/Pill'
import { Dropdown, type DropdownOption } from './ui/Dropdown'
import { RangeSlider } from './ui/RangeSlider'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useDeckSounds } from '../lib/sounds'
import { setsListOptions } from '../lib/scryfall/queries'
import type { DeckFormat } from '../lib/deck-utils'

export type ColorMode = 'all' | 'any'

export type FilterType =
  | 'type'
  | 'cmc'
  | 'format'
  | 'keyword'
  | 'rarity'
  | 'budget'
  | 'stats'
  | 'set'

/**
 * Meta for the `+ ADD FILTER` picker. Each entry becomes a specimen mini-plate
 * (same DNA as the wizard stepper tooltip mini-cards: hairline-framed ash
 * rectangle with a big faint glyph in the background + a Cinzel title on top).
 * `glyph` is a single character rendered in the browser's default serif/
 * symbol fallback — Cinzel doesn't cover these codepoints and that's fine,
 * the glyph is decorative.
 */
const FILTER_META: Record<FilterType, { labelKey: string; glyph: string }> = {
  type: { labelKey: 'filter.type', glyph: 'T' },
  cmc: { labelKey: 'filter.cmc', glyph: '①' },
  format: { labelKey: 'filter.format', glyph: '§' },
  keyword: { labelKey: 'filter.keyword', glyph: '✦' },
  rarity: { labelKey: 'filter.rarity', glyph: '◆' },
  budget: { labelKey: 'filter.budget', glyph: '$' },
  stats: { labelKey: 'filter.stats', glyph: '⚔' },
  set: { labelKey: 'filter.set', glyph: '▣' },
}

const FILTER_ORDER: FilterType[] = [
  'type',
  'cmc',
  'format',
  'keyword',
  'rarity',
  'budget',
  'stats',
  'set',
]

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

// Only set types that a deckbuilder cares about. Scryfall also returns
// funny/memorabilia/token/alchemy/etc — we hide those because they'd bloat
// the dropdown with irrelevant printings.
const ALLOWED_SET_TYPES = new Set([
  'expansion',
  'core',
  'masters',
  'draft_innovation',
  'commander',
  'masterpiece',
])

const BUDGET_SLIDER_MAX = 100
const STAT_SLIDER_MAX = 12

function formatBudgetRange(min: number | null, max: number | null, unlimitedLabel: string): string {
  const minStr = min != null ? `$${min}` : '$0'
  const maxStr = max != null ? `$${max}` : unlimitedLabel
  if (min == null && max == null) return unlimitedLabel
  return `${minStr} \u2013 ${maxStr}`
}

function formatStatRange(min: number | null, max: number | null, sliderMax: number, anyLabel: string): string {
  if (min == null && max == null) return anyLabel
  const minStr = min != null ? `${min}` : '0'
  const maxStr = max != null ? `${max}` : `${sliderMax}+`
  return `${minStr} \u2013 ${maxStr}`
}

interface FilterBarProps {
  // Colors — always visible, not in the picker
  selectedColors: Set<ManaColor>
  onToggleColor: (color: ManaColor) => void
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void

  // Active filter visibility
  activeFilters: Set<FilterType>
  onAddFilter: (type: FilterType) => void
  onRemoveFilter: (type: FilterType) => void
  onClearAll: () => void

  // Individual filter values
  cardType: string
  onCardTypeChange: (type: string) => void
  cmc: string
  onCmcChange: (cmc: string) => void
  format: string
  onFormatChange: (format: string) => void
  budgetMin: number | null
  budgetMax: number | null
  onBudgetChange: (min: number | null, max: number | null) => void
  selectedRarities: Set<string>
  onToggleRarity: (rarity: string) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
  powerMin: number | null
  powerMax: number | null
  onPowerChange: (min: number | null, max: number | null) => void
  /**
   * Linked stat update: sets both power and toughness to the same range in a
   * single patch. Used by the stats filter's stereo-slider mode so URL
   * updates stay atomic. Called instead of `onPowerChange` +
   * `onToughnessChange` back-to-back.
   */
  onPowerAndToughnessChange: (min: number | null, max: number | null) => void
  toughnessMin: number | null
  toughnessMax: number | null
  onToughnessChange: (min: number | null, max: number | null) => void
  setCode: string
  onSetCodeChange: (code: string) => void
}

export function FilterBar({
  selectedColors,
  onToggleColor,
  colorMode,
  onColorModeChange,
  activeFilters,
  onAddFilter,
  onRemoveFilter,
  onClearAll,
  cardType,
  onCardTypeChange,
  cmc,
  onCmcChange,
  format,
  onFormatChange,
  budgetMin,
  budgetMax,
  onBudgetChange,
  selectedRarities,
  onToggleRarity,
  keyword,
  onKeywordChange,
  powerMin,
  powerMax,
  onPowerChange,
  onPowerAndToughnessChange,
  toughnessMin,
  toughnessMax,
  onToughnessChange,
  setCode,
  onSetCodeChange,
}: FilterBarProps) {
  const t = useT()
  const sounds = useDeckSounds()

  const { data: setsData } = useQuery(setsListOptions())

  const cardTypeOpts: DropdownOption[] = CARD_TYPE_KEYS.map((ct) => ({
    value: ct.value,
    label: ct.key ? t(ct.key) : ct.value,
  }))
  const cmcOpts: DropdownOption[] = CMC_OPTIONS.map((c) => ({
    value: c.value,
    label: c.key ? t(c.key) : c.value,
  }))
  const formatOpts: DropdownOption[] = FORMAT_OPTIONS.map((f) => ({
    value: f.value,
    label: f.key ? t(f.key) : f.value.charAt(0).toUpperCase() + f.value.slice(1),
  }))
  const keywordOpts: DropdownOption[] = KEYWORD_OPTIONS.map((kw) => ({
    value: kw.value,
    label: t(kw.key),
  }))

  // Build the set dropdown. Sort by release date desc so the most recent
  // editions bubble to the top (deckbuilders almost always want current sets
  // first). Limit to main deckbuilder set types.
  const setOpts: DropdownOption[] = useMemo(() => {
    const base: DropdownOption[] = [{ value: '', label: t('filter.allEditions') }]
    if (!setsData?.data) return base
    const filtered = setsData.data
      .filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital)
      .sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
      .map((s) => ({ value: s.code, label: `${s.name} — ${s.code.toUpperCase()}` }))
    return [...base, ...filtered]
  }, [setsData, t])

  const availableToAdd = FILTER_ORDER.filter((f) => !activeFilters.has(f))

  function handleRemove(type: FilterType) {
    sounds.dismiss()
    onRemoveFilter(type)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1 — mana colors + color mode switch on the left; add/clear cluster on the right */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {(['W', 'U', 'B', 'R', 'G'] as const).map((color) => (
              <ManaSymbol
                key={color}
                color={color}
                size="md"
                selected={selectedColors.has(color)}
                onClick={() => onToggleColor(color)}
              />
            ))}
          </div>
          <ColorModeSwitch value={colorMode} onChange={onColorModeChange} t={t} />
        </div>

        <div className="ml-auto flex items-center gap-4">
          {activeFilters.size > 0 && (
            <button
              type="button"
              onClick={() => {
                sounds.dismiss()
                onClearAll()
              }}
              className="cursor-pointer font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500 transition-colors hover:text-ink-red-bright"
            >
              {t('filter.clearAll')}
            </button>
          )}
          <AddFilterPicker
            available={availableToAdd}
            onPick={(type) => {
              sounds.uiClick()
              onAddFilter(type)
            }}
            t={t}
          />
        </div>
      </div>

      {/* Row 2 — active filters in a uniform grid. Every cell is the same
          width regardless of control so the row reads as a balanced matrix
          rather than a ransom note. */}
      {activeFilters.size > 0 && (
        <div
          className="grid gap-x-6 gap-y-5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {FILTER_ORDER.filter((f) => activeFilters.has(f)).map((type) => (
            <ActiveFilter
              key={type}
              label={t(FILTER_META[type].labelKey)}
              onRemove={() => handleRemove(type)}
              fullWidth={type === 'stats'}
            >
              {renderFilterControl(type, {
                t,
                cardType,
                onCardTypeChange,
                cmc,
                onCmcChange,
                format,
                onFormatChange,
                keyword,
                onKeywordChange,
                selectedRarities,
                onToggleRarity,
                budgetMin,
                budgetMax,
                onBudgetChange,
                powerMin,
                powerMax,
                onPowerChange,
                onPowerAndToughnessChange,
                toughnessMin,
                toughnessMax,
                onToughnessChange,
                setCode,
                onSetCodeChange,
                cardTypeOpts,
                cmcOpts,
                formatOpts,
                keywordOpts,
                setOpts,
              })}
            </ActiveFilter>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────── Color mode switch ─────────
//
// Replaces the separate color-identity filter. Two mini-Pills, one selected:
//   • ALL  → card must contain every selected color (`c>=wu`)
//   • ANY  → card contains at least one of the selected colors
//            (`(c:w OR c:u ...)`)
// Each mode has a hover tooltip explaining the semantics in one sentence —
// short labels stay intuitive, the tooltip handles the nuance.

function ColorModeSwitch({
  value,
  onChange,
  t,
}: {
  value: ColorMode
  onChange: (mode: ColorMode) => void
  t: ReturnType<typeof useT>
}) {
  return (
    <div className="flex items-center gap-0">
      <ColorModePill
        label={t('filter.colorModeAll')}
        hint={t('filter.colorModeAllHint')}
        selected={value === 'all'}
        onClick={() => onChange('all')}
      />
      <ColorModePill
        label={t('filter.colorModeAny')}
        hint={t('filter.colorModeAnyHint')}
        selected={value === 'any'}
        onClick={() => onChange('any')}
      />
    </div>
  )
}

function ColorModePill({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string
  hint: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <HoverTooltip hint={hint}>
      <Pill size="sm" selected={selected} onClick={onClick}>
        {label}
      </Pill>
    </HoverTooltip>
  )
}

// Shared hairline-framed hover tooltip. Matches the Specimen tooltip spec
// (tiny mono-tag label, no box, hairline frame). Still inline rather than a
// full `src/components/ui/Tooltip.tsx` primitive — that extraction is
// deferred until a third consumer shows up.
function HoverTooltip({
  hint,
  children,
  className,
}: {
  hint: string
  children: React.ReactNode
  className?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap',
            'border border-hairline-strong bg-ash-900 px-2 py-1',
            'font-mono text-mono-tag uppercase tracking-mono-tag text-cream-200',
          )}
          style={{ animation: 'drawer-enter 120ms ease-out both' }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

// ───────── Active filter wrapper ─────────

function ActiveFilter({
  label,
  children,
  onRemove,
  fullWidth,
}: {
  label: string
  children: React.ReactNode
  onRemove: () => void
  fullWidth?: boolean
}) {
  const t = useT()
  return (
    <div className={cn('flex flex-col gap-2', fullWidth && 'col-span-full md:col-span-2')}>
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
          {label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('filter.remove')}
          className={cn(
            'inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center',
            'border border-transparent text-cream-400 transition-colors',
            'hover:border-hairline-strong hover:text-ink-red-bright',
            'focus-visible:outline-none focus-visible:border-ink-red',
          )}
        >
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      </div>
      {children}
    </div>
  )
}

// ───────── Control renderer ─────────

interface ControlContext {
  t: ReturnType<typeof useT>
  cardType: string
  onCardTypeChange: (type: string) => void
  cmc: string
  onCmcChange: (cmc: string) => void
  format: string
  onFormatChange: (format: string) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
  selectedRarities: Set<string>
  onToggleRarity: (rarity: string) => void
  budgetMin: number | null
  budgetMax: number | null
  onBudgetChange: (min: number | null, max: number | null) => void
  powerMin: number | null
  powerMax: number | null
  onPowerChange: (min: number | null, max: number | null) => void
  onPowerAndToughnessChange: (min: number | null, max: number | null) => void
  toughnessMin: number | null
  toughnessMax: number | null
  onToughnessChange: (min: number | null, max: number | null) => void
  setCode: string
  onSetCodeChange: (code: string) => void
  cardTypeOpts: DropdownOption[]
  cmcOpts: DropdownOption[]
  formatOpts: DropdownOption[]
  keywordOpts: DropdownOption[]
  setOpts: DropdownOption[]
}

function renderFilterControl(type: FilterType, ctx: ControlContext): React.ReactNode {
  switch (type) {
    case 'type':
      return <Dropdown className="w-full" value={ctx.cardType} onChange={ctx.onCardTypeChange} options={ctx.cardTypeOpts} ariaLabel="Card type" />
    case 'cmc':
      return <Dropdown className="w-full" value={ctx.cmc} onChange={ctx.onCmcChange} options={ctx.cmcOpts} ariaLabel="Mana value" />
    case 'format':
      return <Dropdown className="w-full" value={ctx.format} onChange={ctx.onFormatChange} options={ctx.formatOpts} ariaLabel="Format" />
    case 'keyword':
      return <Dropdown className="w-full" value={ctx.keyword} onChange={ctx.onKeywordChange} options={ctx.keywordOpts} ariaLabel="Keyword" />
    case 'rarity':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {RARITIES.map((r) => (
            <Pill key={r} size="sm" selected={ctx.selectedRarities.has(r)} onClick={() => ctx.onToggleRarity(r)}>
              {ctx.t(RARITY_KEYS[r])}
            </Pill>
          ))}
        </div>
      )
    case 'budget':
      return (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-mono-tag tabular-nums text-cream-400">
            {formatBudgetRange(ctx.budgetMin, ctx.budgetMax, ctx.t('filter.noBudget'))}
          </span>
          <RangeSlider
            min={0}
            max={BUDGET_SLIDER_MAX}
            step={1}
            value={[ctx.budgetMin ?? 0, ctx.budgetMax ?? BUDGET_SLIDER_MAX]}
            onChange={([nextMin, nextMax]) => {
              ctx.onBudgetChange(
                nextMin <= 0 ? null : nextMin,
                nextMax >= BUDGET_SLIDER_MAX ? null : nextMax,
              )
            }}
            formatValue={(v) => (v >= BUDGET_SLIDER_MAX ? ctx.t('filter.noBudget') : `$${v}`)}
          />
        </div>
      )
    case 'stats':
      return <StatsControl ctx={ctx} />
    case 'set':
      return <Dropdown className="w-full" value={ctx.setCode} onChange={ctx.onSetCodeChange} options={ctx.setOpts} ariaLabel="Edition" />
  }
}

// ───────── Stats (power / toughness) with linked sliders ─────────

function StatsControl({ ctx }: { ctx: ControlContext }) {
  const [linked, setLinked] = useState(true)

  function handlePowerChange(min: number | null, max: number | null) {
    if (linked) ctx.onPowerAndToughnessChange(min, max)
    else ctx.onPowerChange(min, max)
  }

  function handleToughnessChange(min: number | null, max: number | null) {
    if (linked) ctx.onPowerAndToughnessChange(min, max)
    else ctx.onToughnessChange(min, max)
  }

  // Mirrored stereo sliders with the LINKED yoke pulled out to the side.
  // Labels sit above POWER and below TOUGHNESS (reflected around the
  // centerline between the two tracks), and the link button lives in its
  // own column on the right, vertically centered against the slider stack.
  // Compresses the whole control to ~4 tight rows.
  return (
    <div className="flex items-center gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
            {ctx.t('filter.power')}
          </span>
          <span className="font-mono text-mono-tag tabular-nums text-cream-500">
            {formatStatRange(ctx.powerMin, ctx.powerMax, STAT_SLIDER_MAX, ctx.t('filter.anyPower'))}
          </span>
        </div>
        <StatSlider min={ctx.powerMin} max={ctx.powerMax} onChange={handlePowerChange} />
        <StatSlider min={ctx.toughnessMin} max={ctx.toughnessMax} onChange={handleToughnessChange} />
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
            {ctx.t('filter.toughness')}
          </span>
          <span className="font-mono text-mono-tag tabular-nums text-cream-500">
            {formatStatRange(ctx.toughnessMin, ctx.toughnessMax, STAT_SLIDER_MAX, ctx.t('filter.anyToughness'))}
          </span>
        </div>
      </div>

      <HoverTooltip hint={linked ? ctx.t('filter.statsLinkedHint') : ctx.t('filter.statsUnlinkedHint')}>
        <button
          type="button"
          onClick={() => setLinked((l) => !l)}
          aria-pressed={linked}
          aria-label={linked ? ctx.t('filter.statsLinked') : ctx.t('filter.statsUnlinked')}
          className={cn(
            'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border transition-colors',
            linked
              ? 'border-ink-red bg-ink-red text-cream-100'
              : 'border-hairline text-cream-500 hover:border-hairline-strong hover:text-cream-300',
          )}
        >
          <span aria-hidden="true" className="text-xl leading-none">{linked ? '⇌' : '⇵'}</span>
        </button>
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
        onChange(
          nextMin <= 0 ? null : nextMin,
          nextMax >= STAT_SLIDER_MAX ? null : nextMax,
        )
      }}
    />
  )
}

// ───────── `+ ADD FILTER` picker ─────────

function AddFilterPicker({
  available,
  onPick,
  t,
}: {
  available: FilterType[]
  onPick: (type: FilterType) => void
  t: ReturnType<typeof useT>
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (available.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 border border-hairline-strong bg-ash-800 px-3 py-2',
          'font-mono text-mono-label uppercase tracking-mono-label text-cream-100',
          'cursor-pointer transition-colors hover:border-cream-300',
          'focus-visible:outline-none focus-visible:border-ink-red',
          open && 'border-ink-red',
        )}
      >
        <span>{t('filter.add')}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('filter.addHint')}
          className={cn(
            'absolute right-0 top-[calc(100%+4px)] z-30 border border-hairline-strong bg-ash-900 p-4',
            // Explicit width so 4 fixed-width plates + gaps + padding fit
            // without overflowing. Responsive down-sizes handled below.
            'w-[min(640px,calc(100vw-2rem))]',
          )}
          style={{ animation: 'drawer-enter 150ms ease-out both' }}
        >
          <span className="mb-3 block font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
            {t('filter.addHint')}
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {available.map((type) => {
              const meta = FILTER_META[type]
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onPick(type)
                    setOpen(false)
                  }}
                  className={cn(
                    'group relative h-24 w-full cursor-pointer overflow-hidden border border-hairline-strong bg-ash-800',
                    'transition-colors hover:border-cream-200 hover:bg-ash-700',
                  )}
                >
                  {/* Faint background glyph — the "art" of the mini-plate */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center text-6xl leading-none text-cream-100/10 transition-colors group-hover:text-cream-100/15 select-none"
                  >
                    {meta.glyph}
                  </span>
                  {/* Scrim to keep the Cinzel title legible over any glyph */}
                  <span aria-hidden="true" className="absolute inset-0 bg-ash-900/40" />
                  {/* Centered Cinzel title — wraps when needed. `leading-tight`
                      lets long German labels like STICHWORT or WIDERSTAND
                      break onto two lines instead of clipping. */}
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center font-display text-sm font-bold uppercase leading-tight tracking-display text-cream-100">
                    {t(meta.labelKey)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
