/**
 * Prototype: MTG simulation worker benchmark
 *
 * Proves:
 * 1. Web Worker instantiation works with Vite + TanStack Start SSR
 * 2. Typed postMessage round-trips work
 * 3. 5000 simplified game simulations complete in acceptable time (<10s)
 *
 * The "game" here is simplified: two players draw 7, play lands, cast
 * creatures by CMC curve, attack each turn, block when favorable.
 * No oracle text parsing, no effects — just mana + creatures + combat.
 */

// ── Types ──────────────────────────────────────────────────────────────

type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G'

interface SimCard {
  name: string
  isLand: boolean
  cmc: number
  power: number
  toughness: number
  producesColor: ManaColor | null
  hasHaste: boolean
  hasFlying: boolean
  hasDeathtouch: boolean
  hasFirstStrike: boolean
  hasTrample: boolean
  hasLifelink: boolean
}

interface Permanent {
  card: SimCard
  tapped: boolean
  summoningSick: boolean
  damage: number
}

interface PlayerState {
  life: number
  library: SimCard[]
  hand: SimCard[]
  battlefield: Permanent[]
  graveyard: SimCard[]
  landDropped: boolean
}

interface GameResult {
  winner: 0 | 1 | -1 // -1 = draw (turn limit)
  turns: number
}

type WorkerIncoming =
  | { type: 'start'; deckA: SimCard[]; deckB: SimCard[]; games: number; seed: number }
  | { type: 'cancel' }

type WorkerOutgoing =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; wins: [number, number]; draws: number; avgTurns: number; elapsed: number }
  | { type: 'error'; message: string }

// ── PRNG (xorshift128) ────────────────────────────────────────────────

