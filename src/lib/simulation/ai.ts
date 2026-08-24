import type {
  BlockAssignments,
  DeclaredAttacker,
  ManaColor,
  ManaSource,
  Permanent,
  SimCard,
} from './types'
import { missingColors, payCost } from './mana'
import {
  canBlock,
  forecastCombat,
  killedBeforeDealingDamage,
  killedBy,
  lethalDamage,
} from './combat'
import { isLethalTo } from './state-based-actions'

export function shouldMulligan(hand: SimCard[], mulliganCount: number): boolean {
  if (mulliganCount >= 2) return false
  const lands = hand.filter((c) => c.cardType === 'land').length
  const handSize = hand.length
  if (handSize === 7) return lands < 2 || lands > 5
  if (handSize === 6) return lands < 1 || lands > 5
  return false
}

export function chooseLand(hand: SimCard[], battlefield: Permanent[]): number {
  const landIndices: number[] = []
  for (let i = 0; i < hand.length; i++) {
    if (hand[i].cardType === 'land') landIndices.push(i)
  }
  if (landIndices.length === 0) return -1

  const availableColors = new Set<ManaColor>()
  for (const p of battlefield) {
    if (p.card.cardType === 'land') {
      for (const c of p.card.producesColors) availableColors.add(c)
    }
  }

  const neededColors = new Set<ManaColor>()
  for (const card of hand) {
    if (!card.cost) continue
    for (const color of missingColors(card.cost, availableColors)) neededColors.add(color)
  }

  if (neededColors.size > 0) {
    for (const idx of landIndices) {
      const land = hand[idx]
      for (const color of land.producesColors) {
        if (neededColors.has(color)) return idx
      }
    }
  }

  return landIndices[0]
}

function isRemoval(card: SimCard): boolean {
  return card.effects.some(
    (e) =>
      e.action.type === 'destroy' ||
      (e.action.type === 'damage' && e.action.target === 'any_creature') ||
      e.action.type === 'bounce',
  )
}

/**
 * Picks what to cast from `hand` and reports the lands that paid for it.
 *
 * The caller needs the lands as well as the indices: a dual land's color is
 * decided by what it ends up paying for, so which lands are left untapped isn't
 * recoverable from the list of cards alone.
 */
export function chooseCasts(
  hand: SimCard[],
  sources: readonly ManaSource[],
  opponentBoard: Permanent[],
): { indices: number[]; spent: Permanent[] } {
  const indices: number[] = []
  const spent: Permanent[] = []
  let remaining = [...sources]

  type Candidate = { idx: number; card: SimCard; priority: number }
  const candidates: Candidate[] = []

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i]
    if (card.cardType === 'land' || !card.cost) continue

    let priority = 0
    if (isRemoval(card) && opponentBoard.length > 0) {
      priority = 3
    } else if (card.cardType === 'creature') {
      priority = 2
    } else {
      priority = 1
    }
    candidates.push({ idx: i, card, priority })
  }

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return (b.card.cost?.cmc ?? 0) - (a.card.cost?.cmc ?? 0)
  })

  for (const { idx, card } of candidates) {
    const paid = payCost(remaining, card.cost!)
    if (paid === null) continue

    const used = new Set(paid)
    remaining = remaining.filter((s) => !used.has(s))
    for (const source of paid) spent.push(source.permanent)
    indices.push(idx)
  }

  return { indices, spent }
}

/**
 * What losing this creature costs, in mana. A token has no cost and is still
 * worth something, so every body is worth one more than its mana value.
 */
function creatureValue(permanent: Permanent): number {
  return (permanent.card.cost?.cmc ?? 0) + 1
}

function totalValue(permanents: readonly Permanent[]): number {
  return permanents.reduce((sum, p) => sum + creatureValue(p), 0)
}

/**
 * What this attack is worth: damage bought, minus the bodies it costs, plus the
 * bodies it kills. `Infinity` when it wins the game.
 *
 * A point of damage to the face is priced at one mana, the same scale the
 * bodies are on. That makes a one-for-one trade that deals nothing score zero,
 * and puts any attack whose damage gets through ahead - which is what makes
 * outnumbering the blockers worth doing.
 *
 * The defender's own `chooseBlockers` decides the blocks, so the attacker is
 * reasoning about what the defender will actually do rather than about a worst
 * case the defender has no reason to choose.
 */
