import type {
  CardEffect,
  EffectTrigger,
  GameResult,
  GameState,
  Permanent,
  PlayerState,
  SimCard,
} from './types'
import { manaSources } from './mana'
import { resolveCombat } from './combat'
import { isDestroyedBySba } from './state-based-actions'
import {
  shouldMulligan,
  chooseLand,
  chooseCasts,
  chooseAttackers,
  chooseBlockers,
} from './ai'

/**
 * The cap on rounds - one round being a turn for each player, which is what
 * `GameResult.turns` counts.
 *
 * A board stall is meant to be broken by decking, not by this cap: behind a
 * seven-card opener a 60-card deck has 53 cards left, so the player on the draw
 * attempts their 54th draw on round 54, and each mulligan pushes that out by
 * one. The cap sits above the worst case, so a reported draw means the two
 * decks genuinely cannot kill each other rather than that the simulation gave
 * up.
 */
export const MAX_TURNS = 60

/** Turns a player is expected to cast something on for `curveHit`. */
const CURVE_TURNS = [2, 3, 4]

/** Fewer lands than this in play at the end of turn 4 is mana screw. */
const SCREW_LANDS = 3
const SCREW_TURN = 4

/**
 * Mana flood is sampled once, at the end of turn 8: this many lands in play
 * and fewer than `FLOOD_HAND_SPELLS` non-lands left to cast.
 *
 * Sampling at the end of the game instead reported flood for almost every
 * game, because a game that runs long ends with everyone holding lands they
 * can't use - the metric was measuring game length, not draws.
 */
const FLOOD_LANDS = 7
const FLOOD_HAND_SPELLS = 2
const FLOOD_TURN = 8

let tokenSeq = 0

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function createPlayer(deck: SimCard[], rng: () => number): PlayerState {
  let library = shuffle(deck, rng)
  let hand = library.splice(0, 7)
  let mulliganCount = 0

  while (shouldMulligan(hand, mulliganCount)) {
    mulliganCount++
    library = shuffle(deck, rng)
    hand = library.splice(0, 7 - mulliganCount)
  }

  return {
    life: 20,
    library,
    hand,
    battlefield: [],
    graveyard: [],
    landDropsRemaining: 1,
    spellsCastThisTurn: 0,
  }
}

function drawCard(player: PlayerState): boolean {
  if (player.library.length === 0) return false
  player.hand.push(player.library.pop()!)
  return true
}

function makePermanent(card: SimCard, hasteOverride?: boolean): Permanent {
  return {
    card,
    tapped: false,
    summoningSick: hasteOverride ? false : !card.keywords.has('haste'),
    damage: 0,
    counters: 0,
    markedForDeath: false,
  }
}

export function stateBasedActions(state: GameState): void {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi as 0 | 1]
    const dead: Permanent[] = []
    player.battlefield = player.battlefield.filter((p) => {
      if (isDestroyedBySba(p)) {
        dead.push(p)
        return false
      }
      return true
    })
    for (const d of dead) {
      player.graveyard.push(d.card)
      triggerEffects(d, 'death', state, pi as 0 | 1)
    }
  }
}

function triggerEffects(
  permanent: Permanent,
  trigger: EffectTrigger,
  state: GameState,
  controller: 0 | 1,
): void {
  const effects = permanent.card.effects.filter((e) => e.trigger === trigger)
  for (const effect of effects) {
    applyEffect(effect, state, controller)
  }
}

