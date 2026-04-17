import type { GameState, Permanent } from './types'

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (attacker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('reach')) {
    return false
  }
  return true
}

function lethalDamage(attacker: Permanent, blocker: Permanent): number {
  if (attacker.card.keywords.has('deathtouch')) return 1
  return Math.max(0, blocker.card.toughness - blocker.damage)
}

export function resolveCombat(
  attackerIndices: number[],
  blockerAssignments: Map<number, number[]>,
  state: GameState,
): void {
  const active = state.activePlayer
  const defending = (1 - active) as 0 | 1
  const attackerBoard = state.players[active].battlefield
  const defenderBoard = state.players[defending].battlefield

  for (const atkIdx of attackerIndices) {
    const atk = attackerBoard[atkIdx]
    if (!atk) continue
    if (!atk.card.keywords.has('vigilance')) {
      atk.tapped = true
    }
  }

  // First strike damage step
  for (const atkIdx of attackerIndices) {
    const atk = attackerBoard[atkIdx]
    if (!atk) continue
    const hasFirstStrike = atk.card.keywords.has('first_strike') || atk.card.keywords.has('double_strike')
    if (!hasFirstStrike) continue

    const blockerIdxs = blockerAssignments.get(atkIdx)
    if (!blockerIdxs || blockerIdxs.length === 0) {
      state.players[defending].life -= atk.card.power
      if (atk.card.keywords.has('lifelink')) {
        state.players[active].life += atk.card.power
      }
    } else {
      let remainingDamage = atk.card.power
      for (const blkIdx of blockerIdxs) {
        const blk = defenderBoard[blkIdx]
        if (!blk || blk.markedForDeath) continue
        const needed = lethalDamage(atk, blk)
        const dealt = Math.min(remainingDamage, needed)
        blk.damage += dealt
        remainingDamage -= dealt
      }
      if (atk.card.keywords.has('trample') && remainingDamage > 0) {
        state.players[defending].life -= remainingDamage
      }
      if (atk.card.keywords.has('lifelink')) {
        state.players[active].life += atk.card.power
      }

      // Blockers with first strike / double strike hit back
      for (const blkIdx of blockerIdxs) {
        const blk = defenderBoard[blkIdx]
        if (!blk) continue
        const blkHasFS = blk.card.keywords.has('first_strike') || blk.card.keywords.has('double_strike')
        const blkDead = blk.markedForDeath || blk.damage >= blk.card.toughness || (atk.card.keywords.has('deathtouch') && blk.damage > 0)
        if (blkHasFS && !blkDead) {
          const dmg = blk.card.keywords.has('deathtouch') ? 999 : blk.card.power
          atk.damage += dmg
          if (blk.card.keywords.has('lifelink')) {
            state.players[defending].life += blk.card.power
          }
        }
      }
    }
  }

  // State-based actions after first strike
  for (const board of [attackerBoard, defenderBoard]) {
    for (const p of board) {
      if (p.card.cardType !== 'land' && p.damage >= p.card.toughness && !p.card.keywords.has('indestructible')) {
        p.markedForDeath = true
      }
    }
  }

  // Normal damage step
  for (const atkIdx of attackerIndices) {
    const atk = attackerBoard[atkIdx]
    if (!atk || atk.markedForDeath) continue
    const hasOnlyFirstStrike = atk.card.keywords.has('first_strike') && !atk.card.keywords.has('double_strike')
    if (hasOnlyFirstStrike) continue

    const blockerIdxs = blockerAssignments.get(atkIdx)
    if (!blockerIdxs || blockerIdxs.length === 0) {
      // Only deal unblocked damage if attacker didn't already deal first-strike damage to player
      const hasFS = atk.card.keywords.has('first_strike') || atk.card.keywords.has('double_strike')
      if (!hasFS) {
        state.players[defending].life -= atk.card.power
        if (atk.card.keywords.has('lifelink')) {
          state.players[active].life += atk.card.power
        }
      }
    } else {
      let remainingDamage = atk.card.power
      for (const blkIdx of blockerIdxs) {
        const blk = defenderBoard[blkIdx]
        if (!blk || blk.markedForDeath) continue
        const needed = lethalDamage(atk, blk)
        const dealt = Math.min(remainingDamage, needed)
        blk.damage += dealt
        remainingDamage -= dealt
      }
      if (atk.card.keywords.has('trample') && remainingDamage > 0) {
        state.players[defending].life -= remainingDamage
      }
      if (atk.card.keywords.has('lifelink')) {
        state.players[active].life += atk.card.power
      }

      // Blockers without first strike hit back now
      for (const blkIdx of blockerIdxs) {
        const blk = defenderBoard[blkIdx]
        if (!blk || blk.markedForDeath) continue
        const blkHasFS = blk.card.keywords.has('first_strike') || blk.card.keywords.has('double_strike')
        if (!blkHasFS) {
          const dmg = blk.card.keywords.has('deathtouch') ? 999 : blk.card.power
          atk.damage += dmg
          if (blk.card.keywords.has('lifelink')) {
            state.players[defending].life += blk.card.power
          }
        }
      }
    }
  }
}
