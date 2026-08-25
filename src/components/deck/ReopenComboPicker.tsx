import { useState, useCallback, useRef } from 'react'
import { ComboCard } from '../wizard/ComboCard'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'
import { LoadingDots } from '../ui/LoadingDots'
import { ErrorBox } from '../ui/ErrorBox'
import { generateCombos, type RejectedCard, type RejectedCombo } from '../../lib/combo-generation'
import { comboToAdditions, buildReopenComboOpts } from '../../lib/combo-additions'
import { mergeCardsIntoDeck } from '../../lib/deck-utils'
import { isBasicLandId } from '../../../convex/lib/basicLands'
import type { SectionFillIntent } from '../../lib/section-fill-intent'
import type { CoreCombo } from '../../lib/wizard-state'
import type { DeckCard } from '../../lib/deck-utils'
import type { PendingChanges } from '../../lib/useDeckChat'
import { useT, useI18n } from '../../lib/i18n'
import { useSkipFirst } from '../../lib/use-skip-first'
import { useDeckSounds } from '../../lib/sounds'

const DISPLAY_COUNT = 3

interface ReopenComboPickerProps {
  /** Fill intent driven by the deck's committed colors. */
  intent: SectionFillIntent
  /** The current deck (additive target — locked cards are never referenced). */
  deckCards: DeckCard[]
  /** Stage the additive proposal through the existing chat ledger (last-wins). */
  onStage: (proposal: PendingChanges) => void
  /** Disabled while a chat/fill round-trip owns the ledger. */
  disabled?: boolean
  /**
   * Combos previously offered in this deck's pending slot — rehydrated on mount
   * so a reload mid-review resumes the offered suggestions (the picker opens
   * straight to them, no refetch). Absent / empty means none were offered.
   */
  initialCombos?: CoreCombo[]
  /** Fired whenever the offered combos change, so the route can persist them. */
  onCombosChange?: (combos: CoreCombo[]) => void
}

/**
 * Saved-deck reopen-combo picker (M3, additive-only — decision 4).
 *
 * Pulls a fresh core combo for an existing deck driven purely by the committed
 * colors (no maybe-loop, no seed), renders the suggestions with the wizard's
 * ComboCard, and on select stages ONLY the adds through the existing change
 * ledger — never touching the deck's locked cards. The offered combos are
 * transient component state (M4 adds per-deck persistence).
 */
export function ReopenComboPicker({
  intent,
  deckCards,
  onStage,
  disabled,
  initialCombos,
  onCombosChange,
}: ReopenComboPickerProps) {
  const t = useT()
  const { locale } = useI18n()
  const sounds = useDeckSounds()
  const hasInitial = (initialCombos?.length ?? 0) > 0
  // Resume offered combos from the pending slot: open straight to them and skip
  // the auto-fetch (they're already fetched).
  const [open, setOpen] = useState(hasInitial)
  const [combos, setCombos] = useState<CoreCombo[]>(initialCombos ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectedCombos, setRejectedCombos] = useState<RejectedCombo[]>([])
  const [rejectedCards, setRejectedCards] = useState<RejectedCard[]>([])
  const [hasFetched, setHasFetched] = useState(hasInitial)

  // Mirror offered-combo changes into the pending slot. Skips the first commit
  // so rehydration doesn't immediately re-persist what it just loaded.
  const onCombosChangeRef = useRef(onCombosChange)
  onCombosChangeRef.current = onCombosChange
  useSkipFirst(() => {
    onCombosChangeRef.current?.(combos)
  }, [combos])

  const fetchCombos = useCallback(
    async (rejectCurrent: boolean) => {
      setIsLoading(true)
      setError(null)

      // "Suggest different" feeds the current batch back as rejected so the
      // model steers away from it (same machinery the wizard uses).
      const nextRejectedCombos = rejectCurrent
        ? [...rejectedCombos, ...combos.map((c) => ({ name: c.name, reason: 'User asked for different combos' }))]
        : rejectedCombos

      try {
        const result = await generateCombos(intent, locale, {
          ...buildReopenComboOpts(intent),
          rejectedCards: rejectedCards.length > 0 ? rejectedCards : undefined,
          rejectedCombos: nextRejectedCombos.length > 0 ? nextRejectedCombos : undefined,
        })
        setCombos(result.combos.slice(0, DISPLAY_COUNT))
        setRejectedCards(result.rejectedCards)
        setRejectedCombos(result.rejectedCombos)
        setHasFetched(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    },
    [intent, locale, combos, rejectedCards, rejectedCombos],
  )

  const handleOpen = useCallback(() => {
    sounds.uiClick()
    setOpen(true)
    if (!hasFetched && !isLoading) void fetchCombos(false)
  }, [sounds, hasFetched, isLoading, fetchCombos])

  const handleSelect = useCallback(
    (combo: CoreCombo) => {
      sounds.cardSlide()
      const changes = comboToAdditions(combo, deckCards)
      // Build the merged 60-target deck the ledger Apply commits. The cap +
      // locked-card guard live in mergeCardsIntoDeck; adds-only by construction.
      const { merged } = mergeCardsIntoDeck(
        deckCards,
        changes.map((c) => ({ scryfallId: c.scryfallId, quantity: c.newQuantity })),
        isBasicLandId,
      )
      onStage({
        deckName: '',
        description: '',
        explanation: combo.explanation,
        changes,
        resolvedCards: merged,
      })
    },
    [sounds, deckCards, onStage],
  )

  if (!open) {
    return (
      <div className="border-t border-hairline pt-3">
        <Pill onClick={handleOpen} disabled={disabled} className="self-start" title={t('core.comboAdditiveShort')}>
          {t('core.reopenCombo')}
        </Pill>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-400">
            {t('core.comboAdditive')}
          </p>
          <p className="font-mono text-mono-marginal text-cream-500">
            {t('core.comboOver60')}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { sounds.uiClick(); setOpen(false) }}>
          {t('action.close')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-6">
          <LoadingDots />
          <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('core.analyzing')}
          </span>
        </div>
      )}

      {!isLoading && error && (
        <ErrorBox message={error} onRetry={() => void fetchCombos(false)} retryLabel={t('core.tryAgain')} />
      )}

      {!isLoading && !error && hasFetched && combos.length === 0 && (
        <p className="font-body text-sm italic text-cream-400">{t('core.noValidCombos')}</p>
      )}

      {!isLoading && !error && combos.length > 0 && (
        <>
          <div className="flex flex-col gap-3">
            {combos.map((combo) => (
              <ComboCard
                key={combo.name}
                combo={combo}
                selected={false}
                onSelect={() => handleSelect(combo)}
              />
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchCombos(true)}
            className="self-start"
            disabled={disabled || isLoading}
          >
            {t('core.suggestDifferent')}
          </Button>
        </>
      )}
    </div>
  )
}
