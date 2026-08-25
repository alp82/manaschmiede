import { memo, useRef, useState, type ReactNode } from 'react'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckDisplayCard } from '../../lib/deck-utils'
import type { SectionFillState } from '../../lib/useSectionFill'
import { CardStack } from '../CardStack'
import { SectionLaneHeader } from '../ui/SectionLaneHeader'
import { LoadingDots } from '../ui/LoadingDots'
import { ErrorBox } from '../ui/ErrorBox'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import type { LaneStatus } from '../../lib/use-staged-rederive'
import { useT } from '../../lib/i18n'

export interface SectionLaneDescriptor {
  id: string
  label: string
  sectionLetter?: string
  targetCount?: number
  description?: string
  isCore?: boolean
  isLands?: boolean
}

/**
 * The wizard's richer per-section progress + AI preview render. When this is
 * passed (alongside `fillSlot`), the lane shows the progress bar, the
 * preview/loading/error states, and apply/retry/discard actions.
 */
export interface SectionLaneState {
  fillState: SectionFillState
  onApplySection: () => void
  onRetrySection: () => void
  onDiscardSection: () => void
}

/**
 * Per-lane re-derive status (deck-view only). When a lane is stale its body
 * dims + an inline re-fill prompt renders. The dim is a review marker, not a
 * lock: the cards stay interactive, or the only ways out of a stale lane would
 * be Accept and Discard.
 *
 * Defined by `use-staged-rederive`, which computes it, and re-exported here so
 * the component tree keeps importing it from where it is rendered.
 */
export type { LaneStatus } from '../../lib/use-staged-rederive'

interface SectionLaneProps {
  section: SectionLaneDescriptor
  items: DeckDisplayCard[]
  newCardIds: Set<string>
  onOpenLightbox: (card: ScryfallCard) => void
  onToggleLock: (scryfallId: string) => void
  onChangeQuantity: (scryfallId: string, qty: number) => void
  onRemoveCard: (scryfallId: string) => void
  /**
   * Wizard-only: the fill action buttons rendered beneath the lane (fill
   * section / top up / adjust lands). Rendered only when present.
   */
  fillSlot?: ReactNode
  /**
   * Wizard-only: per-section progress + AI preview/loading/error render.
   * When present the lane shows the progress bar in its header and the
   * preview state block.
   */
  sectionState?: SectionLaneState
  /**
   * Deck-view re-derive: when true the lane no longer matches the committed
   * intent. The lane body dims + locks (combosAreStale precedent) and an
   * inline re-fill prompt renders below the header.
   */
  stale?: boolean
  /** Fires the lane's intent-driven re-fill (deck view only). */
  onRefill?: () => void
  /** Copies missing from the lane vs the re-derived target. */
  refillDeficit?: number
  /** True when a re-fill chat call is currently in flight for this lane. */
  refilling?: boolean
}

/**
 * Unified deck-section lane — a superset of the view-mode lane (deck view) and
 * the fill-mode lane (wizard). Without `fillSlot`/`sectionState` it renders the
 * edit lane: collapse toggle, count (with target + progress when
 * `targetCount` is set), and the card controls. With them it renders the
 * fill-mode lane: progress bar, AI preview/loading/error states, and the fill
 * buttons supplied via `fillSlot`.
 */