function applyEffect(
  effect: CardEffect,
  state: GameState,
  controller: 0 | 1,
): void {
  const player = state.players[controller]
  const opponent = state.players[(1 - controller) as 0 | 1]
  const action = effect.action

  switch (action.type) {
    case 'draw':
      for (let i = 0; i < action.count; i++) drawCard(player)
      break
    case 'gain_life':
      player.life += action.amount
      break
    case 'lose_life':
      opponent.life -= action.amount
      break
    case 'damage':
      if (action.target === 'opponent') {
        opponent.life -= action.amount
      } else {
        const creatures = opponent.battlefield.filter((p) => p.card.cardType === 'creature')
        if (creatures.length > 0) {
          const biggest = creatures.reduce((a, b) => (b.card.power > a.card.power ? b : a))
          biggest.damage += action.amount
        }
      }
      break
    case 'destroy': {
      const targets = opponent.battlefield.filter((p) =>
        action.target === 'creature'
          ? p.card.cardType === 'creature'
          : p.card.cardType !== 'land',
      )
      if (targets.length > 0) {
        const biggest = targets.reduce((a, b) => (b.card.power > a.card.power ? b : a))
        if (!biggest.card.keywords.has('indestructible')) {
          biggest.markedForDeath = true
        }
      }
      break
    }
    case 'pump':
      if (action.target === 'self') {
        // A no-op, not an approximation: the sim has no end-of-turn cleanup, so
        // a temporary buff would have nowhere to expire. See `EffectAction`.
      } else {
        // Static team pump - add counters as approximation. Unreachable today:
        // nothing fires the `'static'` trigger this action arrives on.
        for (const p of player.battlefield) {
          if (p.card.cardType === 'creature') {
            p.counters += 1
          }
        }
      }
      break
    case 'create_token':
      for (let i = 0; i < action.count; i++) {
        const tokenCard: SimCard = {
          id: `token-${tokenSeq++}`,
          name: 'Token',
          cardType: 'creature',
          cost: null,
          power: action.power,
          toughness: action.toughness,
          keywords: new Set(),
          producesColors: [],
          effects: [],
          isBasicLand: false,
        }
        player.battlefield.push(makePermanent(tokenCard, true))
      }
      break
    case 'mill':
      for (let i = 0; i < action.count; i++) {
        if (opponent.library.length > 0) {
          opponent.graveyard.push(opponent.library.pop()!)
        }
      }
      break
    case 'bounce': {
      const creatures = opponent.battlefield.filter((p) => p.card.cardType === 'creature')
      if (creatures.length > 0) {
        const biggest = creatures.reduce((a, b) => ((b.card.cost?.cmc ?? 0) > (a.card.cost?.cmc ?? 0) ? b : a))
        opponent.battlefield = opponent.battlefield.filter((p) => p !== biggest)
        opponent.hand.push(biggest.card)
      }
      break
    }
    case 'ramp': {
      // Remove by index: `parseDeck` aliases the copies of a card, so an
      // identity filter would take the whole playset out at once.
      for (let i = 0; i < action.count; i++) {
        const idx = player.library.findIndex((c) => c.isBasicLand)
        if (idx === -1) break
        const land = player.library.splice(idx, 1)[0]
        player.battlefield.push(makePermanent(land, true))
      }
      break
    }
    case 'counter_spell':
      break
  }
}


function playCastCard(card: SimCard, player: PlayerState, state: GameState, active: 0 | 1) {
  if (card.cardType === 'creature') {
    const perm = makePermanent(card)
    player.battlefield.push(perm)
    triggerEffects(perm, 'etb', state, active)
  } else if (card.cardType === 'enchantment' || card.cardType === 'artifact' || card.cardType === 'planeswalker') {
    const tempPerm = makePermanent(card, true)
    triggerEffects(tempPerm, 'cast', state, active)
    const perm = makePermanent(card, true)
    player.battlefield.push(perm)
    triggerEffects(perm, 'etb', state, active)
  } else {
    const tempPerm: Permanent = { card, tapped: false, summoningSick: false, damage: 0, counters: 0, markedForDeath: false }
    triggerEffects(tempPerm, 'cast', state, active)
    player.graveyard.push(card)
  }
}

/**
 * Casts what the AI picks and taps the lands that paid for it.
 *
 * The lands are tapped before the cards resolve. A card resolving can put a
 * land onto the battlefield - a ramp effect does - and that land was never one
 * of the sources being spent, so it must not be swept up in the tapping.
 */
