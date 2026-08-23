import type { Permanent } from './types'

/**
 * Does this permanent go to the graveyard when state-based actions are checked?
 *
 * Only creatures die to damage. Artifacts, enchantments, and planeswalkers have
 * no toughness in the rules at all, and `parsePT(undefined)` gives them
 * `toughness: 0` - so a clause gated on "not a land" binned every one of them
 * the instant it resolved, because `0 >= 0`.
 *
 * Planeswalkers dying at zero loyalty isn't modeled; loyalty isn't tracked.
 */
export function isDestroyedBySba(permanent: Permanent): boolean {
  if (permanent.markedForDeath) return true
  if (permanent.card.cardType !== 'creature') return false
  if (permanent.card.keywords.has('indestructible')) return false
  return permanent.damage >= permanent.card.toughness
}
