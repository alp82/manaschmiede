import { getTraitById } from './trait-mappings'

/**
 * Generate a fallback deck name from selected archetypes and traits.
 */
export function generateDeckName(archetypes: string[], traits: string[]): string {
  const parts: string[] = []

  // Check for tribal + specific tribe
  if (archetypes.includes('tribal')) {
    const tribe = traits
      .map((id) => getTraitById(id))
      .find((t) => t && t.category === 'tribal')
    if (tribe) {
      parts.push(tribe.label)
      parts.push('Tribal')
    }
  }

  // Add archetype labels (skip tribal if already handled)
  for (const id of archetypes) {
    if (id === 'tribal' && parts.length > 0) continue
    const trait = getTraitById(id)
    if (trait) parts.push(trait.label)
  }

  if (parts.length === 0) return 'Custom Deck'
  return parts.join(' ')
}
