import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri } from '../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../lib/deck-utils'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

interface DeckCardListProps {
  cards: DeckCard[]
  cardData: Map<string, ScryfallCard>
  zone: DeckZone
  onUpdateQuantity: (scryfallId: string, zone: DeckZone, quantity: number) => void
  onRemoveCard: (scryfallId: string, zone: DeckZone) => void
  onCardSelect?: (scryfallId: string) => void
  onToggleLock?: (scryfallId: string) => void
}

/**
 * Specimen deck card list — a flat hairline table row per card.
 *
 * Each row: thin hairline bottom divider, sharp corners, mono quantity
 * controls, card name in cream, type-line in mono-marginal, CMC in
 * tabular mono, locked state marked with a 2px ink-red slab on the left
 * edge, remove action revealed on hover.
 */
export function DeckCardList({
  cards,
  cardData,
  zone,
  onUpdateQuantity,
  onRemoveCard,
  onCardSelect,
  onToggleLock,
}: DeckCardListProps) {
  const t = useT()
  const zoneCards = cards.filter((c) => c.zone === zone)

  if (zoneCards.length === 0) {
    // TODO: migrate to <EmptyState> — current list lives in a narrow
    // sidebar where a Cinzel display-section title would be oversized.
    return (
      <p className="py-6 text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
        {t('cardlist.noCards')}
      </p>
    )
  }

  return (
    <div>
      {zoneCards.map((dc) => {
        const card = cardData.get(dc.scryfallId)
        const name = card ? getCardName(card) : dc.scryfallId
        const imageUrl = card ? getCardImageUri(card, 'small') : undefined
        const typeLine = card?.printed_type_line || card?.type_line || ''
        const cmc = card?.cmc ?? 0
        const isLocked = dc.locked === true

        return (
          <div
            key={dc.scryfallId + '-' + dc.zone}
            className={cn(
              'group relative flex items-center gap-3 border-b border-hairline/60 px-3 py-2 transition-colors hover:bg-ash-800/60',
              isLocked && 'pl-4',
            )}
          >
            {/* Locked indicator — ink-red slab on left edge */}
            {isLocked && (
              <span
                aria-hidden="true"
                className="absolute bottom-2 left-0 top-2 w-[2px] bg-ink-red"
              />
            )}

            {/* Thumbnail */}
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                className="h-9 w-7 flex-shrink-0 border border-hairline object-cover"
              />
            )}

            {/* Quantity controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (isLocked) return
                  if (dc.quantity <= 1) {
                    if (confirm(t('cardlist.removeConfirm', { name }))) onRemoveCard(dc.scryfallId, dc.zone)
                  } else {
                    onUpdateQuantity(dc.scryfallId, dc.zone, dc.quantity - 1)
                  }
                }}
                disabled={isLocked}
                className={cn(
                  'relative flex h-5 w-5 items-center justify-center border border-hairline font-mono text-mono-tag text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none',
                  'before:absolute before:inset-[-12px] before:content-[""]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
                )}
                aria-label="Decrement"
              >
                -
              </button>
              <span className="w-5 text-center font-mono text-mono-num tabular-nums text-cream-100">
                {dc.quantity}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!isLocked) onUpdateQuantity(dc.scryfallId, dc.zone, dc.quantity + 1)
                }}
                disabled={isLocked}
                className={cn(
                  'relative flex h-5 w-5 items-center justify-center border border-hairline font-mono text-mono-tag text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none',
                  'before:absolute before:inset-[-12px] before:content-[""]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
                )}
                aria-label="Increment"
              >
                +
              </button>
            </div>

            {/* Name + type line */}
            <button
              type="button"
              onClick={() => onCardSelect?.(dc.scryfallId)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate font-body text-sm text-cream-100 transition-colors group-hover:text-ink-red-bright">
                {name}
              </p>
              <p className="truncate font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
                {typeLine}
              </p>
            </button>

            {/* CMC */}
            <span className="font-mono text-mono-tag tabular-nums text-cream-400">{cmc}</span>

            {/* Lock toggle */}
            {onToggleLock && (
              <button
                type="button"
                onClick={() => onToggleLock(dc.scryfallId)}
                title={isLocked ? t('cardlist.unlock') : t('cardlist.lock')}
                className={cn(
                  'relative font-mono text-mono-marginal uppercase tracking-mono-marginal transition-colors',
                  'before:absolute before:inset-[-14px] before:content-[""]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
                  isLocked
                    ? 'text-ink-red-bright hover:text-cream-100'
                    : 'invisible text-cream-500 hover:text-cream-100 group-hover:visible',
                )}
              >
                {isLocked ? t('cardlist.unlock') : t('cardlist.lock')}
              </button>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => {
                if (isLocked) return
                if (confirm(t('cardlist.removeConfirm', { name }))) onRemoveCard(dc.scryfallId, dc.zone)
              }}
              disabled={isLocked}
              className={cn(
                'relative invisible font-mono text-mono-label text-cream-500 transition-colors hover:text-ink-red-bright group-hover:visible disabled:invisible',
                'before:absolute before:inset-[-14px] before:content-[""]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              )}
              aria-label="Remove"
            >
              {'\u00D7'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
