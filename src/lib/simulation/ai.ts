import type {
  DeclaredAttacker,
  ManaColor,
  ManaSource,
  Permanent,
  SimCard,
} from './types'
import { MANA_COLORS, payCost } from './mana'
import { canBlock, killedBeforeDealingDamage, lethalDamage } from './combat'

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
    if (card.cost) {
      for (const color of MANA_COLORS) {
        if ((card.cost.colored[color] ?? 0) > 0 && !availableColors.has(color)) {
          neededColors.add(color)
        }
      }
    }
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

  const totalDamage = eligible.reduce((s, i) => s + battlefield[i].card.power, 0)
  if (totalDamage >= opponentLife) return eligible

  const attackers: number[] = []
  const availableBlockers = opponentBoard.filter(
    (p) => p.card.cardType === 'creature' && !p.tapped,
  )

  for (const idx of eligible) {
    const atk = battlefield[idx]

    if (atk.card.keywords.has('flying')) {
      const flyingBlockers = availableBlockers.filter(
        (b) => b.card.keywords.has('flying') || b.card.keywords.has('reach'),
      )
      if (flyingBlockers.length === 0) {
        attackers.push(idx)
        continue
      }
    }

    if (atk.card.keywords.has('menace')) {
      if (availableBlockers.length < 2) {
        attackers.push(idx)
        continue
      }
    }

    const blockersThatKill = availableBlockers.filter((b) => {
      if (!canBlock(b, atk)) return false
      const bDmg = b.card.keywords.has('deathtouch') ? 999 : b.card.power
      return bDmg >= atk.card.toughness
    })

    if (blockersThatKill.length === 0) {
      attackers.push(idx)
    }
  }

  return attackers
}

/**
 * Assigns blockers, first for value and then for survival.
 *
 * The value pass only commits a block it comes out ahead on, which on its own
 * makes the AI decline every chump block and die on board. So a second pass
 * runs whenever the damage still coming through is lethal: it throws the
 * cheapest creatures in front of the biggest attackers until the defender
 * lives. If even every creature it has can't get the damage below `myLife`,
 * the second pass is discarded - blocks that don't change the result are just
 * creatures thrown away.
 */
export function chooseBlockers(
  myBoard: Permanent[],
  attackers: DeclaredAttacker[],
  myLife: number,
): Map<number, number[]> {
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
        if (pair.length >= 2) {
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

      const survives = atk.permanent.card.keywords.has('deathtouch')
        ? false
        : blocker.card.toughness > atk.permanent.card.power
      const kills =
        blocker.card.keywords.has('deathtouch') ||
        blocker.card.power >= atk.permanent.card.toughness

      let score = 0
      if (survives && kills) score = 10
      else if (kills) {
        const valueDiff = (atk.permanent.card.cost?.cmc ?? 0) - (blocker.card.cost?.cmc ?? 0)
        score = valueDiff >= 0 ? 5 + valueDiff : -1
      } else if (survives) {
        score = 3
      } else {
        score = -5
      }

      if (score > bestScore) {
        bestScore = score
        bestBlocker = bIdx
      }
    }

    if (bestBlocker >= 0 && bestScore >= 0) {
      assignments.set(atk.index, [bestBlocker])
      used.add(bestBlocker)
    }
  }

  addChumpBlocks(myBoard, available, attackers, myLife, assignments, used)

  return assignments
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
function damageThrough(attacker: Permanent, blockers: Permanent[]): number {
  if (blockers.length === 0) return attacker.card.power
  if (killedBeforeDealingDamage(attacker, blockers)) return 0
  if (!attacker.card.keywords.has('trample')) return 0
  const absorbed = blockers.reduce((sum, b) => sum + lethalDamage(attacker, b), 0)
  return Math.max(0, attacker.card.power - absorbed)
}

/**
 * Adds survival blocks on top of `assignments`, in place, when the attack as
 * assigned is lethal. Mutates nothing when the chumps can't save the defender.
 */
function addChumpBlocks(
  myBoard: Permanent[],
  available: number[],
  attackers: DeclaredAttacker[],
  myLife: number,
  assignments: Map<number, number[]>,
  used: ReadonlySet<number>,
): void {
  let incoming = 0
  for (const atk of attackers) {
    const blockers = (assignments.get(atk.index) ?? []).map((i) => myBoard[i])
    incoming += damageThrough(atk.permanent, blockers)
  }
  if (incoming < myLife) return

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

  // Biggest attacker first: each chump is worth the damage it turns off.
  const unblocked = attackers
    .filter((atk) => !assignments.has(atk.index))
    .sort((a, b) => b.permanent.card.power - a.permanent.card.power)

  const chumps = new Map<number, number[]>()
  for (const atk of unblocked) {
    if (incoming < myLife) break
    const needed = atk.permanent.card.keywords.has('menace') ? 2 : 1
    const pick: number[] = []
    for (const bIdx of free) {
      if (pick.length >= needed) break
      if (canBlock(myBoard[bIdx], atk.permanent)) pick.push(bIdx)
    }
    if (pick.length < needed) continue

    for (const bIdx of pick) free.splice(free.indexOf(bIdx), 1)
    chumps.set(atk.index, pick)
    incoming -= atk.permanent.card.power - damageThrough(atk.permanent, pick.map((i) => myBoard[i]))
  }

  if (incoming >= myLife) return

  for (const [atkIndex, blockers] of chumps) {
    assignments.set(atkIndex, blockers)
  }
}
