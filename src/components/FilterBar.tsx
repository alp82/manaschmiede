import { useEffect, useRef, useState } from 'react'
import { ManaSymbol } from './ManaSymbol'
import { MANA_COLORS, type ManaColor } from '../lib/mana-colors'
import { Pill } from './ui/Pill'
import { Button } from './ui/Button'
import { buttonLikeFocus } from './ui/button-styles'
import { HoverTooltip } from './ui/HoverTooltip'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useDeckSounds } from '../lib/sounds'
import {
  FILTERS,
  addFilterPatch,
  clearFiltersPatch,
  removeFilterPatch,
  type ColorMode,
  type FilterEntry,
  type FilterId,
  type FilterPatch,
  type FilterState,
} from './card-filters'

interface FilterBarProps {
  // Colors — always visible, never in the picker. They stay explicit props
  // because ALL/ANY is a mode between values, not a filter value.
  selectedColors: Set<ManaColor>
  onToggleColor: (color: ManaColor) => void
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void

  /** Which filters the bar is showing, from the `filters` URL param. */
  activeFilters: Set<FilterId>
  /** Every filter's decoded value. */
  state: FilterState
  /** The one way the bar writes: a partial URL patch, applied atomically. */
  onPatch: (patch: FilterPatch) => void
}

/**
 * The card browser's filter bar.
 *
 * Holds no filter semantics of its own — what a filter is called, which params
 * it owns, how it decodes and what it contributes to the Scryfall query all
 * live in its registry entry (`./card-filters`). This file is layout: the color
 * block, the add/clear cluster, and a uniform grid of whatever is active.
 */
export function FilterBar({
  selectedColors,
  onToggleColor,
  colorMode,
  onColorModeChange,
  activeFilters,
  state,
  onPatch,
}: FilterBarProps) {
  const t = useT()
  const sounds = useDeckSounds()

  const active = FILTERS.filter((f) => activeFilters.has(f.id))
  const availableToAdd = FILTERS.filter((f) => !activeFilters.has(f.id))

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1 — mana colors + color mode switch on the left; add/clear cluster on the right */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {MANA_COLORS.map((color) => (
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
            <Button
              variant="ghost"
              onClick={() => {
                sounds.dismiss()
                onPatch(clearFiltersPatch(activeFilters))
              }}
            >
              {t('filter.clearAll')}
            </Button>
          )}
          <AddFilterPicker
            available={availableToAdd}
            onPick={(id) => {
              sounds.uiClick()
              onPatch(addFilterPatch(activeFilters, id))
            }}
            t={t}
          />
        </div>
      </div>

      {/* Row 2 — active filters in a uniform grid. Every cell is the same
          width regardless of control so the row reads as a balanced matrix
          rather than a ransom note. */}
      {active.length > 0 && (
        <div
          className="grid gap-x-6 gap-y-5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {active.map((filter) => (
            <ActiveFilter
              key={filter.id}
              label={t(filter.labelKey)}
              onRemove={() => {
                sounds.dismiss()
                onPatch(removeFilterPatch(activeFilters, filter.id))
              }}
              fullWidth={filter.fullWidth}
            >
              <filter.Control
                state={state}
                onChange={(slice) => onPatch(filter.encode(slice))}
                ariaLabel={t(filter.ariaLabelKey)}
              />
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
            buttonLikeFocus,
          )}
        >
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      </div>
      {children}
    </div>
  )
}

// ───────── `+ ADD FILTER` picker ─────────

function AddFilterPicker({
  available,
  onPick,
  t,
}: {
  available: readonly FilterEntry[]
  onPick: (id: FilterId) => void
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
          // The focus RING, not an ink-red border: the border is already
          // ink-red while the drawer is open, so a focus border was
          // indistinguishable from the live state.
          buttonLikeFocus,
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
            {available.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  onPick(filter.id)
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
                  {filter.glyph}
                </span>
                {/* Scrim to keep the Cinzel title legible over any glyph */}
                <span aria-hidden="true" className="absolute inset-0 bg-ash-900/40" />
                {/* Centered Cinzel title — wraps when needed. `leading-tight`
                    lets long German labels like STICHWORT or WIDERSTAND
                    break onto two lines instead of clipping. */}
                <span className="absolute inset-0 flex items-center justify-center px-2 text-center font-display text-sm font-bold uppercase leading-tight tracking-display text-cream-100">
                  {t(filter.labelKey)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
