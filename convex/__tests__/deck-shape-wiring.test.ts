import { describe, expect, it } from 'vitest'
import {
  DECK_SHAPE_PROMPT_RULES,
  DEFAULT_LAND_COUNT,
  MAX_COPIES,
  TARGET_DECK_SIZE,
} from '../lib/deckRules'
import { DELTA_SYSTEM_PROMPT } from '../lib/deltaPrompt'
import { SECTION_FILL_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../generateDeck'

/**
 * `deckRules.ts` is the single source of truth for the shape of a deck, and the
 * prompt is one of its three adapters (issue #45). This pins the wiring: the
 * generator prompt carries the rendered block rather than a hand-written copy
 * of the same numbers.
 */

describe('DECK_SHAPE_PROMPT_RULES wiring', () => {
  it('SYSTEM_PROMPT carries the rendered shape rules', () => {
    expect(SYSTEM_PROMPT).toContain(DECK_SHAPE_PROMPT_RULES)
  })

  it.each([
    ['SECTION_FILL_SYSTEM_PROMPT', SECTION_FILL_SYSTEM_PROMPT],
    ['DELTA_SYSTEM_PROMPT', DELTA_SYSTEM_PROMPT],
  ])('%s does not, because it shapes one section or one swap, not a deck', (_name, prompt) => {
    expect(prompt).not.toContain(DECK_SHAPE_PROMPT_RULES)
  })

  it('states the deck size and copy limit from the constants', () => {
    expect(SYSTEM_PROMPT).toContain(`exactly ${TARGET_DECK_SIZE} cards`)
    expect(SYSTEM_PROMPT).toContain(`Maximum ${MAX_COPIES} copies`)
    expect(SYSTEM_PROMPT).toContain(
      `${DEFAULT_LAND_COUNT} lands + ${TARGET_DECK_SIZE - DEFAULT_LAND_COUNT} non-lands`,
    )
  })

  it('no longer names a land count the rules do not set', () => {
    // The old prose said "22-26 lands (aggro 22, midrange 24, control 25-26)",
    // whose 25-26 matched nothing in the table.
    expect(SYSTEM_PROMPT).not.toContain('control 25-26')
  })
})
