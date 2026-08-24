export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G'

export interface ManaCost {
  generic: number
  colored: Partial<Record<ManaColor, number>>
  cmc: number
}

/**
 * One untapped land and the colors it can tap for. An empty list is colorless.
 *
 * A land is worth one mana but not necessarily one color: a dual land is a
 * single source whose color is chosen at the moment it pays for something.
 * Counting the battlefield into a pool of colored mana would force that choice
 * up front, before anything is known about what needs paying, so the
 * battlefield stays a list of sources until a cost consumes them.
 */
export interface ManaSource {
  permanent: Permanent
  colors: readonly ManaColor[]
}

export type CardType =
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'enchantment'
  | 'artifact'
  | 'planeswalker'
  | 'land'
  | 'other'

export type Keyword =
  | 'flying'
  | 'reach'
  | 'first_strike'
  | 'double_strike'
  | 'deathtouch'
  | 'trample'
  | 'lifelink'
  | 'menace'
  | 'vigilance'
  | 'indestructible'
  | 'defender'
  | 'haste'
  | 'flash'
  | 'hexproof'

/**
 * When an effect fires. Only two of these six round-trip today - an effect
 * reaches the game only if `parseEffects` emits its trigger and `game-state`
 * fires it:
 *
 * - `'etb'` and `'cast'` are emitted and fired. Everything the sim models runs
 *   through these two.
 * - `'static'` is emitted - by the lord pattern - but never fired, so lords do
 *   nothing.
 * - `'death'` and `'upkeep'` are fired but never emitted, so nothing listens.
 * - `'attack'` is neither emitted nor fired.
 *
 * Closing a gap means a change on both sides: a pattern that emits the trigger
 * and a `triggerEffects` call that fires it.
 */
export type EffectTrigger = 'etb' | 'death' | 'upkeep' | 'attack' | 'cast' | 'static'

/**
 * What an effect does. Four variants are inert and should not be read as
 * modelled behaviour:
 *
 * - `pump` with `target: 'self'` is a deliberate no-op - the sim has no
 *   end-of-turn cleanup, so a temporary buff has nowhere to expire.
 * - `pump` with `target: 'team'` is applied, but only ever on the `'static'`
 *   trigger, which nothing fires.
 * - `counter_spell` is never emitted by `parseEffects` and applies as a bare
 *   `break`.
 * - `damage` with `target: 'any_creature'` is applied but unreachable from
 *   `parseEffects`: the damage pattern always emits `target: 'opponent'`.
 */
export type EffectAction =
  | { type: 'draw'; count: number }
  | { type: 'gain_life'; amount: number }
  | { type: 'lose_life'; target: 'opponent'; amount: number }
  | { type: 'damage'; target: 'opponent' | 'any_creature'; amount: number }
  | { type: 'destroy'; target: 'creature' | 'any' }
  | { type: 'pump'; power: number; toughness: number; target: 'self' | 'team' }
  | { type: 'create_token'; power: number; toughness: number; count: number }
  | { type: 'mill'; count: number }
  | { type: 'counter_spell' }
  | { type: 'bounce'; target: 'creature' }
  | { type: 'ramp'; count: number }

export interface CardEffect {
  trigger: EffectTrigger
  action: EffectAction
}

export interface SimCard {
  id: string
  name: string
  cardType: CardType
  cost: ManaCost | null
  power: number
  toughness: number
  keywords: Set<Keyword>
  producesColors: ManaColor[]
  effects: CardEffect[]
  isBasicLand: boolean
}

export interface Permanent {
  card: SimCard
  tapped: boolean
  summoningSick: boolean
  damage: number
  counters: number
  markedForDeath: boolean
}

/**
 * An attacking creature paired with its index on the attacker's battlefield.
 *
 * Blocker assignments are keyed by that index, so the index has to travel with
 * the permanent everywhere combat decisions are made.
 */
export interface DeclaredAttacker {
  permanent: Permanent
  index: number
}

