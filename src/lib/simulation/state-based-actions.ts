import type { Permanent } from './types'

/**
 * Whether `damage` on top of what `target` already carries kills it, given
 * whether a deathtouch source dealt any of it.
 *
 * This is where lethality is priced, for everyone: combat asks it about a
 * single damage assignment, the AI asks it about a block it is considering,
 * and `isDestroyedBySba` asks it about the mark combat left behind. Deathtouch
 * used to be modelled as an enormous damage number instead, which worked only
 * for blockers - an attacker assigns `lethalDamage`'s 1, so the number never
 * reached a toughness.
 */
export function isLethalTo(target: Permanent, damage: number, deathtouch: boolean): boolean {
  if (target.card.keywords.has('indestructible')) return false
  const total = target.damage + damage
  if ((deathtouch || target.deathtouched) && total > 0) return true
  return total >= target.card.toughness
}

/**
 * Does this permanent go to the graveyard when state-based actions are checked?
 *
 * Only creatures die to damage. Artifacts, enchantments, and planeswalkers have
 * no toughness in the rules at all, and `parsePT(undefined)` gives them
 * `toughness: 0` - so a clause gated on "not a land" binned every one of them
 * the instant it resolved, because `0 >= 0`.
 *
 * Deathtouch is covered by asking `isLethalTo` about no further damage: combat
 * marks the creature that took it, and this reads the mark back.
 *
 * Planeswalkers dying at zero loyalty isn't modeled; loyalty isn't tracked.
 */
export function isDestroyedBySba(permanent: Permanent): boolean {
  if (permanent.markedForDeath) return true
  if (permanent.card.cardType !== 'creature') return false
  return isLethalTo(permanent, 0, false)
}
