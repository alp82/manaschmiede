import type { ScryfallCard } from './scryfall/types'

/**
 * A single change row in the AI-generated deck diff ledger.
 * Leaf type: imported by deck-diff.ts, useDeckChat.ts, AiChat.tsx, and the
 * deck route. Lives here so the pure helper (deck-diff.ts) does not have to
 * import from a React hook module.
 */
export interface CardChange {
  name: string
  scryfallId: string
  scryfallCard?: ScryfallCard
  type: 'added' | 'removed' | 'changed'
  oldQuantity: number
  newQuantity: number
}
