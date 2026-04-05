import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardName, getCardImageUri } from '../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../lib/deck-utils'
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

export function DeckCardList({ cards, cardData, zone, onUpdateQuantity, onRemoveCard, onCardSelect, onToggleLock }: DeckCardListProps) {
  const t = useT()
  const zoneCards = cards.filter((c) => c.zone === zone)

  if (zoneCards.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-surface-500">
        {t('cardlist.noCards')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
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
            className={`group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-700/50 ${
              isLocked ? 'border-l-2 border-mana-green/50' : ''
            }`}
          >
            {imageUrl && (
              <img src={imageUrl} alt={name} className="h-8 w-6 rounded object-cover" />
            )}
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
                className="flex h-5 w-5 items-center justify-center rounded bg-surface-700 text-xs text-surface-300 hover:bg-surface-600 disabled:opacity-30"
              >
                -
              </button>
              <span className="w-4 text-center text-sm font-medium text-surface-200">
                {dc.quantity}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!isLocked) onUpdateQuantity(dc.scryfallId, dc.zone, dc.quantity + 1)
                }}
                disabled={isLocked}
                className="flex h-5 w-5 items-center justify-center rounded bg-surface-700 text-xs text-surface-300 hover:bg-surface-600 disabled:opacity-30"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => onCardSelect?.(dc.scryfallId)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm text-surface-100 hover:text-accent">{name}</p>
              <p className="truncate text-[10px] text-surface-500">{typeLine}</p>
            </button>
            <span className="text-xs text-surface-500">{cmc}</span>
            {onToggleLock && (
              <button
                type="button"
                onClick={() => onToggleLock(dc.scryfallId)}
                title={isLocked ? t('cardlist.unlock') : t('cardlist.lock')}
                className={`text-xs transition-colors ${
                  isLocked
                    ? 'text-mana-green hover:text-mana-green/70'
                    : 'invisible text-surface-500 hover:text-surface-300 group-hover:visible'
                }`}
              >
                {isLocked ? '\u{1F512}' : '\u{1F513}'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLocked) return
                if (confirm(t('cardlist.removeConfirm', { name }))) onRemoveCard(dc.scryfallId, dc.zone)
              }}
              disabled={isLocked}
              className="invisible text-surface-500 hover:text-mana-red group-hover:visible disabled:invisible"
            >
              x
            </button>
          </div>
        )
      })}
    </div>
  )
}
