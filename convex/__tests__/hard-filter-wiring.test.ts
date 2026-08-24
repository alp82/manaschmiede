import { describe, expect, it } from 'vitest'
import {
  EXCLUDED_SET_TYPES,
  EXCLUDED_TYPES,
  HARD_FILTER_PROMPT_RULES,
  HARD_FILTER_SCRYFALL_QUERY,
} from '../lib/cardFilters'
import { DELTA_SYSTEM_PROMPT } from '../lib/deltaPrompt'
import {
  INTENT_CLASSIFIER_PROMPT,
  QUESTION_SYSTEM_PROMPT,
  SECTION_FILL_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from '../generateDeck'
import { getComboSystemPrompt } from '../suggestCombos'

/**
 * `cardFilters.ts` is the single source of truth for "is this a legal card in a
 * 60-card casual deck", and it exports one adapter per surface. These pin the
 * two adapters that had no call sites: the prompt block and the Scryfall
 * fragment.
 */

describe('HARD_FILTER_PROMPT_RULES wiring', () => {
  it.each([
    ['SYSTEM_PROMPT', SYSTEM_PROMPT],
    ['SECTION_FILL_SYSTEM_PROMPT', SECTION_FILL_SYSTEM_PROMPT],
    ['DELTA_SYSTEM_PROMPT', DELTA_SYSTEM_PROMPT],
    ['getComboSystemPrompt("en")', getComboSystemPrompt('en')],
    ['getComboSystemPrompt("de")', getComboSystemPrompt('de')],
  ])('%s carries the hard-filter rules', (_name, prompt) => {
    expect(prompt).toContain(HARD_FILTER_PROMPT_RULES)
  })

  it.each([
    ['INTENT_CLASSIFIER_PROMPT', INTENT_CLASSIFIER_PROMPT],
    ['QUESTION_SYSTEM_PROMPT', QUESTION_SYSTEM_PROMPT],
  ])('%s does not, because it never emits card names', (_name, prompt) => {
    expect(prompt).not.toContain(HARD_FILTER_PROMPT_RULES)
  })
})

describe('HARD_FILTER_SCRYFALL_QUERY', () => {
  it('excludes every type and set type the module lists', () => {
    // Read off the exported constants, so a new exclusion that reaches
    // getHardFilterRejectionReason but not the query fragment fails here.
    for (const type of EXCLUDED_TYPES) {
      expect(HARD_FILTER_SCRYFALL_QUERY).toContain(`-t:${type}`)
    }
    for (const setType of EXCLUDED_SET_TYPES) {
      expect(HARD_FILTER_SCRYFALL_QUERY).toContain(`-st:${setType}`)
    }
    expect(HARD_FILTER_SCRYFALL_QUERY).toContain('-is:digital')
    expect(HARD_FILTER_SCRYFALL_QUERY).toContain('-is:oversized')
  })
})
