import { describe, expect, it } from 'vitest'
import {
  CALLS_PER_BUILD,
  LATENCY_CEILING_MS,
  MAX_PROJECTED_BUILD_COST_USD,
  checkRun,
  clearsGate,
  gateProbes,
  type CardFact,
  type GateFacts,
  type GateRun,
  type GateRunInput,
} from '../lib/mechanicalGate'
import { LAND_COUNT_RANGE, TARGET_DECK_SIZE } from '../lib/deckRules'

/**
 * The mechanical gate judges a candidate model's raw output. These tests pin
 * the two halves issue #55 decided: which checks disqualify a run and which
 * only score it, and what it takes for a set of runs to clear the gate.
 */

function fact(name: string, overrides: Partial<CardFact> = {}): CardFact {
  return {
    name,
    type_line: 'Creature — Elf',
    cmc: 2,
    color_identity: ['G'],
    layout: 'normal',
    set: 'lea',
    set_name: 'Alpha',
    legalities: {},
    ...overrides,
  }
}

function factsFor(...cards: CardFact[]): GateFacts {
  return { cards: new Map(cards.map((c) => [c.name, c])) }
}

const scenario = { colors: ['G'], archetype: 'aggro' }

function run(overrides: Partial<GateRunInput>): GateRunInput {
  return {
    site: 'chat.generate',
    scenario,
    text: '',
    stopReason: 'end_turn',
    durationMs: 1000,
    // Under the ceiling on every site, including the seven-per-build strategy parse.
    costUsd: 0.005,
    ...overrides,
  }
}

/** A clean 60: 4× of nine spells, 22 Forests, 2 Llanowar Elves. */
function deckJson(cards: Array<{ name: string; quantity: number }>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'Elves', description: 'Go wide', cards, ...extra })
}

const SPELLS = Array.from({ length: 9 }, (_, i) => `Elf ${i}`)
const cleanDeck = [
  ...SPELLS.map((name) => ({ name, quantity: 4 })),
  { name: 'Llanowar Elves', quantity: 2 },
  { name: 'Forest', quantity: 22 },
]
const cleanFacts = factsFor(
  ...SPELLS.map((name) => fact(name)),
  fact('Llanowar Elves', { cmc: 1 }),
  fact('Forest', { type_line: 'Basic Land — Forest', cmc: 0, color_identity: [] }),
)

describe('shared hard fails', () => {
  it('a clean deck clears every hard check and reports rung 1', () => {
    const result = checkRun(run({ text: deckJson(cleanDeck) }), cleanFacts)
    expect(result.hardFail).toBeNull()
    expect(result.scores.rung).toBe(1)
    expect(result.scores.countDistance).toBe(0)
    expect(result.scores.repairDistance).toBe(0)
  })

  it('truncation is a hard fail whatever the text says', () => {
    const result = checkRun(run({ text: deckJson(cleanDeck), stopReason: 'max_tokens' }), cleanFacts)
    expect(result.hardFail).toContain('truncated')
  })

  it('latency over the site ceiling is a hard fail, per tempo', () => {
    const slowDeck = checkRun(run({ text: deckJson(cleanDeck), durationMs: LATENCY_CEILING_MS.deck + 1 }), cleanFacts)
    expect(slowDeck.hardFail).toContain('latency')
    const okDeck = checkRun(run({ text: deckJson(cleanDeck), durationMs: LATENCY_CEILING_MS.mechanical + 1 }), cleanFacts)
    expect(okDeck.hardFail).toBeNull()
    const slowClassify = checkRun(
      run({ site: 'chat.classify', text: 'delta', durationMs: LATENCY_CEILING_MS.mechanical + 1 }),
      factsFor(),
    )
    expect(slowClassify.hardFail).toContain('latency')
  })

  it('cost is projected over calls per build and hard-fails past the ceiling', () => {
    const perCall = MAX_PROJECTED_BUILD_COST_USD / CALLS_PER_BUILD.fillSection + 0.0001
    const result = checkRun(
      run({ site: 'fillSection', text: JSON.stringify({ cards: [{ name: 'Elf 0', quantity: 4 }] }), costUsd: perCall }),
      cleanFacts,
    )
    expect(result.scores.projectedBuildCostUsd).toBeCloseTo(perCall * 6, 6)
    expect(result.hardFail).toContain('projected build')
    // The same per-call cost on a once-per-build site passes.
    expect(checkRun(run({ text: deckJson(cleanDeck), costUsd: perCall }), cleanFacts).hardFail).toBeNull()
  })

  it('accumulates reasons instead of stopping at the first', () => {
    const result = checkRun(run({ text: 'not json', stopReason: 'max_tokens' }), factsFor())
    expect(result.hardFail).toBe('truncated · no JSON at any rung')
  })
})

