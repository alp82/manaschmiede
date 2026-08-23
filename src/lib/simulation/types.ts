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

export type EffectTrigger = 'etb' | 'death' | 'upkeep' | 'attack' | 'cast' | 'static'

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
}

export type Phase = 'untap' | 'upkeep' | 'draw' | 'main1' | 'combat' | 'main2' | 'end'

export interface GameState {
  players: [PlayerState, PlayerState]
  turn: number
  activePlayer: 0 | 1
  phase: Phase
}

export interface GameResult {
  winner: 0 | 1 | -1
  turns: number
  winCondition: 'life' | 'mill' | 'draw'
  p0ManaScrew: boolean
  p1ManaScrew: boolean
  p0ManaFlood: boolean
  p1ManaFlood: boolean
  p0CurveHit: boolean
  p1CurveHit: boolean
}

export interface SimulationResult {
  totalGames: number
  wins: [number, number]
  draws: number
  avgTurns: number
  medianTurns: number
  manaScrewRate: number
  manaFloodRate: number
  curveHitRate: number
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
