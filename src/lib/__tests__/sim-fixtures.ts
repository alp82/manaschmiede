import type {
  CardEffect,
  GameState,
  Keyword,
  ManaColor,
  ManaCost,
  ManaPip,
  ManaSource,
  Permanent,
  PlayerState,
  SimCard,
} from '../simulation/types'
import { manaSources } from '../simulation/mana'

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

/**
 * A cost with one single-color pip per count in `colored`, in the order
 * `colored` lists them. Hybrid, colorless, and snow pips have no shorthand
 * here - a test that wants one builds it through `parseCost`.
 */
export function cost(
  generic: number,
  colored: Partial<Record<ManaColor, number>> = {},
): ManaCost {
  const pips: ManaPip[] = []
  for (const [color, count] of Object.entries(colored) as [ManaColor, number][]) {
    for (let i = 0; i < count; i++) pips.push({ kind: 'color', colors: [color] })
  }
  return { generic, pips, cmc: generic + pips.length }
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
    isSnow: false,
    ...overrides,
  }
}

/**
 * `isBasicLand` defaults to true because most fixtures want a basic. Pass false
 * for a dual or any other nonbasic - ramp effects fetch on that flag, so a
 * "basic" gain land is a trap for whoever reuses the fixture next.
 */
export function land(
  id: string,
  producesColors: ManaColor[],
  isBasicLand = true,
  isSnow = false,
): SimCard {
  return simCard({
    id,
    cardType: 'land',
    cost: null,
    power: 0,
    toughness: 0,
    producesColors,
    isBasicLand,
    isSnow,
  })
}

/** The mana of a board holding one untapped land per entry in `lands`. */
export function sourcesOf(...lands: SimCard[]): ManaSource[] {
  return manaSources(lands.map((c) => permanent(c)))
}

/** The land names behind `sources` - what a payment is really about. */
export function sourceNames(sources: readonly ManaSource[] | null): string[] | null {
  return sources === null ? null : sources.map((s) => s.permanent.card.name)
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
    deathtouched: false,
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
    spellsCastThisTurn: 0,
  }
}

/** A mid-combat state with player 0 active. */
export function stateWith(p0: Permanent[], p1: Permanent[]): GameState {
  return {
    players: [playerWith(p0), playerWith(p1)],
    round: 1,
    activePlayer: 0,
    phase: 'combat',
  }
}
