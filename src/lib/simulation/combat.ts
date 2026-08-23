import type { GameState, Permanent } from './types'
import { isDestroyedBySba } from './state-based-actions'

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (attacker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('reach')) {
    return false
  }
  return true
}

/** Damage `attacker` must assign to `blocker` before the rest can trample over. */
export function lethalDamage(attacker: Permanent, blocker: Permanent): number {
  if (attacker.card.keywords.has('deathtouch')) return 1
  return Math.max(0, blocker.card.toughness - blocker.damage)
}

/** The two battlefields plus their player indices, from the attacker's side. */
function combatBoards(state: GameState) {
  const active = state.activePlayer
  const defending = (1 - active) as 0 | 1
  return {
    active,
    defending,
    attackerBoard: state.players[active].battlefield,
    defenderBoard: state.players[defending].battlefield,
  }
}

/**
 * Which creatures deal damage in a combat damage step.
 *
 * Participation is per-creature, not per-attacker: a first-striking *blocker*
 * swings in the first-strike step even when the attacker it blocks has no
 * first strike, and a vanilla blocker swings in the normal step even when the
 * attacker it blocks already swung and is done. Deciding this per-attacker is
 * what made first strike a near-invincibility keyword.
 */
function fightsInFirstStrikeStep(p: Permanent): boolean {
  return p.card.keywords.has('first_strike') || p.card.keywords.has('double_strike')
}

function fightsInNormalStep(p: Permanent): boolean {
  return !p.card.keywords.has('first_strike') || p.card.keywords.has('double_strike')
}

/**
 * Whether `blockers` kill `attacker` in the first-strike step, before it deals
 * any damage of its own.
 *
 * `damageStep` skips a `markedForDeath` attacker, so this is the one way a
 * block turns off *all* of an attacker's damage - trample included. The AI
 * needs it to value a first-striking blocker correctly.
 */
export function killedBeforeDealingDamage(
  attacker: Permanent,
  blockers: Permanent[],
): boolean {
  if (fightsInFirstStrikeStep(attacker)) return false
  let damage = attacker.damage
  for (const blocker of blockers) {
    if (!fightsInFirstStrikeStep(blocker)) continue
    damage += blocker.card.keywords.has('deathtouch') ? 999 : blocker.card.power
  }
  return damage >= attacker.card.toughness
}

/**
 * One combat damage step. Damage inside a step is simultaneous: a creature that
 * takes lethal damage here still deals its own, and only the sweep between the
 * two steps takes the dead off the battlefield.
 */
function damageStep(
  dealsDamageThisStep: (p: Permanent) => boolean,
  attackerIndices: number[],
  blockerAssignments: Map<number, number[]>,
  state: GameState,
): void {
  const { active, defending, attackerBoard, defenderBoard } = combatBoards(state)

  for (const atkIdx of attackerIndices) {
    const atk = attackerBoard[atkIdx]
    if (!atk || atk.markedForDeath) continue
    const blockerIdxs = blockerAssignments.get(atkIdx) ?? []

    if (dealsDamageThisStep(atk)) {
      if (blockerIdxs.length === 0) {
        state.players[defending].life -= atk.card.power
      } else {
        let remainingDamage = atk.card.power
        for (const blkIdx of blockerIdxs) {
          const blk = defenderBoard[blkIdx]
          if (!blk || blk.markedForDeath) continue
          const dealt = Math.min(remainingDamage, lethalDamage(atk, blk))
          blk.damage += dealt
          remainingDamage -= dealt
        }
        if (atk.card.keywords.has('trample') && remainingDamage > 0) {
          state.players[defending].life -= remainingDamage
        }
      }
      if (atk.card.keywords.has('lifelink')) {
        state.players[active].life += atk.card.power
      }
    }

    // Blockers swing on their own schedule, whether or not the creature they
    // block fights in this step. A dead attacker is out of combat, so its
    // blockers have nothing left to hit - hence the `markedForDeath` skip above.
    //
    // Deathtouch is asymmetric here: a blocker forces a kill with 999 damage,
    // but an attacker only assigns `lethalDamage`'s 1, and `isDestroyedBySba`
    // doesn't model deathtouch - so a deathtouch attacker kills nothing. That
    // hole predates this step split and is tracked separately.
    for (const blkIdx of blockerIdxs) {
      const blk = defenderBoard[blkIdx]
      if (!blk || blk.markedForDeath || !dealsDamageThisStep(blk)) continue
      atk.damage += blk.card.keywords.has('deathtouch') ? 999 : blk.card.power
      if (blk.card.keywords.has('lifelink')) {
        state.players[defending].life += blk.card.power
      }
    }
  }
}

export function resolveCombat(
  attackerIndices: number[],
  blockerAssignments: Map<number, number[]>,
  state: GameState,
): void {
  const { attackerBoard, defenderBoard } = combatBoards(state)

  for (const atkIdx of attackerIndices) {
    const atk = attackerBoard[atkIdx]
    if (!atk) continue
    if (!atk.card.keywords.has('vigilance')) {
      atk.tapped = true
    }
  }

  damageStep(fightsInFirstStrikeStep, attackerIndices, blockerAssignments, state)

  // State-based actions after first strike
  for (const board of [attackerBoard, defenderBoard]) {
    for (const p of board) {
      if (isDestroyedBySba(p)) {
        p.markedForDeath = true
      }
    }
  }

  damageStep(fightsInNormalStep, attackerIndices, blockerAssignments, state)
}
