/**
 * Tests for the tribal-gating fix in findSynergyIssue.
 *
 * The fix distinguishes between two oracle-text patterns:
 *
 *   GRANT  — the card *grants* a type or grants a conditional clause:
 *              "It's a Demon in addition to its other types."
 *              "Target creature becomes a Zombie in addition..."
 *              "As long as it's a Zombie, it gets +1/+1."
 *            These must NOT trigger a synergy issue because the card creates
 *            the tribe rather than requiring it.
 *
 *   LORD   — the card *requires* existing tribal members to generate value:
 *              "Other Goblin creatures you control get +1/+1."
 *              "Goblin creatures you control get +1/+0."
 *              "Whenever a Dragon you control attacks..."
 *            These MUST trigger an issue when the deck lacks the tribe.
 *
 * The GRANT / CONDITIONAL cases (1-3) are RED against the current bare-word
 * regex (it returns non-null, but we expect null).  They go green when the
 * fix lands.
 *
 * The LORD REGRESSION GUARD cases (4-7) are GREEN now (current code catches
 * them correctly) and must STAY green after the fix — they prevent the fix
 * from over-relaxing.
 *
 * SHORT-CIRCUIT cases (8-9) confirm that a satisfied tribe unlocks the card.
 *
 * The NIGHTMARE case (10) is RED now because "Nightmare" is not yet in
 * TRIBAL_TYPES; it goes non-null once the type is added and the gating patch
 * lands together.
 */
import { describe, it, expect } from 'vitest'
import { analyzeComposition, findSynergyIssue } from '../synergy-validation'
import type { ScryfallCard } from '../scryfall/types'

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal ScryfallCard stub.
 *
 * CRITICAL: card names must be tribe-free ("Card <id>") because
 * findSynergyIssue strips the card's own name from oracle text before
 * matching.  Placing a tribe word in the name would cause it to be stripped,
 * breaking the test.  All tribe references belong only in type_line and
 * oracle_text.
 */
