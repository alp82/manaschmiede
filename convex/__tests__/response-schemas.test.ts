import { describe, expect, it } from 'vitest'
import { COMBO_SCHEMA, DECK_SCHEMA, SECTION_SCHEMA, SITE_SCHEMAS, schemaSubsetViolations } from '../lib/responseSchemas'
import { parseComboResponse, parseDeckResponse, parseSectionResponse } from '../lib/responseShapes'

/**
 * Every site schema has to stay inside the subset all constrained-decoding
 * providers accept (#54), and a body that satisfies the schema has to
 * satisfy the site's own parser - the schema mirrors the prompt, it does not
 * replace the judge.
 */

describe('site schemas', () => {
  it.each(Object.entries(SITE_SCHEMAS))('%s stays inside the provider subset', (_site, { schema }) => {
    expect(schemaSubsetViolations(schema)).toEqual([])
  })

  it('a schema-shaped deck parses', () => {
    const deck = { name: 'Elves', description: 'Go wide', explanation: '', total: 60, cards: [{ name: 'Llanowar Elves', quantity: 4 }] }
    expect(parseDeckResponse(JSON.stringify(deck)).cards).toEqual(deck.cards)
  })

  it('a schema-shaped section parses', () => {
    const section = { cards: [{ name: 'Doom Blade', quantity: 2 }], explanation: 'removal' }
    expect(parseSectionResponse(JSON.stringify(section))).toEqual(section)
  })

  it('a schema-shaped combo list parses', () => {
    const combos = { combos: [{ name: 'Drain', cards: ['A', 'B'], explanation: 'why' }] }
    expect(parseComboResponse(JSON.stringify(combos))).toEqual(combos)
  })
})

describe('schemaSubsetViolations', () => {
  it('flags a constraint keyword, a missing required and open properties', () => {
    const bad = {
      type: 'object',
      properties: {
        quantity: { type: 'integer', minimum: 1 },
        cards: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', pattern: '.+' } }, required: ['name'] } },
      },
      required: ['quantity'],
      additionalProperties: false,
    }
    expect(schemaSubsetViolations(bad)).toEqual([
      '$: cards not required',
      '$.quantity: uses minimum',
      '$.cards[]: additionalProperties not false',
      '$.cards[].name: uses pattern',
    ])
  })

  it('accepts the three shipped schemas', () => {
    for (const schema of [DECK_SCHEMA, SECTION_SCHEMA, COMBO_SCHEMA]) expect(schemaSubsetViolations(schema)).toEqual([])
  })
})
