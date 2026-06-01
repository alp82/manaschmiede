import { describe, it, expect } from 'vitest'
import { pickSectionForCard, type DeckSection } from '../section-plan'
import type { ScryfallCard } from '../scryfall/types'

// Minimal ScryfallCard stub — only fields that pickSectionForCard reads
function card(type_line: string, oracle_text: string = ''): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    lang: 'en',
    layout: 'normal',
    cmc: 2,
    type_line,
    oracle_text,
    color_identity: [],
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    collector_number: '1',
    legalities: {},
  }
}

// Minimal plan entries keyed by role
function planWith(...roles: DeckSection['role'][]): DeckSection[] {
  return roles.map((role, i) => ({
    id: `section-${i}`,
    label: role,
    description: '',
    targetCount: 8,
    role,
    scryfallHints: [],
  }))
}

describe('pickSectionForCard', () => {
  it('creature -> role "creatures"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    const result = pickSectionForCard(card('Creature — Human'), sections)
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('creatures')
  })

  it('land -> role "lands"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    const result = pickSectionForCard(card('Basic Land — Forest'), sections)
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('lands')
  })

  it('enchantment/artifact -> role "support"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    const enchResult = pickSectionForCard(card('Enchantment'), sections)
    const artResult = pickSectionForCard(card('Artifact'), sections)
    expect(sections.find((s) => s.id === enchResult)?.role).toBe('support')
    expect(sections.find((s) => s.id === artResult)?.role).toBe('support')
  })

  it('instant with removal/destroy oracle text -> "interaction" preferred over "spells"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    // Contains "destroy" — matches the interaction regex
    const result = pickSectionForCard(
      card('Instant', 'Destroy target creature.'),
      sections,
    )
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('interaction')
  })

  it('instant with "exile" oracle text -> "interaction" preferred over "spells"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    const result = pickSectionForCard(
      card('Instant', 'Exile target nonland permanent.'),
      sections,
    )
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('interaction')
  })

  it('instant without interaction keyword -> "spells" preferred over "interaction"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    // No destroy/exile/counter target/return target — it's a cantrip
    const result = pickSectionForCard(
      card('Instant', 'Draw two cards.'),
      sections,
    )
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('spells')
  })

  it('sorcery without interaction keyword -> "spells" preferred over "interaction"', () => {
    const sections = planWith('creatures', 'spells', 'support', 'interaction', 'lands')
    const result = pickSectionForCard(
      card('Sorcery', 'Search your library for up to two land cards and put them onto the battlefield.'),
      sections,
    )
    const match = sections.find((s) => s.id === result)
    expect(match?.role).toBe('spells')
  })

  it('no matching role in plan -> null', () => {
    // Plan has no "creatures" section — a creature card should return null only if
    // ALL preferred roles are absent. Here plan only has interaction and lands.
    const sections = planWith('interaction', 'lands')
    const result = pickSectionForCard(card('Creature — Elf'), sections)
    expect(result).toBeNull()
  })

  it('empty plan -> null for every card type', () => {
    const sections: DeckSection[] = []
    expect(pickSectionForCard(card('Creature — Dragon'), sections)).toBeNull()
    expect(pickSectionForCard(card('Instant', 'Destroy target creature.'), sections)).toBeNull()
    expect(pickSectionForCard(card('Land'), sections)).toBeNull()
    expect(pickSectionForCard(card('Enchantment'), sections)).toBeNull()
  })
})
