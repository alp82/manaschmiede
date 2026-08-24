import { describe, expect, it } from 'vitest'
import { parseEffects } from '../simulation/effects'
import type { CardType, EffectAction } from '../simulation/types'

function actions(oracleText: string, cardType: CardType = 'sorcery'): EffectAction[] {
  return parseEffects(oracleText, cardType).map((e) => e.action)
}

describe('parseEffects', () => {
  it('[R] counts a token whose count Wizards spells out as a word', () => {
    // Wizards spells out counts of objects and prints only the power/toughness
    // box as digits, so a digits-only count group never matched a real card.
    expect(actions('Create a 1/1 white Soldier creature token.')).toEqual([
      { type: 'create_token', count: 1, power: 1, toughness: 1 },
    ])
  })

  it('[R] counts several tokens spelled out as a word', () => {
    expect(actions('Create two 1/1 white Soldier creature tokens.')).toEqual([
      { type: 'create_token', count: 2, power: 1, toughness: 1 },
    ])
  })

  it('[R] mills a count Wizards spells out as a word', () => {
    expect(actions('Target player mills five cards.')).toEqual([{ type: 'mill', count: 5 }])
  })

  it('[R] draws a count Wizards spells out as a word', () => {
    expect(actions('Draw two cards.')).toEqual([{ type: 'draw', count: 2 }])
  })

  it('[R] still reads a count printed as digits', () => {
    // The count group accepts both notations, so a reworded or non-English
    // printing that uses digits still parses.
    expect(actions('Target player mills 5 cards.')).toEqual([{ type: 'mill', count: 5 }])
    expect(actions('Create 3 2/2 black Zombie creature tokens.')).toEqual([
      { type: 'create_token', count: 3, power: 2, toughness: 2 },
    ])
  })

  it('[R] defaults an unstated token count to one', () => {
    expect(actions('Create 1/1 white Soldier creature tokens.')).toEqual([
      { type: 'create_token', count: 1, power: 1, toughness: 1 },
    ])
  })

  it('[R] leaves the power and toughness box out of the count', () => {
    // `Create a 1/1` has three numbers in a row; only the first is a count.
    expect(actions('Create a 4/4 green Beast creature token.')).toEqual([
      { type: 'create_token', count: 1, power: 4, toughness: 4 },
    ])
  })

  it('[R] reads a teens count as itself, not as the word inside it', () => {
    // `seven` matches the front of `seventeen`, so the count group needs a
    // trailing word boundary or a 17-card mill parses as a 7-card mill.
    expect(actions('Target player mills seventeen cards.')).toEqual([{ type: 'mill', count: 17 }])
  })

  it('[R] does not mill on a sentence that only mentions a target player', () => {
    // The count has to come out of the same clause as the target.
    expect(actions('Target player sacrifices a creature. You mill four cards.')).toEqual([])
  })

  it('[R] does not read a draw out of the middle of a longer word', () => {
    expect(actions('Withdraw two cards from the game.')).toEqual([])
  })

  it('[R] gives a creature token maker an ETB trigger', () => {
    expect(parseEffects('Create a 1/1 white Soldier creature token.', 'creature')).toEqual([
      { trigger: 'etb', action: { type: 'create_token', count: 1, power: 1, toughness: 1 } },
    ])
  })
})

describe('parseEffects patterns', () => {
  it('[R] reads a life gain', () => {
    expect(actions('You gain 3 life.')).toEqual([{ type: 'gain_life', amount: 3 }])
  })

  it('[R] reads damage to a target', () => {
    expect(actions('Lightning Bolt deals 3 damage to any target.')).toEqual([
      { type: 'damage', target: 'opponent', amount: 3 },
    ])
  })

  it('[R] reads damage to each opponent', () => {
    expect(actions('This spell deals 2 damage to each opponent.')).toEqual([
      { type: 'damage', target: 'opponent', amount: 2 },
    ])
  })

  it('[R] reads creature removal', () => {
    expect(actions('Destroy target creature.')).toEqual([
      { type: 'destroy', target: 'creature' },
    ])
  })

  it('[R] reads permanent removal', () => {
    expect(actions('Destroy target nonland permanent.')).toEqual([
      { type: 'destroy', target: 'any' },
    ])
  })

  it('[R] reads a land fetch as ramp', () => {
    expect(actions('Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.')).toEqual([
      { type: 'ramp', count: 1 },
    ])
  })

  it('[R] reads a bounce', () => {
    expect(actions("Return target creature to its owner's hand.")).toEqual([
      { type: 'bounce', target: 'creature' },
    ])
  })

  it('[R] reads a life drain', () => {
    expect(actions('Each opponent loses 2 life.')).toEqual([
      { type: 'lose_life', target: 'opponent', amount: 2 },
    ])
  })

  it('[R] reads a temporary pump on one creature', () => {
    expect(actions('Target creature gets +3/+3 until end of turn.')).toEqual([
      { type: 'pump', power: 3, toughness: 3, target: 'self' },
    ])
  })

  it('[R] gives a team pump the static trigger', () => {
    expect(parseEffects('Creatures you control get +1/+1.', 'creature')).toEqual([
      { trigger: 'static', action: { type: 'pump', power: 1, toughness: 1, target: 'team' } },
    ])
  })

  it('[R] reads every pattern a card matches, not just the first', () => {
    const text = 'Draw two cards. You gain 3 life.'

    expect(actions(text)).toEqual([
      { type: 'draw', count: 2 },
      { type: 'gain_life', amount: 3 },
    ])
  })

  it('[R] reads no effect off a card with no oracle text', () => {
    expect(actions('')).toEqual([])
  })

  it('[R] reads no effect off text nothing matches', () => {
    expect(actions('Flying, vigilance')).toEqual([])
  })
})

describe('parseEffects triggers', () => {
  const triggerOf = (cardType: CardType) => parseEffects('Draw a card.', cardType)[0].trigger

  it('[R] fires a creature effect when it enters the battlefield', () => {
    expect(triggerOf('creature')).toBe('etb')
  })

  it.each<CardType>(['instant', 'sorcery'])('[R] fires a %s effect on cast', (cardType) => {
    expect(triggerOf(cardType)).toBe('cast')
  })

  it.each<CardType>(['artifact', 'enchantment', 'planeswalker'])(
    '[R] fires a %s effect on cast',
    (cardType) => {
      // `playCastCard` fires the cast trigger and then puts the permanent onto
      // the battlefield, so a permanent with an ETB written as a cast trigger
      // still resolves in the right order.
      expect(triggerOf(cardType)).toBe('cast')
    },
  )
})