export const SectionLane = memo(function SectionLane({
  section,
  items,
  newCardIds,
  onOpenLightbox,
  onToggleLock,
  onChangeQuantity,
  onRemoveCard,
  fillSlot,
  sectionState,
  stale = false,
  onRefill,
  refillDeficit = 0,
  refilling = false,
}: SectionLaneProps) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const animatedCards = useRef(new Set<string>())

  const { id: _id, label, sectionLetter, targetCount, description, isCore, isLands } = section
  const count = items.reduce((s, d) => s + d.quantity, 0)
  const hasTarget = typeof targetCount === 'number' && targetCount > 0
  const underFilled = hasTarget && count < targetCount!
  const overFilled = hasTarget && count > targetCount!
  const fillPct = hasTarget ? Math.min(100, (count / targetCount!) * 100) : 0

  const fillState = sectionState?.fillState
  const isFilling = fillState?.status === 'loading'
  const hasPreview = fillState?.status === 'preview'

  return (
    <div className={cn('relative', isCore && 'pl-3')}>
      {/* Core section marker — ink-red slab on the left edge */}
      {isCore && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-0 top-2 w-[3px] bg-ink-red"
        />
      )}

      <SectionLaneHeader
        letter={sectionLetter}
        label={label}
        description={!isCore ? description : undefined}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        controlsId={`section-body-${section.id}`}
        progressPct={sectionState && hasTarget ? fillPct : undefined}
        progressOver={overFilled}
        count={
          <>
            {stale && (
              <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
                {t('fill.laneStale')}
              </span>
            )}
            {hasTarget ? (
            <span
              className={cn(
                'tabular-nums',
                overFilled
                  ? 'text-ink-red-bright'
                  : underFilled
                    ? 'text-cream-400'
                    : 'text-cream-100',
              )}
            >
              {count} / {targetCount}
            </span>
            ) : (
              <span className="tabular-nums text-cream-300">{count}</span>
            )}
          </>
        }
      />

      {/* Stale re-fill prompt — hairline-framed line under the header with an
          ink-red primary action showing the deficit (deck-view re-derive). */}
      {stale && onRefill && (
        <div className="mb-3 flex items-center justify-between gap-3 border border-hairline px-3 py-2">
          {refilling ? (
            <span className="flex items-center gap-2">
              <LoadingDots size="md" tone="bright" />
              <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
                {t('fill.refilling')}
              </span>
            </span>
          ) : (
            <span className="font-body text-sm italic text-cream-400">
              {refillDeficit > 0
                ? t('fill.refillLaneHint', { count: refillDeficit })
                : t('fill.refillLaneHintNoCount')}
            </span>
          )}
          <Button variant="primary" size="sm" onClick={onRefill} disabled={refilling}>
            {t('fill.refillLane')}
          </Button>
        </div>
      )}

      {!collapsed && (
        <div
          id={`section-body-${section.id}`}
          className={cn(stale && 'opacity-60')}
        >
          {/* Cards */}
          {items.length > 0 && (
            <div
              className={
                isLands
                  ? 'grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'
                  : 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
              }
            >
              {items.map(({ card, quantity, locked, scryfallId }, i) => {
                const shouldAnimate = !animatedCards.current.has(scryfallId)
                if (shouldAnimate) animatedCards.current.add(scryfallId)
                return (
                  <div
                    key={scryfallId}
                    style={
                      shouldAnimate
                        ? {
                            animation: `card-enter 300ms cubic-bezier(0.22, 1.2, 0.36, 1) both`,
                            animationDelay: `${i * 60}ms`,
                          }
                        : undefined
                    }
                  >
                    <CardStack
                      card={card}
                      quantity={quantity}
                      locked={locked}
                      isNew={newCardIds.has(scryfallId)}
                      onClick={() => onOpenLightbox(card)}
                      onToggleLock={() => onToggleLock(scryfallId)}
                      onChangeQuantity={(qty) => onChangeQuantity(scryfallId, qty)}
                      onRemove={() => onRemoveCard(scryfallId)}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* Preview cards — hairline-framed ink-red preview state */}
          {hasPreview && fillState?.previewCards && sectionState && (
            <div className="mt-4 border border-ink-red p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red-bright">
                  {t('deck.previewLabel')}
                </span>
                <span className="font-mono text-mono-tag tabular-nums tracking-mono-tag text-cream-400">
                  {t('fill.suggestionCount', { count: fillState.previewCards.length })}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 opacity-90 sm:grid-cols-3 md:grid-cols-4">
                {fillState.previewCards.map((pc) => (
                  pc.scryfallCard && (
                    <CardStack
                      key={pc.scryfallId}
                      card={pc.scryfallCard}
                      quantity={pc.quantity}
                      onClick={() => pc.scryfallCard && onOpenLightbox(pc.scryfallCard)}
                    />
                  )
                ))}
              </div>
              {fillState.explanation && (
                <p className="mt-3 font-body text-sm italic text-cream-300">{fillState.explanation}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={sectionState.onApplySection}>
                  {t('chat.apply')}
                </Button>
                <Button variant="secondary" size="sm" onClick={sectionState.onRetrySection}>
                  {t('core.suggestDifferent')}
                </Button>
                <Button variant="ghost" size="sm" onClick={sectionState.onDiscardSection}>
                  {t('chat.discard')}
                </Button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {isFilling && (
            <div className="mt-3 flex items-center gap-3 py-3">
              <LoadingDots size="md" tone="bright" />
              <span className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-400">
                {t('fill.building')}
              </span>
            </div>
          )}

          {/* Error state */}
          {fillState?.status === 'error' && sectionState && (
            <ErrorBox
              className="mt-3"
              message={fillState.error ?? ''}
              onRetry={sectionState.onRetrySection}
              retryLabel={t('core.tryAgain')}
            />
          )}

          {/* Fill buttons (wizard) */}
          {fillSlot && !isFilling && !hasPreview && !isCore && fillSlot}
        </div>
      )}
    </div>
  )
})
