/**
 * Tests for validateProposedCards — the intent + synergy gate that vets a
 * chat proposal before it reaches the user.
 *
 * The gate used to live inline in useDeckChat, where it was unreachable from
 * the node-only vitest project. Extracting it made the regression in issue #13
 * testable: a proposal of 24 basics plus 36 spells under rarities:['rare'] must
 * produce zero rejections attributable to the basics, so it never triggers the
 * retry round trip.
 */
import { describe, it, expect } from 'vitest'
import { validateProposedCards } from '../chat-validation'
import { BASIC_LAND_IDS } from '../basic-lands'
import type { DeckFilters } from '../card-validation'
import type { ScryfallCard } from '../scryfall/types'
import { makeCard, makeBasicLand } from './card-fixtures'

// ─── Fixture helpers ───────────────────────────────────────────────────────

/** A rarity-tagged nonland spell priced above any budget floor in these tests. */
function makeSpell(id: string, rarity: string, color_identity: string[] = ['G']): ScryfallCard {
  return makeCard(id, color_identity, {
    rarity,
    cmc: 3,
    type_line: 'Creature — Beast',
    legalities: { modern: 'legal' },
    prices: { usd: '9.00' },
  })
}

type ResolvedMap = Map<string, { card: ScryfallCard; quantity: number }>

function toMap(entries: Array<{ card: ScryfallCard; quantity: number }>): ResolvedMap {
  const map: ResolvedMap = new Map()
  for (const e of entries) map.set(e.card.id, e)
  return map
}

/** 24 Forests plus 36 rare spells — the shape a change-intent proposal takes. */
function fullProposal(): ResolvedMap {
  const entries = [{ card: makeBasicLand(BASIC_LAND_IDS.G, 'Forest', ['G']), quantity: 24 }]
  for (let i = 0; i < 9; i++) {
    entries.push({ card: makeSpell(`rare-${i}`, 'rare'), quantity: 4 })
  }
  return toMap(entries)
}

const RARE_ONLY: DeckFilters = { colors: ['G'], rarities: ['rare'] }

// ─── Issue #13: basics must not trigger the retry ─────────────────────────

describe('validateProposedCards — basic lands under a rarity filter', () => {
  it('24 basics + 36 rare spells under rarities:[rare] -> zero rejections', () => {
    const rejected = validateProposedCards({
      resolvedMap: fullProposal(),
      intentFilters: RARE_ONLY,
    })
    expect(rejected).toEqual([])
  })

  it('no rejection names a basic land', () => {
    const rejected = validateProposedCards({
      resolvedMap: fullProposal(),
      intentFilters: RARE_ONLY,
    })
    expect(rejected.map((r) => r.name)).not.toContain('Forest')
  })

  it('24 basics + 36 rare spells under budgetMin:5 -> zero rejections', () => {
    const rejected = validateProposedCards({
      resolvedMap: fullProposal(),
      intentFilters: { colors: ['G'], budgetMin: 5 },
    })
    expect(rejected).toEqual([])
  })

  it('a common spell in the same proposal is still rejected on rarity', () => {
    const map = fullProposal()
    const junk = makeSpell('junk', 'common')
    map.set(junk.id, { card: junk, quantity: 1 })
    const rejected = validateProposedCards({ resolvedMap: map, intentFilters: RARE_ONLY })
    expect(rejected).toHaveLength(1)
    expect(rejected[0].name).toBe('Card junk')
    expect(rejected[0].reason.toLowerCase()).toMatch(/rarity/)
  })
})

// ─── Gate mechanics carried over from the inline version ──────────────────

describe('validateProposedCards — gate mechanics', () => {
  it('locked cards bypass the gate', () => {
    const offColor = makeSpell('bolt', 'rare', ['R'])
    const rejected = validateProposedCards({
      resolvedMap: toMap([{ card: offColor, quantity: 1 }]),
      intentFilters: RARE_ONLY,
      lockedCardIds: new Set(['bolt']),
    })
    expect(rejected).toEqual([])
  })

  it('the same unlocked card is rejected on color', () => {
    const offColor = makeSpell('bolt', 'rare', ['R'])
    const rejected = validateProposedCards({
      resolvedMap: toMap([{ card: offColor, quantity: 1 }]),
      intentFilters: RARE_ONLY,
    })
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.toLowerCase()).toMatch(/color/)
  })

  it('judgeIds scopes which cards are judged', () => {
    const bad = makeSpell('bad', 'common')
    const good = makeSpell('good', 'rare')
    const map = toMap([
      { card: bad, quantity: 1 },
      { card: good, quantity: 1 },
    ])
    expect(
      validateProposedCards({ resolvedMap: map, intentFilters: RARE_ONLY, judgeIds: new Set(['good']) }),
    ).toEqual([])
    expect(
      validateProposedCards({ resolvedMap: map, intentFilters: RARE_ONLY, judgeIds: new Set(['bad']) }),
    ).toHaveLength(1)
  })

  it('no intentFilters -> only the synergy check runs', () => {
    const common = makeSpell('common', 'common', ['R'])
    const rejected = validateProposedCards({
      resolvedMap: toMap([{ card: common, quantity: 1 }]),
      intentFilters: undefined,
    })
    expect(rejected).toEqual([])
  })

  it('an off-intent card is reported once, not twice', () => {
    const offColor = makeSpell('bolt', 'common', ['R'])
    const rejected = validateProposedCards({
      resolvedMap: toMap([{ card: offColor, quantity: 1 }]),
      intentFilters: RARE_ONLY,
    })
    expect(rejected).toHaveLength(1)
  })

  it('the synergy check sees the whole proposal, not just the judged cards', () => {
    // A tribal payoff needs 4+ Goblins in the composition. They live outside
    // judgeIds, so a composition built only from judged cards would reject it.
    const payoff: ScryfallCard = {
      ...makeSpell('payoff', 'rare'),
      type_line: 'Enchantment',
      oracle_text: 'Goblin creatures you control get +1/+1.',
    }
    const goblins: ScryfallCard = {
      ...makeSpell('goblins', 'rare'),
      type_line: 'Creature — Goblin',
    }
    const rejected = validateProposedCards({
      resolvedMap: toMap([
        { card: payoff, quantity: 1 },
        { card: goblins, quantity: 8 },
      ]),
      intentFilters: RARE_ONLY,
      judgeIds: new Set(['payoff']),
    })
    expect(rejected).toEqual([])
  })
})