describe('parse and schema', () => {
  it('no JSON at any rung is a hard fail with no rung', () => {
    const result = checkRun(run({ text: 'Here is your deck: Forest x22' }), factsFor())
    expect(result.hardFail).toBe('no JSON at any rung')
    expect(result.scores.rung).toBeNull()
  })

  it('JSON of the wrong shape is a schema mismatch', () => {
    const result = checkRun(run({ text: JSON.stringify({ cards: cleanDeck }) }), cleanFacts) // no name
    expect(result.hardFail).toBe('schema mismatch')
  })

  it('reports the rung the deck was found on', () => {
    const fenced = '```json\n' + deckJson(cleanDeck) + '\n```'
    expect(checkRun(run({ text: fenced }), cleanFacts).scores.rung).toBe(2)
    const prose = 'Sure! ' + deckJson(cleanDeck) + ' Enjoy.'
    expect(checkRun(run({ text: prose }), cleanFacts).scores.rung).toBe(3)
  })
})

describe('deck profile', () => {
  it('a card Scryfall does not know is a hard fail, listed by name', () => {
    const deck = [...cleanDeck.slice(0, -1), { name: 'Forest', quantity: 18 }, { name: 'Elvish Dreamwurm', quantity: 4 }]
    const result = checkRun(run({ text: deckJson(deck) }), cleanFacts)
    expect(result.hardFail).toBe('nonexistent: Elvish Dreamwurm')
    expect(result.scores.nonexistentCards).toEqual(['Elvish Dreamwurm'])
  })

  it('a name the wrapper never looked up counts as nonexistent', () => {
    const facts: GateFacts = { cards: new Map([...cleanFacts.cards].filter(([name]) => name !== 'Elf 3')) }
    expect(checkRun(run({ text: deckJson(cleanDeck) }), facts).hardFail).toBe('nonexistent: Elf 3')
  })

  it('off-pool and off-color cards are scored, not failed', () => {
    const facts: GateFacts = {
      cards: new Map([
        ...cleanFacts.cards,
        ['Elf 0', fact('Elf 0', { layout: 'token' })],
        ['Elf 1', fact('Elf 1', { color_identity: ['G', 'B'] })],
      ]),
    }
    const result = checkRun(run({ text: deckJson(cleanDeck) }), facts)
    expect(result.hardFail).toBeNull()
    expect(result.scores.offPoolCards).toEqual(['Elf 0'])
    expect(result.scores.offColorCards).toEqual(['Elf 1'])
  })

  it('count, copies and repair are scored from the raw deck, before enforcement', () => {
    // 5 copies of one spell and only 12 Forests: 50 cards, one over-copy.
    const deck = [
      ...SPELLS.map((name) => ({ name, quantity: 4 })),
      { name: 'Elf 0', quantity: 1 }, // duplicate entry -> merges to 5
      { name: 'Forest', quantity: 13 },
    ]
    const result = checkRun(run({ text: deckJson(deck) }), cleanFacts)
    expect(result.hardFail).toBeNull()
    expect(result.scores.countDistance).toBe(TARGET_DECK_SIZE - 50)
    expect(result.scores.overCopies).toBe(1)
    // Enforcer clamps Elf 0 to 4 (−1) and pads 11 Forests (+11).
    expect(result.scores.repairDistance).toBe(12)
  })

  it('land band and curve are scores that never disqualify', () => {
    const deck = [...SPELLS.map((name) => ({ name, quantity: 4 })), { name: 'Forest', quantity: 24 }]
    const facts: GateFacts = {
      cards: new Map([...cleanFacts.cards].map(([name, f]) => [name, f && name.startsWith('Elf') ? { ...f, cmc: 6 } : f])),
    }
    const result = checkRun(run({ text: deckJson(deck), scenario: { colors: ['G'], archetype: 'control' } }), facts)
    expect(result.hardFail).toBeNull()
    expect(result.scores.landCount).toBe(24)
    expect(result.scores.landVerdict).toBe('ok')
    expect(result.scores.landDistance).toBe(2) // control wants 26
    expect(result.scores.averageManaValue).toBe(6)
    expect(result.scores.curveTooHigh).toBe(true)

    const noLands = checkRun(run({ text: deckJson(SPELLS.map((name) => ({ name, quantity: 4 }))) }), cleanFacts)
    expect(noLands.hardFail).toBeNull()
    expect(noLands.scores.landVerdict).toBe('too-few')
    expect(noLands.scores.landDistance).toBe(LAND_COUNT_RANGE.min)
  })

  it('counts lands by type line, not only by basic name', () => {
    const deck = [...SPELLS.map((name) => ({ name, quantity: 4 })), { name: 'Pendelhaven', quantity: 4 }, { name: 'Forest', quantity: 20 }]
    const facts: GateFacts = {
      cards: new Map([...cleanFacts.cards, ['Pendelhaven', fact('Pendelhaven', { type_line: 'Legendary Land', cmc: 0, color_identity: ['G'] })]]),
    }
    expect(checkRun(run({ text: deckJson(deck) }), facts).scores.landCount).toBe(24)
  })
})