function scoreAttack(
  indices: number[],
  battlefield: Permanent[],
  opponentBoard: Permanent[],
  opponentLife: number,
): number {
  if (indices.length === 0) return 0

  const declared = indices.map((index) => ({ permanent: battlefield[index], index }))
  const blocks = chooseBlockers(opponentBoard, declared, opponentLife)
  const forecast = forecastCombat(indices, blocks, battlefield, opponentBoard)

  if (opponentLife + forecast.defenderLifeChange <= 0) return Infinity

  const damage = Math.max(0, -forecast.defenderLifeChange)
  const lifeGained = Math.max(0, forecast.attackerLifeChange)
  return damage + lifeGained + totalValue(forecast.blockersLost) - totalValue(forecast.attackersLost)
}

/** Attackers in the order they are most likely to be worth sending: evasive, then biggest. */
function byAttackPriority(battlefield: Permanent[]): (a: number, b: number) => number {
  const evasion = (p: Permanent) =>
    (p.card.keywords.has('flying') ? 2 : 0) + (p.card.keywords.has('menace') ? 1 : 0)
  return (a, b) => {
    const evasionDiff = evasion(battlefield[b]) - evasion(battlefield[a])
    if (evasionDiff !== 0) return evasionDiff
    return battlefield[b].card.power - battlefield[a].card.power
  }
}

/**
 * Declares the attack, by asking what each attack would cost rather than by
 * asking whether each creature is safe.
 *
 * Judging attackers one at a time against every untapped blocker is what kept
 * the AI at home: it counts a blocker against every attacker at once, so five
 * creatures facing one blocker all stay back, and it reads an even trade as a
 * loss. Both together make a board stall permanent, and a stalled game is
 * decided by whoever draws the extra card - which is why a mirror match was
 * not a coin flip.
 *
 * So attackers are added one at a time, in the order they're most likely to
 * pay off, and each addition is kept if the forecast for the whole attack
 * doesn't get worse. An even trade is kept: the attacker chose it, and
 * declining every even trade forever is how the stall came back.
 */
export function chooseAttackers(
  battlefield: Permanent[],
  opponentBoard: Permanent[],
  opponentLife: number,
): number[] {
  const eligible: number[] = []
  for (let i = 0; i < battlefield.length; i++) {
    const p = battlefield[i]
    if (
      p.card.cardType === 'creature' &&
      !p.tapped &&
      !p.summoningSick &&
      p.card.power > 0 &&
      !p.card.keywords.has('defender')
    ) {
      eligible.push(i)
    }
  }

  if (eligible.length === 0) return []

  eligible.sort(byAttackPriority(battlefield))

  const attackers: number[] = []
  let best = 0
  for (const idx of eligible) {
    const candidate = [...attackers, idx]
    const score = scoreAttack(candidate, battlefield, opponentBoard, opponentLife)
    if (score === Infinity) return candidate
    if (score >= best) {
      attackers.push(idx)
      best = score
    }
  }

  return attackers
}

/**
 * Assigns blockers, first for value and then for survival.
 *
 * The value pass only commits a block it comes out ahead on, which on its own
 * makes the AI decline every chump block and die on board. `addSurvivalBlocks`
 * is the other half: it spends creatures purely to stay alive, over two rounds
 * with different horizons. See its own docs for what each round buys.
 */
export function chooseBlockers(
  myBoard: Permanent[],
  attackers: DeclaredAttacker[],
  myLife: number,
): BlockAssignments {
  const assignments = new Map<number, number[]>()
  if (attackers.length === 0) return assignments

  // Creatures only. Artifacts, enchantments, and planeswalkers survive their own
  // resolution now, and one left in this pool would be an unkillable wall - it
  // has no toughness for damage to exceed.
  const available: number[] = []
  for (let i = 0; i < myBoard.length; i++) {
    const p = myBoard[i]
    if (p.card.cardType === 'creature' && !p.tapped) {
      available.push(i)
    }
  }

  const used = new Set<number>()

  const sorted = [...attackers].sort((a, b) => b.permanent.card.power - a.permanent.card.power)

  for (const atk of sorted) {
    if (atk.permanent.card.keywords.has('menace')) {
      const validBlockers: number[] = []
      for (const bIdx of available) {
        if (used.has(bIdx)) continue
        if (canBlock(myBoard[bIdx], atk.permanent)) {
          validBlockers.push(bIdx)
        }
      }
      if (validBlockers.length >= 2) {
        const pair: number[] = []
        for (const bIdx of validBlockers) {
          if (pair.length >= 2) break
          const blocker = myBoard[bIdx]
          if (blocker.card.toughness > atk.permanent.card.power || blocker.card.keywords.has('deathtouch')) {
            pair.push(bIdx)
          }
        }
        if (pair.length < 2) {
          for (const bIdx of validBlockers) {
            if (pair.length >= 2) break
            if (!pair.includes(bIdx)) pair.push(bIdx)
          }
        }
        if (pair.length >= 2 && scoreBlock(atk.permanent, pair.map((i) => myBoard[i])) > 0) {
          assignments.set(atk.index, pair)
          for (const p of pair) used.add(p)
        }
      }
      continue
    }

    let bestBlocker = -1
    let bestScore = -Infinity

    for (const bIdx of available) {
      if (used.has(bIdx)) continue
      const blocker = myBoard[bIdx]
      if (!canBlock(blocker, atk.permanent)) continue

      const score = scoreBlock(atk.permanent, [blocker])

      if (score > bestScore) {
        bestScore = score
        bestBlocker = bIdx
      }
    }

    if (bestBlocker >= 0 && bestScore > 0) {
      assignments.set(atk.index, [bestBlocker])
      used.add(bestBlocker)
    }
  }

  addSurvivalBlocks({ myBoard, available, attackers, myLife, assignments, used })

  return assignments
}