function xorshift128(seed: number) {
  let s0 = seed | 0 || 1
  let s1 = (seed * 1664525 + 1013904223) | 0 || 1
  let s2 = (seed * 214013 + 2531011) | 0 || 1
  let s3 = (seed * 48271) | 0 || 1
  return (): number => {
    const t = s3
    let s = s0
    s3 = s2
    s2 = s1
    s1 = s = s0
    let u = t ^ (t << 11)
    u = u ^ (u >>> 8)
    s0 = u ^ s ^ (s >>> 19)
    return (s0 >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Game Engine ────────────────────────────────────────────────────────

function createPlayer(deck: SimCard[], rng: () => number): PlayerState {
  const library = shuffle(deck, rng)
  const hand = library.splice(0, 7)
  return { life: 20, library, hand, battlefield: [], graveyard: [], landDropped: false }
}

function drawCard(player: PlayerState): boolean {
  if (player.library.length === 0) return false
  player.hand.push(player.library.pop()!)
  return true
}

function untapAll(player: PlayerState) {
  for (const p of player.battlefield) {
    p.tapped = false
    p.summoningSick = false
  }
}

function availableMana(player: PlayerState): number {
  return player.battlefield.filter((p) => p.card.isLand && !p.tapped).length
}

function tapLands(player: PlayerState, amount: number) {
  let remaining = amount
  for (const p of player.battlefield) {
    if (remaining <= 0) break
    if (p.card.isLand && !p.tapped) {
      p.tapped = true
      remaining--
    }
  }
}

function playLand(player: PlayerState) {
  if (player.landDropped) return
  const landIdx = player.hand.findIndex((c) => c.isLand)
  if (landIdx === -1) return
  const land = player.hand.splice(landIdx, 1)[0]
  player.battlefield.push({ card: land, tapped: false, summoningSick: false, damage: 0 })
  player.landDropped = true
}

function castCreatures(player: PlayerState) {
  // Sort hand by CMC descending, cast as many as mana allows
  const creatures = player.hand
    .map((c, i) => ({ card: c, idx: i }))
    .filter((x) => !x.card.isLand && x.card.power >= 0)
    .sort((a, b) => b.card.cmc - a.card.cmc)

  let mana = availableMana(player)
  const toRemove: number[] = []

  for (const { card, idx } of creatures) {
    if (card.cmc <= mana && card.cmc > 0) {
      tapLands(player, card.cmc)
      mana -= card.cmc
      player.battlefield.push({
        card,
        tapped: false,
        summoningSick: !card.hasHaste,
        damage: 0,
      })
      toRemove.push(idx)
    }
  }

  // Remove from hand in reverse order to preserve indices
  for (const idx of toRemove.sort((a, b) => b - a)) {
    player.hand.splice(idx, 1)
  }
}

function getAttackers(player: PlayerState): Permanent[] {
  return player.battlefield.filter(
    (p) => !p.card.isLand && !p.summoningSick && !p.tapped && p.card.power > 0,
  )
}

function getBlockers(player: PlayerState): Permanent[] {
  return player.battlefield.filter((p) => !p.card.isLand && !p.tapped)
}

function resolveCombat(
  attackers: Permanent[],
  defender: PlayerState,
  _rng: () => number,
) {
  if (attackers.length === 0) return

  const blockers = getBlockers(defender)
  let blockerIdx = 0

  for (const atk of attackers) {
    atk.tapped = true

    // Simple blocking heuristic: assign one blocker per attacker if available
    // Block flyers only with flyers, block ground with ground
    let assigned: Permanent | null = null
    for (let i = blockerIdx; i < blockers.length; i++) {
      const blk = blockers[i]
      if (atk.card.hasFlying && !blk.card.hasFlying) continue
      // Block if we can trade or survive
      if (blk.card.toughness > atk.card.power || blk.card.hasDeathtouch) {
        assigned = blk
        blockerIdx = i + 1
        break
      }
    }

    if (assigned) {
      // First strike: attacker with first strike deals damage first
      if (atk.card.hasFirstStrike && !assigned.card.hasFirstStrike) {
        assigned.damage += atk.card.power
        if (assigned.damage >= assigned.card.toughness) {
          // Blocker dies before dealing damage
          defender.battlefield = defender.battlefield.filter((p) => p !== assigned)
          defender.graveyard.push(assigned!.card)
          // Trample: excess goes to player
          if (atk.card.hasTrample) {
            const excess = assigned!.damage - assigned!.card.toughness
            defender.life -= excess
          }
          if (atk.card.hasLifelink) {
            // Lifelink heals attacker's controller (not modeled here, simplified)
          }
          continue
        }
      }

      // Normal damage exchange
      atk.damage += assigned.card.hasDeathtouch ? 999 : assigned.card.power
      assigned.damage += atk.card.power

      // Trample overflow
      if (atk.card.hasTrample && assigned.damage >= assigned.card.toughness) {
        const excess = atk.card.power - assigned.card.toughness
        if (excess > 0) defender.life -= excess
      }

      // Lifelink
      if (atk.card.hasLifelink) {
        // Simplified: heal equal to power (not damage dealt, but close enough for benchmark)
      }

      // Remove dead creatures
      if (assigned.damage >= assigned.card.toughness) {
        defender.battlefield = defender.battlefield.filter((p) => p !== assigned)
        defender.graveyard.push(assigned.card)
      }
      if (atk.damage >= atk.card.toughness) {
        // Attacker dies — handled after loop
      }
    } else {
      // Unblocked: damage to player
      defender.life -= atk.card.power
      if (atk.card.hasLifelink) {
        // Would heal controller
      }
    }
  }

  // Remove dead attackers (from their controller's battlefield, but in this
  // simplified model the attacker array references the same objects)
  // We don't have a reference to the attacking player here, so dead attackers
  // stay on the field with damage. State-based actions clean up below.
}

function stateBasedActions(player: PlayerState) {
  const dead: Permanent[] = []
  player.battlefield = player.battlefield.filter((p) => {
    if (!p.card.isLand && p.damage >= p.card.toughness) {
      dead.push(p)
      return false
    }
    return true
  })
  for (const d of dead) {
    player.graveyard.push(d.card)
  }
  // Reset damage on survivors
  for (const p of player.battlefield) {
    p.damage = 0
  }
}

function runGame(deckA: SimCard[], deckB: SimCard[], rng: () => number): GameResult {
  const players: [PlayerState, PlayerState] = [createPlayer(deckA, rng), createPlayer(deckB, rng)]
  const maxTurns = 50

  for (let turn = 1; turn <= maxTurns; turn++) {
    for (let active = 0; active < 2; active++) {
      const player = players[active]
      const opponent = players[1 - active]

      // Untap
      untapAll(player)
      player.landDropped = false

      // Draw (skip turn 1 for first player)
      if (!(turn === 1 && active === 0)) {
        if (!drawCard(player)) {
          return { winner: (1 - active) as 0 | 1, turns: turn }
        }
      }

      // Main phase 1: play land, cast creatures
      playLand(player)
      castCreatures(player)

      // Combat: attack with everything eligible
      const attackers = getAttackers(player)
      resolveCombat(attackers, opponent, rng)

      // State-based actions
      stateBasedActions(players[0])
      stateBasedActions(players[1])

      // Check life
      if (opponent.life <= 0) return { winner: active as 0 | 1, turns: turn }
      if (player.life <= 0) return { winner: (1 - active) as 0 | 1, turns: turn }
    }
  }

  return { winner: -1, turns: maxTurns }
}

// ── Monte Carlo Runner ─────────────────────────────────────────────────

function runSimulation(
  deckA: SimCard[],
  deckB: SimCard[],
  games: number,
  seed: number,
  onProgress: (completed: number) => void,
): { wins: [number, number]; draws: number; avgTurns: number } {
  const rng = xorshift128(seed)
  const wins: [number, number] = [0, 0]
  let draws = 0
  let totalTurns = 0
  const batchSize = 100

  for (let i = 0; i < games; i++) {
    const result = runGame(deckA, deckB, rng)
    if (result.winner === -1) draws++
    else wins[result.winner]++
    totalTurns += result.turns

    if ((i + 1) % batchSize === 0) {
      onProgress(i + 1)
    }
  }

  onProgress(games)
  return { wins, draws, avgTurns: totalTurns / games }
}

// ── Worker Entry ───────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerIncoming>) => {
  const msg = e.data
  if (msg.type === 'start') {
    try {
      const start = performance.now()
      const result = runSimulation(msg.deckA, msg.deckB, msg.games, msg.seed, (completed) => {
        self.postMessage({
          type: 'progress',
          completed,
          total: msg.games,
        } satisfies WorkerOutgoing)
      })
      const elapsed = performance.now() - start
      self.postMessage({
        type: 'result',
        ...result,
        elapsed,
      } satisfies WorkerOutgoing)
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutgoing)
    }
  }
}
