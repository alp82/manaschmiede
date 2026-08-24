import { describe, expect, it } from 'vitest'
import { ANY_OBJECT_PATTERN, parseJsonLadder } from '../lib/jsonLadder'

/**
 * The ladder every JSON-returning action shares. The rungs matter individually:
 * before each one guarded its own parse, a fence holding truncated JSON threw a
 * raw SyntaxError past the caller's error handling.
 */

describe('parseJsonLadder', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLadder('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON out of a ```json fence', () => {
    expect(parseJsonLadder('Here:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 })
  })

  it('parses JSON out of a bare fence', () => {
    expect(parseJsonLadder('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('leaves the third rung off unless a pattern is given', () => {
    expect(() => parseJsonLadder('Sure: {"a":1}')).toThrow(/Could not parse AI response as JSON/)
    expect(parseJsonLadder('Sure: {"a":1}', ANY_OBJECT_PATTERN)).toEqual({ a: 1 })
  })

  it('falls through a fence holding no JSON to the embedded rung', () => {
    expect(parseJsonLadder('```json\ntruncated\n```\n{"a":1}', ANY_OBJECT_PATTERN)).toEqual({
      a: 1,
    })
  })

  it('does not rescue a fence whose broken JSON the embedded pattern also spans', () => {
    // The embedded rung is greedy from the first brace, so it re-reads the
    // broken fence rather than skipping to the good object after it.
    expect(() =>
      parseJsonLadder('```json\n{"a":\n```\n{"a":1}', ANY_OBJECT_PATTERN),
    ).toThrow(/Could not parse AI response as JSON/)
  })

  it('throws rather than leaking a SyntaxError from the fence rung', () => {
    expect(() => parseJsonLadder('```json\n{"a":\n```')).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('throws rather than leaking a SyntaxError from the embedded rung', () => {
    expect(() => parseJsonLadder('Sure: {"a":', ANY_OBJECT_PATTERN)).toThrow(
      /Could not parse AI response as JSON/,
    )
  })

  it('honors an anchored embedded pattern', () => {
    const anchored = /\{[\s\S]*"cards"\s*:\s*\[[\s\S]*\][\s\S]*\}/
    expect(() => parseJsonLadder('prose {"other":1} prose', anchored)).toThrow(
      /Could not parse AI response as JSON/,
    )
    expect(parseJsonLadder('prose {"cards":[1]} prose', anchored)).toEqual({ cards: [1] })
  })

  it('throws on prose with no JSON at all', () => {
    expect(() => parseJsonLadder('I could not do that.', ANY_OBJECT_PATTERN)).toThrow(
      /Could not parse AI response as JSON/,
    )
  })
})