/**
 * What `attacker` kills of `blockers`, in mana.
 *
 * It assigns lethal damage down the line and stops when it runs out, so a block
 * by committee only loses the front of it.
 *
 * Lethality is `isLethalTo`'s answer, the same one `damageStep` marks and
 * `isDestroyedBySba` reads, so the AI can't price a block the engine then
 * resolves differently.
 */
function blockersLostTo(attacker: Permanent, blockers: readonly Permanent[]): number {
  if (killedBeforeDealingDamage(attacker, blockers)) return 0
  const deathtouch = attacker.card.keywords.has('deathtouch')
  let remaining = attacker.card.power
  let lost = 0
  for (const blocker of blockers) {
    const dealt = Math.min(remaining, lethalDamage(attacker, blocker))
    remaining -= dealt
    if (isLethalTo(blocker, dealt, deathtouch)) lost += creatureValue(blocker)
  }
  return lost
}

/**
 * What a block is worth, in the mana `scoreAttack` prices attacks in.
 *
 * Damage prevented counts only when the block costs nothing - when every
 * blocker lives. Buying life with a creature is what `addSurvivalBlocks` is for,
 * and counting it here is what made the defender accept every even trade on
 * offer: a 2/2 stopping a 2/2 scored a clear win, so no attack into an equal
 * board ever dealt damage. With tempo worth nothing, a mirror match came down
 * to the extra card the player on the draw sees, and the player on the play
 * lost it.
 */
function scoreBlock(attacker: Permanent, blockers: readonly Permanent[]): number {
  const lost = blockersLostTo(attacker, blockers)
  const prevented =
    lost > 0 ? 0 : attacker.card.power - damageThrough(attacker, blockers)

  return (killedBy(attacker, blockers) ? creatureValue(attacker) : 0) - lost + prevented
}

/**
 * Damage this attacker sends at the defender's face past the given blockers.
 *
 * Borrows `combat.ts`'s own rules rather than restating them, so a deathtouch
 * trampler is estimated the way it actually resolves: it only has to assign 1
 * to each blocker, and the rest tramples over.
 *
 * Life gained by a lifelink blocker isn't counted, so the estimate is
 * pessimistic by that much.
 */
function damageThrough(attacker: Permanent, blockers: readonly Permanent[]): number {
  if (blockers.length === 0) return attacker.card.power
  if (killedBeforeDealingDamage(attacker, blockers)) return 0
  if (!attacker.card.keywords.has('trample')) return 0
  const absorbed = blockers.reduce((sum, b) => sum + lethalDamage(attacker, b), 0)
  return Math.max(0, attacker.card.power - absorbed)
}

/**
 * How many swings of cushion the defender keeps before it converts from racing
 * to blocking - the standard "am I within two turns of dying" line.
 *
 * One swing is the bare "am I dead next turn" question, and a defender that
 * only asks that races until the exact turn the attack becomes lethal and then
 * finds it lost the race several turns earlier. Raising it past two mostly
 * lengthens games; the mirror's seat advantage keeps moving either way, which
 * is why this number is not the thing that balances a mirror. Alternating who
 * is on the play is - see `runSimulation`.
 */
const RACE_HORIZON = 2

/**
 * Adds blocks on top of `assignments`, in place, when the attack as it stands
 * kills the defender - this turn, or on the swings back.
 *
 * The value pass only makes blocks it comes out ahead on, so nothing above this
 * ever spends a creature purely to stay alive. This is the other half of the
 * decision, and it runs in two rounds, because the two kinds of block aren't
 * worth the same thing:
 *
 * - A block that kills its attacker takes that power off the board for good,
 *   so it's worth making as soon as the race is lost - `RACE_HORIZON` swings
 *   ahead.
 * - A block that only absorbs damage buys exactly one turn, so it's worth a
 *   creature only when that turn is the difference between living and dying.
 *
 * Either round is discarded whole if it bought neither. A creature in front of
 * an attack that kills anyway is a creature thrown away.
 */
