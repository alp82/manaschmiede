import type { BlockAssignments, GameState, Permanent, PlayerState } from './types'
import { isDestroyedBySba, isLethalTo } from './state-based-actions'

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (attacker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('flying') &&
    !blocker.card.keywords.has('reach')) {
    return false
  }
  return true
}

/**
 * Whether the damage `sources` deal in one step kills `target`, counting the
 * damage already marked on it.
 *
 * A source with no power deals nothing, so a 0-power deathtoucher kills
 * nothing either.
 */
export function killedBy(target: Permanent, sources: readonly Permanent[]): boolean {
  let damage = 0
  let deathtouch = false
  for (const source of sources) {
    if (source.card.power <= 0) continue
    damage += source.card.power
    if (source.card.keywords.has('deathtouch')) deathtouch = true
  }
  return isLethalTo(target, damage, deathtouch)
}

/** Marks `amount` damage from `source` on `target`, deathtouch included. */
function dealDamage(target: Permanent, source: Permanent, amount: number): void {
  if (amount <= 0) return
  target.damage += amount
  if (source.card.keywords.has('deathtouch')) target.deathtouched = true
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
  blockers: readonly Permanent[],
): boolean {
  if (fightsInFirstStrikeStep(attacker)) return false
  return killedBy(attacker, blockers.filter(fightsInFirstStrikeStep))
}

/**
 * One combat damage step. Damage inside a step is simultaneous: a creature that
 * takes lethal damage here still deals its own, and only the sweep between the
 * two steps takes the dead off the battlefield.
 */
function damageStep(
  dealsDamageThisStep: (p: Permanent) => boolean,
  attackerIndices: number[],
  blockerAssignments: BlockAssignments,
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
          dealDamage(blk, atk, dealt)
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
    // Both directions mark deathtouch the same way, through `dealDamage`. An
    // attacker only ever assigns `lethalDamage`'s 1 so the rest can be spread
    // or trampled over, which is why the kill can't ride on the number.
    for (const blkIdx of blockerIdxs) {
      const blk = defenderBoard[blkIdx]
      if (!blk || blk.markedForDeath || !dealsDamageThisStep(blk)) continue
      dealDamage(atk, blk, blk.card.power)
      if (blk.card.keywords.has('lifelink')) {
        state.players[defending].life += blk.card.power
      }
    }
  }
}

export function resolveCombat(
  attackerIndices: number[],
  blockerAssignments: BlockAssignments,
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

/** What one combat would do, read off a throwaway copy of the battlefields. */
export interface CombatForecast {
  /** Net life change for the defending player. Negative is damage taken. */
  defenderLifeChange: number
  /** Net life change for the attacking player. Positive comes from lifelink. */
  attackerLifeChange: number
  /** Attacking creatures that die, as clones - identity is not the caller's. */
  attackersLost: Permanent[]
  /** Blocking creatures that die, as clones - identity is not the caller's. */
  blockersLost: Permanent[]
}

/** A player with nothing but a battlefield. Combat reads no other zone. */
function battlefieldOnly(battlefield: Permanent[]): PlayerState {
  return {
    life: 0,
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    landDropsRemaining: 0,
    spellsCastThisTurn: 0,
  }
}

/**
 * Resolves `attackerIndices` against `blockerAssignments` on a copy of both
 * battlefields and reports the outcome.
 *
 * The AI needs to know what an attack costs before declaring it, and the only
 * answer that can't drift from the rules is the one `resolveCombat` itself
 * gives. So this clones the permanents, runs the real combat over the clones,
 * and reads the result - rather than restating first strike, trample, and
 * deathtouch a second time in the AI.
 *
 * Both players start at 0 life, so the reported changes are deltas the caller
 * applies to whatever the real life totals are.
 */
export function forecastCombat(
  attackerIndices: number[],
  blockerAssignments: BlockAssignments,
  attackerBoard: readonly Permanent[],
  defenderBoard: readonly Permanent[],
): CombatForecast {
  const attackers = attackerBoard.map((p) => ({ ...p }))
  const defenders = defenderBoard.map((p) => ({ ...p }))
  const state: GameState = {
    players: [battlefieldOnly(attackers), battlefieldOnly(defenders)],
    round: 0,
    activePlayer: 0,
    phase: 'combat',
  }

  resolveCombat(attackerIndices, blockerAssignments, state)

  return {
    attackerLifeChange: state.players[0].life,
    defenderLifeChange: state.players[1].life,
    attackersLost: attackers.filter(isDestroyedBySba),
    blockersLost: defenders.filter(isDestroyedBySba),
  }
}