function makeCard(
  id: string,
  type_line: string,
  oracle_text: string = '',
): ScryfallCard {
  return {
    id,
    name: `Card ${id}`,
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

/** Shorthand: build a DeckComposition from a list of {card, quantity} entries. */
function comp(entries: Array<{ card: ScryfallCard; quantity: number }>) {
  return analyzeComposition(entries)
}

// ─── GRANT / CONDITIONAL ──────────────────────────────────────────────────
//
// These cases are RED against the current bare-word regex.
// Expected: null (no issue). Current code: non-null (false positive).

describe('findSynergyIssue — GRANT / CONDITIONAL cases (expect null)', () => {
  it('1. GRANT "is a <tribe> in addition" — Demonic Embrace bug: aura that makes a creature a Demon should not require Demons in the deck', () => {
    // The exact bug: Demonic Embrace oracle says "It's a Demon in addition to
    // its other types."  The bare-word regex matches "Demon" and raises an
    // issue even though the card *grants* the type, it doesn't *require* it.
    const card = makeCard(
      'demonic-embrace',
      'Enchantment — Aura',
      "Enchanted creature gets +3/+1 and has flying. It's a Demon in addition to its other types.",
    )

    const result = findSynergyIssue(card, comp([]), { tribalThreshold: 1 })

    expect(result).toBeNull()
  })

  it('2. GRANT "becomes a <tribe>" — type-granting effect should not require the tribe', () => {
    const card = makeCard(
      'type-grant',
      'Instant',
      'Target creature becomes a Zombie in addition to its other types until end of turn.',
    )

    const result = findSynergyIssue(card, comp([]), { tribalThreshold: 1 })

    expect(result).toBeNull()
  })

  it('3. CONDITIONAL "as long as it\'s a <tribe>" — self-referential clause should not require the tribe', () => {
    const card = makeCard(
      'conditional-zombie',
      'Enchantment — Aura',
      "As long as it's a Zombie, it gets +1/+1.",
    )

    const result = findSynergyIssue(card, comp([]), { tribalThreshold: 1 })

    expect(result).toBeNull()
  })
})

// ─── LORD REGRESSION GUARDS ───────────────────────────────────────────────
//
// These cases are GREEN now (current code catches them correctly).
// They must remain non-null after the fix — they ensure the fix doesn't
// over-relax the tribal gate.

describe('findSynergyIssue — LORD REGRESSION GUARDS (expect non-null)', () => {
  it('4. MODERN lord "creatures you control" infix — classic lord missing tribe members', () => {
    // The lord is a Goblin itself, so it self-seeds Goblin=1 in the
    // composition. 1 < 4 is still rejected at tribalThreshold 4.
    // type_line is "Creature — Goblin" (not Enchantment) to test honest
    // self-seeding without dodging.
    const lord = makeCard(
      'goblin-lord',
      'Creature — Goblin',
      'Other Goblin creatures you control get +1/+1 and have haste.',
    )

    const result = findSynergyIssue(
      lord,
      comp([{ card: lord, quantity: 1 }]),
      { tribalThreshold: 4 },
    )

    expect(result).not.toBeNull()
    expect(result!.reason).toMatch(/Goblin/)
  })

  it('5. OLD lord (no "you control") — bare "Other Goblins get +1/+1" form', () => {
    const lord = makeCard(
      'old-goblin-lord',
      'Creature — Goblin',
      'Other Goblins get +1/+1 and have mountainwalk.',
    )

    const result = findSynergyIssue(
      lord,
      comp([{ card: lord, quantity: 1 }]),
      { tribalThreshold: 4 },
    )

    expect(result).not.toBeNull()
    expect(result!.reason).toMatch(/Goblin/)
  })

  it('6. BOUNDARY "Goblin creatures you control" (no "other") — still a lord pattern', () => {
    const lord = makeCard(
      'goblin-anthem',
      'Creature — Goblin',
      'Goblin creatures you control get +1/+0.',
    )

    const result = findSynergyIssue(
      lord,
      comp([{ card: lord, quantity: 1 }]),
      { tribalThreshold: 4 },
    )

    expect(result).not.toBeNull()
    expect(result!.reason).toMatch(/Goblin/)
  })

  it('7. Dragon Tempest — enchantment with two Dragon triggers; name is tribe-free', () => {
    // Real text (name stripped to tribe-free to satisfy the fixture rule).
    // The oracle references Dragon in a "you control" trigger — should flag.
    const card = makeCard(
      'dragon-tempest',
      'Enchantment',
      'Whenever  or another Dragon enters the battlefield, choose one. Whenever a Dragon you control attacks, it deals damage equal to the number of Dragons you control to any target.',
    )

    const result = findSynergyIssue(card, comp([]), { tribalThreshold: 4 })

    expect(result).not.toBeNull()
    expect(result!.reason).toMatch(/Dragon/)
  })
})

// ─── SHORT-CIRCUIT ────────────────────────────────────────────────────────
//
// A satisfied tribe (count >= threshold) short-circuits the issue.

describe('findSynergyIssue — SHORT-CIRCUIT (expect null when tribe is satisfied)', () => {
  it('8. Satisfied tribe: 4 Goblins in composition + the lord satisfies the threshold', () => {
    // Build 4 vanilla Goblin creatures plus the lord itself.
    const goblin1 = makeCard('goblin-1', 'Creature — Goblin')
    const goblin2 = makeCard('goblin-2', 'Creature — Goblin')
    const goblin3 = makeCard('goblin-3', 'Creature — Goblin')
    const goblin4 = makeCard('goblin-4', 'Creature — Goblin')
    const lord = makeCard(
      'goblin-lord-sat',
      'Creature — Goblin',
      'Other Goblin creatures you control get +1/+1.',
    )

    const composition = comp([
      { card: goblin1, quantity: 1 },
      { card: goblin2, quantity: 1 },
      { card: goblin3, quantity: 1 },
      { card: goblin4, quantity: 1 },
      { card: lord, quantity: 1 },
    ])

    const result = findSynergyIssue(lord, composition, { tribalThreshold: 4 })

    expect(result).toBeNull()
  })

  it('9. Multi-tribe, one satisfied: Elf (4 copies) satisfies even though Goblin (0) does not', () => {
    const elf1 = makeCard('elf-1', 'Creature — Elf')
    const elf2 = makeCard('elf-2', 'Creature — Elf')
    const elf3 = makeCard('elf-3', 'Creature — Elf')
    const elf4 = makeCard('elf-4', 'Creature — Elf')

    // Oracle references both Elf and Goblin lords; only Elf is in the deck.
    const card = makeCard(
      'dual-lord',
      'Creature — Elf',
      'Other Elf creatures you control get +1/+1. Other Goblins you control get +1/+0.',
    )

    const composition = comp([
      { card: elf1, quantity: 1 },
      { card: elf2, quantity: 1 },
      { card: elf3, quantity: 1 },
      { card: elf4, quantity: 1 },
    ])

    const result = findSynergyIssue(card, composition, { tribalThreshold: 4 })

    expect(result).toBeNull()
  })
})

// ─── NIGHTMARE ────────────────────────────────────────────────────────────
//
// RED now: "Nightmare" is not yet in TRIBAL_TYPES, so the current code
// returns null.  Once Nightmare is added to TRIBAL_TYPES AND the gating fix
// correctly identifies the lord pattern, this should return non-null.

describe('findSynergyIssue — NIGHTMARE (expect non-null after TRIBAL_TYPES addition)', () => {
  it('10. Nightmare tribal lord: not yet in TRIBAL_TYPES → currently returns null (RED)', () => {
    const card = makeCard(
      'nightmare-lord',
      'Enchantment',
      'Nightmare creatures you control get +1/+1.',
    )

    const result = findSynergyIssue(card, comp([]), { tribalThreshold: 4 })

    // This asserts the post-fix behaviour: non-null once Nightmare is in the list.
    expect(result).not.toBeNull()
    expect(result!.reason).toMatch(/Nightmare/)
  })
})
