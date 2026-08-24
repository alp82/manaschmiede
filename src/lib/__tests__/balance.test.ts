/**
 * analyzeDeck's rule-driven warnings after the format concept was deleted
 * (#44). The deck-construction rules are now plain constants in deck-utils —
 * TARGET_DECK_SIZE and MAX_COPIES — instead of a FORMAT_RULES lookup,
 * so these tests pin that the two warnings still fire, and that they carry the
 * constants' values into the message rather than a hard-coded literal.
 *
 * The `t` stub echoes `key|name=value` pairs so an assertion can read the
 * interpolated numbers without depending on either catalog's wording.
 */
import { describe, it, expect } from 'vitest'
import { analyzeDeck } from '../balance'
import { MAX_COPIES, TARGET_DECK_SIZE, type DeckCard } from '../deck-utils'
import type { ScryfallCard } from '../scryfall/types'
import type { TFn } from '../i18n/types'
import { makeBasicLand, makeCard } from './card-fixtures'

const t: TFn = (key, params) => {
  const rendered = Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return rendered ? `${key}|${rendered}` : String(key)
}

/** A deck of `landCount` Forests plus `spellCount` copies of one 2-drop. */
function makeDeck(
  spellCount: number,
  landCount: number,
): { cards: DeckCard[]; cardData: Map<string, ScryfallCard> } {
  const cards: DeckCard[] = []
  if (spellCount > 0) cards.push({ scryfallId: 'bear', quantity: spellCount, zone: 'main' })
  if (landCount > 0) cards.push({ scryfallId: 'forest', quantity: landCount, zone: 'main' })
  const cardData = new Map<string, ScryfallCard>([
    ['bear', makeCard('bear', ['G'])],
    ['forest', makeBasicLand('forest', 'Forest', ['G'])],
  ])
  return { cards, cardData }
}

function messagesFor(warnings: { message: string }[], key: string): string[] {
  return warnings.map((w) => w.message).filter((m) => m.startsWith(key))
}

describe('analyzeDeck — deck size warning (TARGET_DECK_SIZE)', () => {
  it('fires on a short deck and reports TARGET_DECK_SIZE as the target', () => {
    const { cards, cardData } = makeDeck(4, 20)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(analysis.maindeckSize).toBe(24)
    expect(messagesFor(analysis.warnings, 'balance.warning.tooFewCards')).toEqual([
      `balance.warning.tooFewCards|count=24,min=${TARGET_DECK_SIZE}`,
    ])
  })

  it('is silent at exactly TARGET_DECK_SIZE cards', () => {
    const { cards, cardData } = makeDeck(TARGET_DECK_SIZE - 24, 24)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(analysis.maindeckSize).toBe(TARGET_DECK_SIZE)
    expect(messagesFor(analysis.warnings, 'balance.warning.tooFewCards')).toEqual([])
  })

  it('is silent one card over, too — 60 is a target, not a floor', () => {
    const { cards, cardData } = makeDeck(TARGET_DECK_SIZE - 23, 24)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(analysis.maindeckSize).toBe(TARGET_DECK_SIZE + 1)
    expect(messagesFor(analysis.warnings, 'balance.warning.tooFewCards')).toEqual([])
  })
})

describe('analyzeDeck — copy limit warning (MAX_COPIES)', () => {
  it('fires on a fifth copy and reports MAX_COPIES as the cap', () => {
    const { cards, cardData } = makeDeck(MAX_COPIES + 1, 24)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(messagesFor(analysis.warnings, 'balance.warning.tooManyCopies')).toEqual([
      `balance.warning.tooManyCopies|name=Card bear,count=${MAX_COPIES + 1},max=${MAX_COPIES}`,
    ])
  })

  it('is silent at exactly MAX_COPIES copies', () => {
    const { cards, cardData } = makeDeck(MAX_COPIES, 24)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(messagesFor(analysis.warnings, 'balance.warning.tooManyCopies')).toEqual([])
  })

  it('exempts basic lands — 36 Forests is not 32 copies too many', () => {
    const { cards, cardData } = makeDeck(MAX_COPIES, 36)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(analysis.landCount).toBe(36)
    expect(messagesFor(analysis.warnings, 'balance.warning.tooManyCopies')).toEqual([])
  })
})

describe('analyzeDeck — no sideboard', () => {
  it('never emits a sideboard warning, even for an oversized deck', () => {
    const { cards, cardData } = makeDeck(MAX_COPIES, 100)
    const analysis = analyzeDeck(cards, cardData, t)

    expect(messagesFor(analysis.warnings, 'balance.warning.sideboardTooLarge')).toEqual([])
  })

  it('counts only main-zone cards toward maindeckSize', () => {
    const cards: DeckCard[] = [
      { scryfallId: 'bear', quantity: 4, zone: 'main' },
      // A deck persisted before the sideboard zone was deleted (#44). It is
      // ignored, not counted — the accepted cost recorded in the ADR.
      { scryfallId: 'bear', quantity: 15, zone: 'sideboard' } as unknown as DeckCard,
    ]
    const cardData = new Map<string, ScryfallCard>([['bear', makeCard('bear', ['G'])]])

    expect(analyzeDeck(cards, cardData, t).maindeckSize).toBe(4)
  })
})
