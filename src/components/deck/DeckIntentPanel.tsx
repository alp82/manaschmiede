import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ManaSymbol, type ManaColor } from '../ManaSymbol'
import { Pill } from '../ui/Pill'
import { Button } from '../ui/Button'
import { RangeSlider } from '../ui/RangeSlider'
import { useT } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'
import { getTraitsByCategory, getTraitById } from '../../lib/trait-mappings'
import { FORMAT_LABELS, type DeckFormat } from '../../lib/deck-utils'
import type { DeckIntent } from '../../lib/deck-intent'
import { structuralFieldsChanged } from '../../lib/use-staged-rederive'
import type { TranslationKey } from '../../lib/i18n/types'

const ALL_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
const RARITY_KEYS: Record<string, TranslationKey> = {
  common: 'strategy.common',
  uncommon: 'strategy.uncommon',
  rare: 'strategy.rare',
  mythic: 'strategy.mythic',
}
const ARCHETYPES = getTraitsByCategory('archetype')

interface DeckIntentPanelProps {
  intent: DeckIntent
  format: DeckFormat
  onChange: (next: DeckIntent) => void
  /** Card-derived colors used to pre-seed a legacy deck's intent (once, on mount). */
  seedColors: ManaColor[]
  /** False for legacy decks with no persisted intent — triggers the one-time pre-seed. */
  hasStoredIntent: boolean
  /**
   * Fired exactly once when the strip collapses (edit → done) AND a structural
   * field (committed colors or archetypes) changed during the edit. The deck
   * view uses this to stage a re-derived section plan. Soft-only edits do not
   * fire it.
   */
  onStructuralCommit?: (intent: DeckIntent) => void
}

function selectedColors(intent: DeckIntent): ManaColor[] {
  return ALL_COLORS.filter((c) => intent.colors[c] === 'selected')
}

function budgetReadout(min: number | null, max: number | null, unlimited: string): string {
  if (min == null && max == null) return unlimited
  const minStr = min != null ? `$${min}` : '$0'
  const maxStr = max != null ? `$${max}` : unlimited
  return `${minStr} – ${maxStr}`
}

/**
 * Always-visible compact readout of the deck's intent with inline editing.
 *
 * Reading-mode Specimen: hairline rules + mono-label headers + spacing, no
 * bordered/ash boxes (grouping doctrine). Editing is INERT — it mutates the
 * intent only; the card list never cascades. Legacy decks (no persisted
 * intent) are pre-seeded once from their card-derived colors so the readout
 * is never blank.
 */
