import type { ManaColor, ManaPool, Permanent, SimCard } from './types'
import { canPay, payMana, emptyPool, MANA_COLORS } from './mana'
import { canBlock } from './combat'

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

export function chooseCasts(
  hand: SimCard[],
  pool: ManaPool,
  battlefield: Permanent[],
  opponentBoard: Permanent[],
): number[] {
  const indices: number[] = []
  const testPool: ManaPool = {
    colors: { ...pool.colors },
    colorless: pool.colorless,
  }

  type Candidate = { idx: number; card: SimCard; priority: number }
  const candidates: Candidate[] = []

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i]
    if (card.cardType === 'land' || !card.cost) continue
    if (!canPay(pool, card.cost)) continue

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
    if (canPay(testPool, card.cost!)) {
      payMana(testPool, card.cost!)
      indices.push(idx)
    }
  }

  return indices
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
      p.card.cardType !== 'land' &&
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
    (p) => p.card.cardType !== 'land' && !p.tapped,
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

export function chooseBlockers(
  myBoard: Permanent[],
  attackers: { permanent: Permanent; index: number }[],
): Map<number, number[]> {
  const assignments = new Map<number, number[]>()
  if (attackers.length === 0) return assignments

  const available: number[] = []
  for (let i = 0; i < myBoard.length; i++) {
    const p = myBoard[i]
    if (p.card.cardType !== 'land' && !p.tapped) {
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

  return assignments
}
