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