export function DeckIntentPanel({ intent, format, onChange, seedColors, hasStoredIntent, onStructuralCommit }: DeckIntentPanelProps) {
  const t = useT()
  const sounds = useDeckSounds()
  const [editing, setEditing] = useState(false)

  // Structural snapshot taken when the strip opens (editing false→true). On
  // collapse (true→false) it is compared to the current intent; a structural
  // change (committed colors / archetypes) fires onStructuralCommit exactly
  // once. The latest intent lives in a ref so the toggle reads a current value
  // without re-creating the callback per edit.
  const structuralSnapshot = useRef<DeckIntent | null>(null)
  const intentRef = useRef(intent)
  intentRef.current = intent
  const onStructuralCommitRef = useRef(onStructuralCommit)
  onStructuralCommitRef.current = onStructuralCommit

  const toggleEditing = useCallback(() => {
    setEditing((wasEditing) => {
      if (!wasEditing) {
        // opening: snapshot the structural fields
        structuralSnapshot.current = intentRef.current
      } else {
        // collapsing: fire iff structural fields changed during the edit
        const snap = structuralSnapshot.current
        if (snap && structuralFieldsChanged(snap, intentRef.current)) {
          onStructuralCommitRef.current?.(intentRef.current)
        }
        structuralSnapshot.current = null
      }
      return !wasEditing
    })
    sounds.uiClick()
  }, [sounds])

  // Pre-seed committed colors ONCE for a deck with no stored intent, the first
  // time its card-derived colors resolve. Guarded so it fires exactly once and
  // never re-seeds afterward — later card edits don't churn the intent.
  const seeded = useRef(false)
  useEffect(() => {
    if (hasStoredIntent || seeded.current || seedColors.length === 0) return
    seeded.current = true
    const colors = { ...intent.colors }
    let changed = false
    for (const c of seedColors) {
      if (colors[c] !== 'selected') {
        colors[c] = 'selected'
        changed = true
      }
    }
    if (changed) onChange({ ...intent, colors })
  }, [hasStoredIntent, seedColors, intent, onChange])

  const committed = useMemo(() => selectedColors(intent), [intent])
  const archetypeLabels = intent.archetypes.map((id) => getTraitById(id)?.label || id)
  const traitLabels = intent.traits.map((id) => getTraitById(id)?.label || id)

  function toggleColor(color: ManaColor) {
    seeded.current = true
    const next = intent.colors[color] === 'selected' ? 'unselected' : 'selected'
    onChange({ ...intent, colors: { ...intent.colors, [color]: next } })
    sounds.uiClick()
  }

  function toggleArchetype(id: string) {
    seeded.current = true
    const has = intent.archetypes.includes(id)
    onChange({
      ...intent,
      archetypes: has ? intent.archetypes.filter((x) => x !== id) : [...intent.archetypes, id],
    })
    sounds.uiClick()
  }

  function toggleTrait(id: string) {
    seeded.current = true
    const has = intent.traits.includes(id)
    onChange({
      ...intent,
      traits: has ? intent.traits.filter((x) => x !== id) : [...intent.traits, id],
    })
    sounds.uiClick()
  }

  function toggleRarity(r: string) {
    const has = intent.rarityFilter.includes(r)
    const next = has ? intent.rarityFilter.filter((x) => x !== r) : [...intent.rarityFilter, r]
    if (next.length > 0) onChange({ ...intent, rarityFilter: next })
    sounds.uiClick()
  }

  const unlimited = t('strategy.unlimited')

  return (
    <section className="border-t border-hairline pt-4">
      {/* Eyebrow + edit affordance */}
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
          {t('intent.eyebrow')}
        </span>
        <button
          type="button"
          aria-expanded={editing}
          onClick={toggleEditing}
          className="cursor-pointer font-mono text-mono-label uppercase tracking-mono-label text-cream-400 transition-opacity hover:text-cream-100"
        >
          {editing ? t('intent.collapse') : t('intent.editStrip')}
        </button>
      </div>

      {!editing ? (
        /* ─── Collapsed strip — dense one-line working-mode readout ──── */
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
          {committed.length > 0 ? (
            <span className="flex items-center gap-1.5">
              {committed.map((c) => <ManaSymbol key={c} color={c} size="sm" />)}
            </span>
          ) : (
            <span className="normal-case text-cream-500 italic font-body text-sm">{unlimited}</span>
          )}
          {archetypeLabels.length > 0 && (
            <>
              <span aria-hidden className="text-cream-500">·</span>
              <span>{archetypeLabels.join(', ')}</span>
            </>
          )}
          {traitLabels.length > 0 && (
            <>
              <span aria-hidden className="text-cream-500">·</span>
              <span>{traitLabels.join(' / ')}</span>
            </>
          )}
          <span aria-hidden className="text-cream-500">·</span>
          <span className="normal-case text-cream-400">
            {budgetReadout(intent.budgetMin, intent.budgetMax, unlimited)}
          </span>
          {format !== 'casual' && (
            <>
              <span aria-hidden className="text-cream-500">·</span>
              <span>{FORMAT_LABELS[format]}</span>
            </>
          )}
        </div>
      ) : (
        /* ─── Editing (inert) ─────────────────────────────── */
        <div className="mt-4 flex flex-col gap-6">
          {/* inertNote reassures before the controls that editing won't cascade */}
          <p className="font-body text-xs italic text-cream-500">{t('intent.inertNote')}</p>
          <p className="font-mono text-mono-marginal text-cream-400">{t('intent.collapseHint')}</p>

          {!hasStoredIntent && seedColors.length > 0 && (
            <p className="-mt-3 font-body text-xs italic text-cream-500">{t('intent.legacyHint')}</p>
          )}

          {/* Colors */}
          <div>
            <h4 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('intent.colorsCommitted')}
            </h4>
            <div className="flex items-center gap-3">
              {ALL_COLORS.map((color) => (
                <ManaSymbol
                  key={color}
                  color={color}
                  size="md"
                  selected={intent.colors[color] === 'selected'}
                  onClick={() => toggleColor(color)}
                />
              ))}
            </div>
          </div>

          {/* Archetypes */}
          <div>
            <h4 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('intent.archetypes')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {ARCHETYPES.map((trait) => (
                <Pill
                  key={trait.id}
                  size="sm"
                  selected={intent.archetypes.includes(trait.id)}
                  onClick={() => toggleArchetype(trait.id)}
                >
                  {t(`trait.${trait.id}`)}
                </Pill>
              ))}
            </div>
          </div>

          {/* Traits */}
          <div>
            <h4 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('intent.traits')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {(['keyword', 'mechanic', 'tribal'] as const).flatMap((cat) =>
                getTraitsByCategory(cat).map((trait) => (
                  <Pill
                    key={trait.id}
                    size="sm"
                    selected={intent.traits.includes(trait.id)}
                    title={t(`trait.desc.${trait.id}`)}
                    onClick={() => toggleTrait(trait.id)}
                  >
                    {t(`trait.${trait.id}`)}
                  </Pill>
                )),
              )}
            </div>
          </div>

          {/* Strategy */}
          <div>
            <h4
              id="intent-strategy-label"
              className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300"
            >
              {t('intent.strategy')}
            </h4>
            <textarea
              id="intent-strategy"
              aria-labelledby="intent-strategy-label"
              value={intent.customStrategy}
              onChange={(e) => {
                seeded.current = true
                onChange({ ...intent, customStrategy: e.target.value })
              }}
              onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
              placeholder={t('strategy.strategyPlaceholder')}
              rows={2}
              className="w-full resize-none border-0 border-b border-hairline bg-transparent py-1.5 font-body text-base text-cream-100 placeholder-cream-500 focus:border-cream-200 focus:outline-none"
            />
          </div>

          {/* Budget */}
          <div>
            <h4 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('intent.budget')}
              <span className="ml-2 font-body text-sm normal-case tracking-normal text-cream-500">
                {budgetReadout(intent.budgetMin, intent.budgetMax, unlimited)}
              </span>
            </h4>
            <RangeSlider
              min={0}
              max={100}
              step={1}
              value={[intent.budgetMin ?? 0, intent.budgetMax ?? 100]}
              onChange={([nextMin, nextMax]) => {
                seeded.current = true
                onChange({
                  ...intent,
                  budgetMin: nextMin <= 0 ? null : nextMin,
                  budgetMax: nextMax >= 100 ? null : nextMax,
                })
              }}
              formatValue={(v) => (v >= 100 ? unlimited : `$${v}`)}
            />
          </div>

          {/* Rarity */}
          <div>
            <h4 className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('intent.rarity')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {RARITIES.map((r) => {
                const isLastSelected = intent.rarityFilter.length === 1 && intent.rarityFilter.includes(r)
                return (
                  <Pill
                    key={r}
                    size="sm"
                    selected={intent.rarityFilter.includes(r)}
                    disabled={isLastSelected}
                    onClick={() => toggleRarity(r)}
                  >
                    {t(RARITY_KEYS[r])}
                  </Pill>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
