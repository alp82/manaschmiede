import type {
  CardEffect,
  EffectTrigger,
  GameResult,
  GameState,
  ManaColor,
  Permanent,
  PlayerState,
  SimCard,
} from './types'
import { emptyPool, MANA_COLORS } from './mana'
import { resolveCombat } from './combat'
import {
  shouldMulligan,
  chooseLand,
  chooseCasts,
  chooseAttackers,
  chooseBlockers,
} from './ai'

const MAX_TURNS = 50
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
    manaPool: emptyPool(),
  }
}

function drawCard(player: PlayerState): boolean {
  if (player.library.length === 0) return false
  player.hand.push(player.library.pop()!)
  return true
}

function generateMana(player: PlayerState): void {
  player.manaPool = emptyPool()
  for (const p of player.battlefield) {
    if (p.card.cardType === 'land' && !p.tapped) {
      if (p.card.producesColors.length > 0) {
        player.manaPool.colors[p.card.producesColors[0]] += 1
      } else {
        player.manaPool.colorless += 1
      }
    }
  }
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

function stateBasedActions(state: GameState): void {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi as 0 | 1]
    const dead: Permanent[] = []
    player.battlefield = player.battlefield.filter((p) => {
      if (p.markedForDeath || (p.card.cardType !== 'land' && p.damage >= p.card.toughness && !p.card.keywords.has('indestructible'))) {
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
        // Temporary pump doesn't persist in sim, but we approximate by adding damage capacity
        // This is handled implicitly by combat — we don't model end-of-turn cleanup
      } else {
        // Static team pump - add counters as approximation
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
      const basicLands = player.library.filter((c) => c.isBasicLand)
      for (let i = 0; i < action.count && basicLands.length > 0; i++) {
        const land = basicLands.pop()!
        player.library = player.library.filter((c) => c !== land)
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

function runTurn(state: GameState, rng: () => number): 'continue' | 'p0_wins' | 'p1_wins' | 'p0_mill' | 'p1_mill' {
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

  // Upkeep triggers
  for (const p of player.battlefield) {
    triggerEffects(p, 'upkeep', state, active)
  }

  // Draw (skip first player's first turn)
  if (!(state.turn === 1 && active === 0)) {
    if (!drawCard(player)) {
      return active === 0 ? 'p1_wins' : 'p0_wins'
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

  generateMana(player)

  const castIndices = chooseCasts(player.hand, player.manaPool, player.battlefield, opponent.battlefield)
  const castCards: SimCard[] = []
  for (const idx of castIndices.sort((a, b) => b - a)) {
    const card = player.hand.splice(idx, 1)[0]
    castCards.push(card)
  }

  for (const card of castCards) {
    playCastCard(card, player, state, active)
  }

  stateBasedActions(state)
  if (opponent.life <= 0) return active === 0 ? 'p0_wins' : 'p1_wins'
  if (player.life <= 0) return active === 0 ? 'p1_wins' : 'p0_wins'

  // Combat
  const attackerIndices = chooseAttackers(player.battlefield, opponent.battlefield, opponent.life)

  if (attackerIndices.length > 0) {
    const attackerInfo = attackerIndices.map((i) => ({
      permanent: player.battlefield[i],
      index: i,
    }))
    const blockerMap = chooseBlockers(opponent.battlefield, attackerInfo)
    resolveCombat(attackerIndices, blockerMap, state)
    stateBasedActions(state)
  }

  if (opponent.life <= 0) return active === 0 ? 'p0_wins' : 'p1_wins'
  if (player.life <= 0) return active === 0 ? 'p1_wins' : 'p0_wins'

  // Main phase 2
  generateMana(player)
  const cast2Indices = chooseCasts(player.hand, player.manaPool, player.battlefield, opponent.battlefield)
  const cast2Cards: SimCard[] = []
  for (const idx of cast2Indices.sort((a, b) => b - a)) {
    cast2Cards.push(player.hand.splice(idx, 1)[0])
  }
  for (const card of cast2Cards) {
    playCastCard(card, player, state, active)
  }

  stateBasedActions(state)
  if (opponent.life <= 0) return active === 0 ? 'p0_wins' : 'p1_wins'
  if (player.life <= 0) return active === 0 ? 'p1_wins' : 'p0_wins'

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

  return 'continue'
}

export function runGame(deckA: SimCard[], deckB: SimCard[], rng: () => number): GameResult {
  const state: GameState = {
    players: [createPlayer(deckA, rng), createPlayer(deckB, rng)],
    turn: 0,
    activePlayer: 0,
    phase: 'untap',
  }

  const p0SpellsPlayed = [false, false, false] // turns 2, 3, 4
  const p1SpellsPlayed = [false, false, false]

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    state.turn = turn

    for (let active = 0; active < 2; active++) {
      state.activePlayer = active as 0 | 1
      const result = runTurn(state, rng)

      // Track curve hits
      if (turn >= 2 && turn <= 4) {
        const player = state.players[active as 0 | 1]
        const nonLandOnBoard = player.battlefield.filter((p) => p.card.cardType !== 'land').length
        if (active === 0 && nonLandOnBoard > 0) p0SpellsPlayed[turn - 2] = true
        if (active === 1 && nonLandOnBoard > 0) p1SpellsPlayed[turn - 2] = true
      }

      if (result === 'p0_wins') {
        return makeResult(0, turn, 'life', state, p0SpellsPlayed, p1SpellsPlayed)
      }
      if (result === 'p1_wins') {
        return makeResult(1, turn, 'life', state, p0SpellsPlayed, p1SpellsPlayed)
      }
    }

    // Check mill
    if (state.players[0].library.length === 0) {
      return makeResult(1, turn, 'mill', state, p0SpellsPlayed, p1SpellsPlayed)
    }
    if (state.players[1].library.length === 0) {
      return makeResult(0, turn, 'mill', state, p0SpellsPlayed, p1SpellsPlayed)
    }
  }

  return makeResult(-1, MAX_TURNS, 'draw', state, p0SpellsPlayed, p1SpellsPlayed)
}

function makeResult(
  winner: 0 | 1 | -1,
  turns: number,
  winCondition: 'life' | 'mill' | 'draw',
  state: GameState,
  p0Spells: boolean[],
  p1Spells: boolean[],
): GameResult {
  const p0Lands = state.players[0].battlefield.filter((p) => p.card.cardType === 'land').length
  const p1Lands = state.players[1].battlefield.filter((p) => p.card.cardType === 'land').length
  const p0NonLandHand = state.players[0].hand.filter((c) => c.cardType !== 'land').length
  const p1NonLandHand = state.players[1].hand.filter((c) => c.cardType !== 'land').length

  return {
    winner,
    turns,
    winCondition,
    p0ManaScrew: turns >= 4 && p0Lands < 3,
    p1ManaScrew: turns >= 4 && p1Lands < 3,
    p0ManaFlood: turns >= 8 && p0Lands > 6 && p0NonLandHand < 2,
    p1ManaFlood: turns >= 8 && p1Lands > 6 && p1NonLandHand < 2,
    p0CurveHit: p0Spells[0] && p0Spells[1] && p0Spells[2],
    p1CurveHit: p1Spells[0] && p1Spells[1] && p1Spells[2],
  }
}