function addSurvivalBlocks(decision: BlockDecision): void {
  addBlocks(decision, { killersOnly: true, horizon: RACE_HORIZON })
  addBlocks(decision, { killersOnly: false, horizon: 1 })
}

/**
 * The block declaration as it stands, shared by every pass that adds to it.
 *
 * `assignments` and `used` are what the passes write to; the rest is the
 * position they're reading.
 */
interface BlockDecision {
  myBoard: Permanent[]
  /** Indices into `myBoard` of the creatures that could block at all. */
  available: number[]
  attackers: DeclaredAttacker[]
  myLife: number
  assignments: BlockAssignments
  used: Set<number>
}

function addBlocks(
  decision: BlockDecision,
  { killersOnly, horizon }: { killersOnly: boolean; horizon: number },
): void {
  const { myBoard, available, attackers, myLife, assignments, used } = decision
  const blocked = new Map(assignments)

  /** Damage this turn, and the power still standing to swing again after it. */
  function outcome(): { incoming: number; threat: number } {
    let incoming = 0
    let threat = 0
    for (const atk of attackers) {
      const blockers = (blocked.get(atk.index) ?? []).map((i) => myBoard[i])
      incoming += damageThrough(atk.permanent, blockers)
      if (!killedBy(atk.permanent, blockers)) threat += atk.permanent.card.power
    }
    return { incoming, threat }
  }

  const survives = ({ incoming }: { incoming: number }) => incoming < myLife
  const outOfRange = ({ incoming, threat }: { incoming: number; threat: number }) =>
    myLife - incoming >= threat * horizon
  const settled = (state: { incoming: number; threat: number }) =>
    survives(state) && outOfRange(state)

  const before = outcome()
  if (settled(before)) return

  // Cheapest first, and among equals the smallest body - the creature the
  // defender gives up least by losing.
  const free = available
    .filter((i) => !used.has(i))
    .sort((a, b) => {
      const costDiff = (myBoard[a].card.cost?.cmc ?? 0) - (myBoard[b].card.cost?.cmc ?? 0)
      if (costDiff !== 0) return costDiff
      const bodyA = myBoard[a].card.power + myBoard[a].card.toughness
      const bodyB = myBoard[b].card.power + myBoard[b].card.toughness
      return bodyA - bodyB
    })

  // Biggest attacker first: each block is worth the damage it turns off.
  const unblocked = attackers
    .filter((atk) => !blocked.has(atk.index))
    .sort((a, b) => b.permanent.card.power - a.permanent.card.power)

  for (const atk of unblocked) {
    if (settled(outcome())) break

    const needed = atk.permanent.card.keywords.has('menace') ? 2 : 1
    const candidates = free.filter((bIdx) => canBlock(myBoard[bIdx], atk.permanent))
    const pick = killersOnly
      ? cheapestKillingGroup(candidates, myBoard, atk.permanent, needed)
      : candidates.slice(0, needed)
    if (pick.length < needed) continue

    for (const bIdx of pick) free.splice(free.indexOf(bIdx), 1)
    blocked.set(atk.index, pick)
  }

  const after = outcome()
  const boughtLife = survives(after) && !survives(before)
  if (!boughtLife && !settled(after)) return

  for (const [atkIndex, blockers] of blocked) {
    assignments.set(atkIndex, blockers)
    for (const bIdx of blockers) used.add(bIdx)
  }
}

/**
 * The cheapest `size` of `candidates` that between them kill `attacker`, or an
 * empty list when no such group exists. `candidates` must already be cheapest
 * first.
 *
 * Taking the cheapest bodies and then checking whether they kill is not the
 * same thing: the cheapest body is the least likely to kill anything, so that
 * order skips attackers a slightly bigger creature would have taken down.
 *
 * `size` is 1, or 2 for a menace attacker, so the pair scan stays cheap.
 */
function cheapestKillingGroup(
  candidates: readonly number[],
  myBoard: Permanent[],
  attacker: Permanent,
  size: number,
): number[] {
  if (size === 1) {
    const found = candidates.find((i) => killedBy(attacker, [myBoard[i]]))
    return found === undefined ? [] : [found]
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const pair = [candidates[i], candidates[j]]
      if (killedBy(attacker, pair.map((k) => myBoard[k]))) return pair
    }
  }
  return []
}