function runMainPhase(state: GameState): void {
  const active = state.activePlayer
  const player = state.players[active]
  const opponent = state.players[(1 - active) as 0 | 1]

  const { indices, spent } = chooseCasts(
    player.hand,
    manaSources(player.battlefield),
    opponent.battlefield,
  )

  const castCards: SimCard[] = []
  for (const idx of [...indices].sort((a, b) => b - a)) {
    castCards.push(player.hand.splice(idx, 1)[0])
  }

  for (const p of spent) p.tapped = true

  for (const card of castCards) {
    playCastCard(card, player, state, active)
    player.spellsCastThisTurn++
  }
}

/**
 * How a turn ended. A win carries the condition, because losing to an empty
 * library and losing to damage are different results and the panel reports the
 * difference.
 */
export type TurnOutcome =
  | { kind: 'continue' }
  | { kind: 'win'; winner: 0 | 1; condition: 'life' | 'mill' }

const CONTINUE: TurnOutcome = { kind: 'continue' }

function lifeWin(winner: 0 | 1): TurnOutcome {
  return { kind: 'win', winner, condition: 'life' }
}

export function runTurn(state: GameState, rng: () => number): TurnOutcome {
  const active = state.activePlayer
  const defending = (1 - active) as 0 | 1
  const player = state.players[active]
  const opponent = state.players[defending]

  // Untap
  for (const p of player.battlefield) {
    p.tapped = false
    p.summoningSick = false
    p.damage = 0
  }
  // Also clear damage on opponent's creatures at start of turn
  for (const p of opponent.battlefield) {
    p.damage = 0
  }
  player.landDropsRemaining = 1
  player.spellsCastThisTurn = 0

  // Upkeep triggers
  for (const p of player.battlefield) {
    triggerEffects(p, 'upkeep', state, active)
  }

  // Draw (skip first player's first turn). A player who cannot draw loses on
  // the attempt - an empty library is not itself a loss, which is why nothing
  // checks library size between turns.
  if (!(state.turn === 1 && active === 0)) {
    if (!drawCard(player)) {
      return { kind: 'win', winner: defending, condition: 'mill' }
    }
  }

  // Main phase 1
  const landIdx = chooseLand(player.hand, player.battlefield)
  if (landIdx >= 0 && player.landDropsRemaining > 0) {
    const land = player.hand.splice(landIdx, 1)[0]
    const perm = makePermanent(land, true)
    perm.summoningSick = false
    player.battlefield.push(perm)
    player.landDropsRemaining--
  }

  runMainPhase(state)

  stateBasedActions(state)
  if (opponent.life <= 0) return lifeWin(active)
  if (player.life <= 0) return lifeWin(defending)

  // Combat
  const attackerIndices = chooseAttackers(player.battlefield, opponent.battlefield, opponent.life)

  if (attackerIndices.length > 0) {
    const attackerInfo = attackerIndices.map((i) => ({
      permanent: player.battlefield[i],
      index: i,
    }))
    const blockerMap = chooseBlockers(opponent.battlefield, attackerInfo, opponent.life)
    resolveCombat(attackerIndices, blockerMap, state)
    stateBasedActions(state)
  }

  if (opponent.life <= 0) return lifeWin(active)
  if (player.life <= 0) return lifeWin(defending)

  // Main phase 2. Lands spent in main 1 are still tapped, so only what the
  // player held back is available here.
  runMainPhase(state)

  stateBasedActions(state)
  if (opponent.life <= 0) return lifeWin(active)
  if (player.life <= 0) return lifeWin(defending)

  // End: discard to 7
  // Heuristic: discard excess lands first (if > 5 lands in play), then highest CMC
  while (player.hand.length > 7) {
    const landsInPlay = player.battlefield.filter((p) => p.card.cardType === 'land').length
    let worstIdx = -1
    if (landsInPlay > 5) {
      for (let i = 0; i < player.hand.length; i++) {
        if (player.hand[i].cardType === 'land') { worstIdx = i; break }
      }
    }
    if (worstIdx === -1) {
      let highestCmc = -1
      for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i]
        const cmc = card.cardType === 'land' ? -1 : (card.cost?.cmc ?? 0)
        if (cmc > highestCmc) { highestCmc = cmc; worstIdx = i }
      }
    }
    player.graveyard.push(player.hand.splice(worstIdx, 1)[0])
  }

  return CONTINUE
}