export interface PlayerState {
  life: number
  library: SimCard[]
  hand: SimCard[]
  battlefield: Permanent[]
  graveyard: SimCard[]
  landDropsRemaining: number
  /**
   * Spells cast so far in the current turn, reset at untap alongside
   * `landDropsRemaining`. "Did this player use their turn" is not readable off
   * the battlefield: a creature cast on turn 2 is still standing on turn 4, so
   * a board check reports a curve hit for a player who cast nothing since.
   */
  spellsCastThisTurn: number
}

export type Phase = 'untap' | 'upkeep' | 'draw' | 'main1' | 'combat' | 'main2' | 'end'

export interface GameState {
  players: [PlayerState, PlayerState]
  turn: number
  activePlayer: 0 | 1
  phase: Phase
}

/**
 * One game's outcome, in seat order: index 0 is the player on the play.
 *
 * `runSimulation` alternates which deck takes which seat, so a result is
 * re-seated before it is counted. Reading these fields as "deck A" and "deck B"
 * is only correct for the half of the games where that happens to be true.
 */
export interface GameResult {
  winner: 0 | 1 | -1
  turns: number
  winCondition: 'life' | 'mill' | 'draw'
  manaScrew: PerPlayer<boolean>
  manaFlood: PerPlayer<boolean>
  curveHit: PerPlayer<boolean>
}

/**
 * One value per player, in seat order: `[player 0, player 1]`.
 *
 * The mana metrics used to be single numbers aggregated from player 0 alone
 * while the panel labelled them as if they described the matchup. In a mirror
 * that reads as harmless; against a different opponent deck it reports one
 * deck's draws under the matchup's name.
 */
export type PerPlayer<T> = [T, T]

export type PerPlayerRate = PerPlayer<number>

export interface SimulationResult {
  totalGames: number
  /** Games won, by deck: `[deck A, deck B]`, across both seats. */
  wins: [number, number]
  /**
   * Games won by seat: `[on the play, on the draw]`. Reported separately
   * because it answers a different question from `wins` - how much this
   * matchup turns on who moves first, rather than on which deck is better.
   */
  seatWins: [number, number]
  draws: number
  /** Games ending each way. `draw` is `draws`, repeated here for completeness. */
  winConditions: Record<GameResult['winCondition'], number>
  avgTurns: number
  medianTurns: number
  manaScrewRate: PerPlayerRate
  manaFloodRate: PerPlayerRate
  curveHitRate: PerPlayerRate
  /**
   * Wilson interval for deck A's win rate, over every game played. The
   * denominator is `totalGames`, the same one the panel's win and draw
   * percentages use, so the headline number always sits inside its interval.
   */
  winRateCI95: [number, number]
  elapsed: number
  turnDistribution: number[]
}

export type WorkerIncoming =
  | { type: 'start'; deckA: SerializedSimCard[]; deckB: SerializedSimCard[]; games: number; seed: number }
  | { type: 'cancel' }

export type WorkerOutgoing =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; result: SimulationResult }
  | { type: 'error'; message: string }

export interface SimulationState {
  status: 'idle' | 'running' | 'done' | 'error'
  progress: number
  result: SimulationResult | null
  error: string | null
  /**
   * The seed the current run was started with, so the UI can show it and offer
   * an identical re-run. Only meaningful once `status` has left `'idle'` - a
   * seed is chosen per run, and `0` is the placeholder before the first one.
   */
  seed: number
}

export interface SerializedSimCard {
  id: string
  name: string
  cardType: CardType
  cost: ManaCost | null
  power: number
  toughness: number
  keywords: Keyword[]
  producesColors: ManaColor[]
  effects: CardEffect[]
  isBasicLand: boolean
}

export function serializeSimCard(card: SimCard): SerializedSimCard {
  return {
    ...card,
    keywords: [...card.keywords],
  }
}

export function deserializeSimCard(data: SerializedSimCard): SimCard {
  return {
    ...data,
    keywords: new Set(data.keywords),
  }
}