describe('other profiles', () => {
  it('fillSection scores distance from the requested count and clears on a clean fill', () => {
    const text = JSON.stringify({ cards: [{ name: 'Elf 0', quantity: 4 }, { name: 'Elf 1', quantity: 2 }] })
    const result = checkRun(run({ site: 'fillSection', text, scenario: { colors: ['G'], requestedCount: 8 } }), cleanFacts)
    expect(result.hardFail).toBeNull()
    expect(result.scores.countDistance).toBe(2)
    expect(result.scores.repairDistance).toBeNull()
  })

  it('suggestCombos checks every named card and fails an empty combo list', () => {
    const text = JSON.stringify({ combos: [{ name: 'Elfball', cards: ['Elf 0', 'Nonesuch'], explanation: 'x' }] })
    const result = checkRun(run({ site: 'suggestCombos', text }), cleanFacts)
    expect(result.hardFail).toBe('nonexistent: Nonesuch')
    expect(result.scores.combos).toBe(1)
    const empty = checkRun(run({ site: 'suggestCombos', text: JSON.stringify({ combos: [] }) }), cleanFacts)
    expect(empty.hardFail).toBe('no combos')
  })

  it('chat.classify normalizes the label, fails an unknown one, and scores correctness', () => {
    const facts = factsFor()
    const right = checkRun(run({ site: 'chat.classify', text: ' Delta\n', scenario: { colors: [], expectedLabel: 'delta' } }), facts)
    expect(right.hardFail).toBeNull()
    expect(right.scores.correct).toBe(true)
    const wrong = checkRun(run({ site: 'chat.classify', text: 'rebuild', scenario: { colors: [], expectedLabel: 'delta' } }), facts)
    expect(wrong.hardFail).toBeNull()
    expect(wrong.scores.correct).toBe(false)
    const unknown = checkRun(run({ site: 'chat.classify', text: 'I think this is a delta edit.' }), facts)
    expect(unknown.hardFail).toContain('label')
  })

  it('strategyParse fails on no fragments and scores queries that miss', () => {
    const none = checkRun(run({ site: 'strategyParse', text: '[]' }), factsFor())
    expect(none.hardFail).toContain('no usable fragments')
    const facts: GateFacts = { cards: new Map(), queries: new Map([['t:elf', 400], ['o:"bogus syntax', null], ['t:nothing', 0]]) }
    const some = checkRun(run({ site: 'strategyParse', text: '["t:elf", "o:\\"bogus syntax", "t:nothing"]' }), facts)
    expect(some.hardFail).toBeNull()
    expect(some.scores.fragments).toBe(3)
    expect(some.scores.missedQueries).toEqual(['o:"bogus syntax', 't:nothing'])
  })
})

