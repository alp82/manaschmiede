import { describe, expect, it } from 'vitest'
import { parseComboResponse } from '../suggestCombos'

/**
 * Coverage for the combo parse ladder, extracted from the `suggestCombos`
 * action handler so it can be tested without a Convex runtime.
 */

const COMBO = '{"name":"Splinter Twin","cards":["Splinter Twin","Deceiver Exarch"],"explanation":"infinite copies"}'

describe('parseComboResponse', () => {
  it('parses a bare JSON object', () => {
    const result = parseComboResponse(`{"combos":[${COMBO}]}`)
    expect(result.combos).toHaveLength(1)
    expect(result.combos[0].name).toBe('Splinter Twin')
  })

  it('parses JSON out of a code fence', () => {
    const result = parseComboResponse('Here:\n```json\n{"combos":[' + COMBO + ']}\n```')
    expect(result.combos).toHaveLength(1)
  })

  it('drops combos with fewer than two cards or a missing explanation', () => {
    const result = parseComboResponse(
      '{"combos":[' +
        COMBO +
        ',{"name":"Lonely","cards":["Shock"],"explanation":"x"}' +
        ',{"name":"Mute","cards":["A","B"]}' +
        ']}',
    )
    expect(result.combos.map((c) => c.name)).toEqual(['Splinter Twin'])
  })

  it('reports a truncated code fence as an unparseable response', () => {
    expect(() => parseComboResponse('```json\n{"combos":[{"name":"Cut off"\n```')).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseComboResponse('I could not think of any combos.')).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('throws when the JSON has no combos array', () => {
    expect(() => parseComboResponse('{"explanation":"oops"}')).toThrow(/invalid format/)
  })
})