/** The last turn `CURVE_TURNS` asks about, so the turn the metric is complete. */
const CURVE_TURN = Math.max(...CURVE_TURNS)

/** What one player's game looked like, for the metrics the panel reports. */
interface PlayerObservations {
  /** One flag per entry in `CURVE_TURNS`: did the player cast anything? */
  castOnCurve: boolean[]
  screwed: boolean
  flooded: boolean
  /** The last turn this player took. A metric sampled after it never happened. */
  lastTurn: number
}

function blankObservations(): PlayerObservations {
  return {
    castOnCurve: CURVE_TURNS.map(() => false),
    screwed: false,
    flooded: false,
    lastTurn: 0,
  }
}

/**
 * Samples the mana metrics at the end of `player`'s turn `turn`.
 *
 * Every one of these is a fixed-turn snapshot on purpose. Read at the end of
 * the game instead, screw and flood report on how long the game ran rather
 * than on how the player's draws went.
 */
function observe(obs: PlayerObservations, player: PlayerState, turn: number): void {
  obs.lastTurn = turn

  const curveIdx = CURVE_TURNS.indexOf(turn)
  if (curveIdx >= 0 && player.spellsCastThisTurn > 0) obs.castOnCurve[curveIdx] = true

  const lands = player.battlefield.filter((p) => p.card.cardType === 'land').length

  if (turn === SCREW_TURN) obs.screwed = lands < SCREW_LANDS

  if (turn === FLOOD_TURN) {
    const spellsInHand = player.hand.filter((c) => c.cardType !== 'land').length
    obs.flooded = lands >= FLOOD_LANDS && spellsInHand < FLOOD_HAND_SPELLS
  }
}

/**
 * The metric, or `null` when the game ended before its sample turn.
 *
 * Counting an unsampled game as a miss is the length confound the fixed-turn
 * sample was meant to remove, coming back through the denominator: a deck that
 * wins on turn six can't flood on turn eight, so reporting flood over every
 * game makes a fast deck look disciplined and a slow one look greedy.
 * `runSimulation` divides by the games that reached the turn instead.
 */
function sampledAt(sampleTurn: number, obs: PlayerObservations, value: boolean): boolean | null {
  return obs.lastTurn >= sampleTurn ? value : null
}

export function runGame(deckA: SimCard[], deckB: SimCard[], rng: () => number): GameResult {
  const state: GameState = {
    players: [createPlayer(deckA, rng), createPlayer(deckB, rng)],
    turn: 0,
    activePlayer: 0,
    phase: 'untap',
  }

  const observations: [PlayerObservations, PlayerObservations] = [
    blankObservations(),
    blankObservations(),
  ]

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    state.turn = turn

    for (let active = 0; active < 2; active++) {
      state.activePlayer = active as 0 | 1
      const outcome = runTurn(state, rng)
      observe(observations[active], state.players[active as 0 | 1], turn)

      if (outcome.kind === 'win') {
        return makeResult(outcome.winner, turn, outcome.condition, observations)
      }
    }
  }

  return makeResult(-1, MAX_TURNS, 'draw', observations)
}

function makeResult(
  winner: 0 | 1 | -1,
  turns: number,
  winCondition: 'life' | 'mill' | 'draw',
  observations: [PlayerObservations, PlayerObservations],
): GameResult {
  return {
    winner,
    turns,
    winCondition,
    manaScrew: [
      sampledAt(SCREW_TURN, observations[0], observations[0].screwed),
      sampledAt(SCREW_TURN, observations[1], observations[1].screwed),
    ],
    manaFlood: [
      sampledAt(FLOOD_TURN, observations[0], observations[0].flooded),
      sampledAt(FLOOD_TURN, observations[1], observations[1].flooded),
    ],
    curveHit: [
      sampledAt(CURVE_TURN, observations[0], observations[0].castOnCurve.every(Boolean)),
      sampledAt(CURVE_TURN, observations[1], observations[1].castOnCurve.every(Boolean)),
    ],
  }
}
