import type {
  CardEffect,
  GameState,
  Keyword,
  ManaColor,
  ManaCost,
  Permanent,
  PlayerState,
  SimCard,
} from '../simulation/types'
import { emptyPool } from '../simulation/mana'

/**
 * Shared fixtures for the `src/lib/simulation` suite.
 *
 * A game is a pure function of the two starting libraries: `runTurn` takes an
 * `rng` but never calls it, so the only randomness is the opening shuffle plus
 * one shuffle per mulligan. Pass `RIGGED_RNG` to make even those the identity
 * shuffle, and the library is the deck array in order.
 */

/**
 * Fisher-Yates with this value swaps every element with itself, so the library
 * keeps the deck array's order: the opening hand is `deck[0..6]` and draws come
 * off the *end* of the array.
 */
export const RIGGED_RNG = () => 0.9999999999

export function cost(
  generic: number,
  colored: Partial<Record<ManaColor, number>> = {},
): ManaCost {
  const coloredCount = Object.values(colored).reduce((a, b) => a + b, 0)
  return { generic, colored, cmc: generic + coloredCount }
}

export function simCard(overrides: Partial<SimCard> & { id: string }): SimCard {
  return {
    name: overrides.id,
    cardType: 'creature',
    cost: cost(0, { G: 1 }),
    power: 1,
    toughness: 1,
    keywords: new Set<Keyword>(),
    producesColors: [],
    effects: [],
    isBasicLand: false,
    ...overrides,
  }
}

export function land(id: string, producesColors: ManaColor[]): SimCard {
  return simCard({
    id,
    cardType: 'land',
    cost: null,
    power: 0,
    toughness: 0,
    producesColors,
    isBasicLand: true,
  })
}

export function forest(id = 'forest'): SimCard {
  return land(id, ['G'])
}

/** A non-creature permanent, which is what `parsePT(undefined)` yields: 0/0. */
export function nonCreature(
  id: string,
  cardType: 'artifact' | 'enchantment' | 'planeswalker',
  effects: CardEffect[] = [],
): SimCard {
  return simCard({ id, cardType, power: 0, toughness: 0, effects })
}

export function permanent(card: SimCard, overrides: Partial<Permanent> = {}): Permanent {
  return {
    card,
    tapped: false,
    summoningSick: false,
    damage: 0,
    counters: 0,
    markedForDeath: false,
    ...overrides,
  }
}

/** Pads `cards` out to a legal 60-card deck with copies of `filler`. */
export function deckOf(cards: SimCard[], filler: SimCard): SimCard[] {
  const deck = [...cards]
  for (let i = deck.length; i < 60; i++) {
    deck.push({ ...filler, id: `${filler.id}-${i}` })
  }
  return deck
}

export function playerWith(battlefield: Permanent[]): PlayerState {
  return {
    life: 20,
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    landDropsRemaining: 1,
    manaPool: emptyPool(),
  }
}

/** A mid-combat state with player 0 active. */
export function stateWith(p0: Permanent[], p1: Permanent[]): GameState {
  return {
    players: [playerWith(p0), playerWith(p1)],
    turn: 1,
    activePlayer: 0,
    phase: 'combat',
  }
}
