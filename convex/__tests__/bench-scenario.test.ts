import { describe, expect, it } from 'vitest'
import { benchFirstCandidates, blindLabels, isBenchSite, readScenarioFacts } from '../lib/benchScenario'
import { buildIntentContextPrompt } from '../lib/intentContext'
import { SYSTEM_PROMPT, SECTION_FILL_SYSTEM_PROMPT } from '../generateDeck'

/**
 * A scenario is read out of a real prompt, so these tests build the prompt
 * the way the call sites do and check the facts come back out.
 */

const context = buildIntentContextPrompt({
  colors: ['G', 'B'],
  archetypes: ['Tribal (creature-type synergy)', 'Aggro (fast creatures)'],
  traits: ['Elves'],
  customStrategy: 'elves that drain the opponent',
})

describe('readScenarioFacts', () => {
  it('reads a chat.generate scenario from the intent context', () => {
    const facts = readScenarioFacts('chat.generate', SYSTEM_PROMPT + context, [
      { role: 'user', content: 'Build me an elf deck\nwith lifedrain' },
    ])
    expect(facts.colors).toEqual(['G', 'B'])
    expect(facts.archetypes).toEqual(['Tribal', 'Aggro'])
    expect(facts.archetype).toBe('tribal')
    expect(facts.idea).toBe('elves that drain the opponent')
    expect(facts.requestedCount).toBeUndefined()
  })

  it('falls back to the first line of the user turn when there is no strategy', () => {
    const noStrategy = buildIntentContextPrompt({ colors: ['R'], archetypes: [], traits: [] })
    const facts = readScenarioFacts('chat.generate', SYSTEM_PROMPT + noStrategy, [
      { role: 'user', content: '\nMake it burn\nplease' },
    ])
    expect(facts).toMatchObject({ colors: ['R'], archetypes: [], archetype: undefined, idea: 'Make it burn' })
  })

  it('reads a fillSection scenario including the requested count', () => {
    const facts = readScenarioFacts('fillSection', SECTION_FILL_SYSTEM_PROMPT + context, [
      {
        role: 'user',
        content:
          'Fill the "Removal" section with exactly 6 cards total (sum of quantities = 6).\n\nSection description: Spot removal and sweepers',
      },
    ])
    expect(facts.requestedCount).toBe(6)
    expect(facts.idea).toBe('Removal: Spot removal and sweepers')
    expect(facts.colors).toEqual(['G', 'B'])
  })

  it('reads a suggestCombos scenario from the user turn', () => {
    const user = [
      'Suggest exactly 5 core card combinations for a deck with these preferences:',
      'SELECTED colors (committed - every combo must live within SELECTED ∪ MAYBE): Green (G), Black (B)',
      'MAYBE colors (each one MUST appear in at least one combo\'s color identity across the batch): White (W)',
      'Archetypes:',
      '- Tribal (creature-type synergy)',
      '- Aggro (fast creatures)',
      'Traits/themes: Elves',
      '',
      'USER STRATEGY (treat as a commitment): The player described their deck as: "elves that drain". At least 2 of the 5 combos MUST clearly reflect this.',
    ].join('\n')
    const facts = readScenarioFacts('suggestCombos', 'system', [{ role: 'user', content: user }])
    expect(facts.colors).toEqual(['G', 'B', 'W'])
    expect(facts.archetypes).toEqual(['Tribal', 'Aggro'])
    expect(facts.archetype).toBe('tribal')
    expect(facts.idea).toBe('elves that drain')
  })

  it('names a suggestCombos scenario by its archetypes when there is no strategy', () => {
    const facts = readScenarioFacts('suggestCombos', 'system', [
      { role: 'user', content: 'SELECTED colors: Red (R)\nArchetypes:\n- Burn (damage)\n' },
    ])
    expect(facts.idea).toBe('Burn')
  })
})

describe('isBenchSite', () => {
  it('accepts the three representative sites and nothing else', () => {
    expect(isBenchSite('chat.generate')).toBe(true)
    expect(isBenchSite('suggestCombos')).toBe(true)
    expect(isBenchSite('fillSection')).toBe(true)
    expect(isBenchSite('chat.classify')).toBe(false)
    expect(isBenchSite('chatStrategyParse')).toBe(false)
  })
})

describe('benchFirstCandidates', () => {
  it('is the bench-first six with DeepSeek on json_object and pinned', () => {
    const six = benchFirstCandidates('fillSection')
    expect(six.map((c) => c.model)).toEqual([
      'openai/gpt-5.6-luna',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4.5',
      'inception/mercury-2',
      'meta/muse-spark-1.2',
      'deepseek/deepseek-v4-flash',
    ])
    const deepseek = six[5]
    expect(deepseek.structured).toBe('json_object')
    expect(deepseek.provider).toBe('deepseek')
    expect(six.every((c) => c.maxTokens === 2048)).toBe(true)
  })

  it('gives a deck site a larger token budget than a mechanical site', () => {
    expect(benchFirstCandidates('chat.generate')[0].maxTokens).toBeGreaterThan(benchFirstCandidates('fillSection')[0].maxTokens)
  })
})

describe('blindLabels', () => {
  const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']

  it('labels every run once, A through F', () => {
    const labels = blindLabels(ids, 'batch-1')
    expect(new Set(labels.values())).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F']))
  })

  it('is stable for a batch and different across batches', () => {
    const a = blindLabels(ids, 'batch-1')
    const b = blindLabels(ids, 'batch-1')
    expect([...a.entries()]).toEqual([...b.entries()])
    const seeds = ['s1', 's2', 's3', 's4', 's5']
    const orders = new Set(seeds.map((s) => ids.map((id) => blindLabels(ids, s).get(id)).join('')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('does not follow candidate order', () => {
    const seeds = Array.from({ length: 8 }, (_, i) => `seed-${i}`)
    const inOrder = seeds.filter((s) => ids.map((id) => blindLabels(ids, s).get(id)).join('') === 'ABCDEF')
    expect(inOrder.length).toBeLessThan(seeds.length)
  })
})