describe('gateProbes', () => {
  it('names every distinct card a response carries, and nothing for a response that does not parse', () => {
    expect(gateProbes('chat.generate', deckJson(cleanDeck)).cardNames).toHaveLength(11)
    expect(gateProbes('suggestCombos', JSON.stringify({ combos: [{ name: 'a', cards: ['X', 'Y', 'X'], explanation: '' }] })).cardNames).toEqual(['X', 'Y'])
    expect(gateProbes('strategyParse', '["t:elf"]').queries).toEqual(['t:elf'])
    expect(gateProbes('chat.generate', 'nope')).toEqual({ cardNames: [], queries: [] })
    expect(gateProbes('chat.classify', 'delta')).toEqual({ cardNames: [], queries: [] })
  })
})

describe('clearsGate', () => {
  const pass: GateRun = { site: 'chat.generate', hardFail: null, scores: checkRun(run({ text: deckJson(cleanDeck) }), cleanFacts).scores }
  const fail: GateRun = { ...pass, hardFail: 'truncated' }
  const runsFor = (pattern: Array<[string, GateRun]>) => pattern.map(([scenarioId, r]) => ({ scenarioId, run: r }))

  it('clears on ≥ 90% hard-fail-free with no scenario failing twice', () => {
    const runs = runsFor([...Array.from({ length: 9 }, (_, i) => [`s${i % 2}`, pass] as [string, GateRun]), ['s0', fail]])
    const verdict = clearsGate('chat.generate', runs)
    expect(verdict.clears).toBe(true)
    expect(verdict.hardFailFreeRate).toBeCloseTo(0.9)
  })

  it('fails under 90%, and fails a scenario that fails twice even at 90%+', () => {
    const under = clearsGate('chat.generate', runsFor([['a', pass], ['b', pass], ['c', fail]]))
    expect(under.clears).toBe(false)
    expect(under.reasons[0]).toContain('hard-fail-free')

    const nineteenPass = Array.from({ length: 18 }, (_, i) => [`s${i}`, pass] as [string, GateRun])
    const twice = clearsGate('chat.generate', runsFor([...nineteenPass, ['x', fail], ['x', fail]]))
    expect(twice.hardFailFreeRate).toBeCloseTo(0.9)
    expect(twice.clears).toBe(false)
    expect(twice.failingScenarios).toEqual({ x: 2 })
  })

  it('does not clear with no runs, and flags rung 3 over 20%', () => {
    expect(clearsGate('chat.generate', []).clears).toBe(false)
    const rung3: GateRun = { ...pass, scores: { ...pass.scores, rung: 3 } }
    const verdict = clearsGate('chat.generate', runsFor([['a', rung3], ['b', pass], ['c', pass], ['d', pass]]))
    expect(verdict.clears).toBe(true)
    expect(verdict.rung3Prominent).toBe(true)
  })

  it('chat.classify also needs 95% accuracy', () => {
    const correct: GateRun = { site: 'chat.classify', hardFail: null, scores: { ...pass.scores, correct: true } }
    const wrong: GateRun = { ...correct, scores: { ...correct.scores, correct: false } }
    const runs = runsFor([...Array.from({ length: 18 }, (_, i) => [`s${i}`, correct] as [string, GateRun]), ['w', wrong]])
    const verdict = clearsGate('chat.classify', runs)
    expect(verdict.hardFailFreeRate).toBe(1)
    expect(verdict.classifyAccuracy).toBeCloseTo(18 / 19)
    expect(verdict.clears).toBe(false)
    expect(verdict.reasons[0]).toContain('classify accuracy')
  })
})
