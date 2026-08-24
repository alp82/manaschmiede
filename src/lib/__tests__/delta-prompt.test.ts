/**
 * RED tests — parseDeltaResponse does not exist yet.
 * It must be exported from convex/lib/deltaPrompt.ts.
 *
 * These tests will fail with "Cannot find module" until the implementer
 * creates that module. That is the intended red state.
 *
 * Asserted contract:
 *   - DeltaResult has { remove: Array<{name:string}>, add: Array<{name:string; quantity:number}>, explanation: string }
 *   - There is NO `op` field — op is derived downstream from which arrays are non-empty.
 *   - NEVER throws — any malformed/empty/null input returns a safe-empty result.
 *   - Ladder: JSON.parse -> fenced ```json -> bare ``` -> embedded-JSON-in-prose.
 *   - remove and add are each capped at <=3 entries.
 *   - Entries missing `name` are filtered out; valid siblings survive.
 */
import { describe, it, expect } from 'vitest'
import { parseDeltaResponse, buildDeltaUserMessage } from '../../../convex/lib/deltaPrompt'

// ─── Well-formed plain JSON ───────────────────────────────────────────────────

describe('parseDeltaResponse — well-formed plain JSON', () => {
  it('TC-DP-01: swap JSON (remove + add + explanation) -> exact fields', () => {
    const text = JSON.stringify({
      remove: [{ name: 'Lightning Bolt' }],
      add: [{ name: 'Shock', quantity: 1 }],
      explanation: 'Budget swap',
    })
    const result = parseDeltaResponse(text)
    expect(result.remove).toEqual([{ name: 'Lightning Bolt' }])
    expect(result.add).toEqual([{ name: 'Shock', quantity: 1 }])
    expect(result.explanation).toBe('Budget swap')
    // DeltaResult must NOT have an `op` field
    expect(result).not.toHaveProperty('op')
  })

  it('TC-DP-02: add-only (remove empty/absent) -> remove is [], add has 1 entry', () => {
    const text = JSON.stringify({
      remove: [],
      add: [{ name: 'Counterspell', quantity: 2 }],
      explanation: 'Add control',
    })
    const result = parseDeltaResponse(text)
    expect(result.remove).toEqual([])
    expect(result.add).toHaveLength(1)
    expect(result.add[0].name).toBe('Counterspell')
  })

  it('TC-DP-02b: add-only with remove key absent -> remove defaults to []', () => {
    const text = JSON.stringify({
      add: [{ name: 'Dark Ritual', quantity: 1 }],
      explanation: 'Speed boost',
    })
    const result = parseDeltaResponse(text)
    expect(result.remove).toEqual([])
    expect(result.add).toHaveLength(1)
  })

  it('TC-DP-03: remove-only (add empty/absent) -> add is [], remove has 1 entry', () => {
    const text = JSON.stringify({
      remove: [{ name: 'Craw Wurm' }],
      add: [],
      explanation: 'Cut deadweight',
    })
    const result = parseDeltaResponse(text)
    expect(result.add).toEqual([])
    expect(result.remove).toHaveLength(1)
    expect(result.remove[0].name).toBe('Craw Wurm')
  })

  it('TC-DP-03b: remove-only with add key absent -> add defaults to []', () => {
    const text = JSON.stringify({
      remove: [{ name: 'Vanilla Creature' }],
      explanation: 'Trim',
    })
    const result = parseDeltaResponse(text)
    expect(result.add).toEqual([])
    expect(result.remove).toHaveLength(1)
  })
})

// ─── Fence fallbacks ──────────────────────────────────────────────────────────

describe('parseDeltaResponse — fenced fallbacks', () => {
  it('TC-DP-04: fenced ```json ... ``` -> parsed correctly', () => {
    const inner = JSON.stringify({
      remove: [{ name: 'Grizzly Bears' }],
      add: [{ name: 'Llanowar Elves', quantity: 1 }],
      explanation: 'Upgrade beater',
    })
    const text = `Here is my suggestion:\n\`\`\`json\n${inner}\n\`\`\``
    const result = parseDeltaResponse(text)
    expect(result.remove).toEqual([{ name: 'Grizzly Bears' }])
    expect(result.add[0].name).toBe('Llanowar Elves')
  })

  it('TC-DP-05: bare ``` ... ``` fence (no language tag) -> parsed correctly', () => {
    const inner = JSON.stringify({
      remove: [],
      add: [{ name: 'Sol Ring', quantity: 1 }],
      explanation: 'Ramp',
    })
    const text = `\`\`\`\n${inner}\n\`\`\``
    const result = parseDeltaResponse(text)
    expect(result.add[0].name).toBe('Sol Ring')
    expect(result.remove).toEqual([])
  })
})

// ─── Embedded-JSON-in-prose fallback ─────────────────────────────────────────

describe('parseDeltaResponse — embedded JSON in prose fallback', () => {
  it('TC-DP-06: JSON object embedded in surrounding prose text -> extracted and parsed', () => {
    const inner = JSON.stringify({
      remove: [{ name: 'Mountain' }],
      add: [{ name: 'Stomping Ground', quantity: 1 }],
      explanation: 'Upgrade mana base',
    })
    const text = `I recommend the following change: ${inner} Hope that helps!`
    const result = parseDeltaResponse(text)
    expect(result.remove[0].name).toBe('Mountain')
    expect(result.add[0].name).toBe('Stomping Ground')
  })
})

// ─── Never-throw / safe-empty ─────────────────────────────────────────────────

describe('parseDeltaResponse — never throws, returns safe-empty on bad input', () => {
  it('TC-DP-07: malformed JSON string -> no throw, safe-empty', () => {
    expect(() => parseDeltaResponse('{"remove":[broken')).not.toThrow()
    const result = parseDeltaResponse('{"remove":[broken')
    expect(result.remove).toEqual([])
    expect(result.add).toEqual([])
    expect(typeof result.explanation).toBe('string')
  })

  it('TC-DP-08: empty string "" -> no throw, safe-empty', () => {
    expect(() => parseDeltaResponse('')).not.toThrow()
    const result = parseDeltaResponse('')
    expect(result.remove).toEqual([])
    expect(result.add).toEqual([])
  })

  it('TC-DP-09: prose only, no JSON -> no throw, safe-empty', () => {
    expect(() => parseDeltaResponse('Sure, I can help you with that!')).not.toThrow()
    const result = parseDeltaResponse('Sure, I can help you with that!')
    expect(result.remove).toEqual([])
    expect(result.add).toEqual([])
  })

  it('TC-DP-10: null cast to string (passing null as unknown) -> no throw, safe-empty', () => {
    expect(() => parseDeltaResponse(null as unknown as string)).not.toThrow()
    const result = parseDeltaResponse(null as unknown as string)
    expect(result.remove).toEqual([])
    expect(result.add).toEqual([])
  })
})

// ─── Cap at <=3 entries ───────────────────────────────────────────────────────

describe('parseDeltaResponse — caps remove and add at 3 entries each', () => {
  it('TC-DP-11: >3 remove and >3 add entries -> each array capped to length <=3', () => {
    const text = JSON.stringify({
      remove: [
        { name: 'A' },
        { name: 'B' },
        { name: 'C' },
        { name: 'D' },
        { name: 'E' },
      ],
      add: [
        { name: 'V', quantity: 1 },
        { name: 'W', quantity: 1 },
        { name: 'X', quantity: 1 },
        { name: 'Y', quantity: 1 },
        { name: 'Z', quantity: 1 },
      ],
      explanation: 'Overloaded',
    })
    const result = parseDeltaResponse(text)
    expect(result.remove.length).toBeLessThanOrEqual(3)
    expect(result.add.length).toBeLessThanOrEqual(3)
  })
})

// ─── Filter entries missing `name` ───────────────────────────────────────────

describe('parseDeltaResponse — filters entries missing name', () => {
  it('TC-DP-12: entry missing name is filtered out; valid siblings survive', () => {
    const text = JSON.stringify({
      remove: [
        { quantity: 2 }, // no name — must be filtered
        { name: 'Giant Growth' },
      ],
      add: [
        { name: 'Rampant Growth', quantity: 1 },
        { reason: 'weird object' }, // no name — must be filtered
      ],
      explanation: 'Mixed',
    })
    const result = parseDeltaResponse(text)
    // The nameless entries must be gone
    expect(result.remove.every((e) => typeof e.name === 'string')).toBe(true)
    expect(result.add.every((e) => typeof e.name === 'string')).toBe(true)
    // Valid siblings survive
    expect(result.remove.some((e) => e.name === 'Giant Growth')).toBe(true)
    expect(result.add.some((e) => e.name === 'Rampant Growth')).toBe(true)
  })
})

// ─── buildDeltaUserMessage ────────────────────────────────────────────────────
//
// The per-op hint text is load-bearing: it nudges the model toward the right
// JSON shape for each operation type and explicitly warns away from the wrong
// shape (e.g. pure removals should not produce bidirectional edits).

describe('buildDeltaUserMessage', () => {
  it('TC-BDU-01: op "add" -> message contains ADD hint and the user request text', () => {
    const result = buildDeltaUserMessage('add', 'add 2 Counterspell')
    // Must mention ADD explicitly
    expect(result.toUpperCase()).toContain('ADD')
    // Must embed the verbatim user request
    expect(result).toContain('add 2 Counterspell')
  })

  it('TC-BDU-02: op "remove" -> message contains REMOVE hint and the user request text', () => {
    const result = buildDeltaUserMessage('remove', 'cut Craw Wurm')
    // Must mention REMOVE explicitly
    expect(result.toUpperCase()).toContain('REMOVE')
    // Must embed the verbatim user request
    expect(result).toContain('cut Craw Wurm')
  })

  it('TC-BDU-03: op "swap" -> message contains SWAP hint and the user request text', () => {
    const result = buildDeltaUserMessage('swap', 'swap Lightning Bolt for Shock')
    // Must mention SWAP explicitly
    expect(result.toUpperCase()).toContain('SWAP')
    // Must embed the verbatim user request
    expect(result).toContain('swap Lightning Bolt for Shock')
  })

  it('TC-BDU-04: op hints are distinct - add/remove/swap produce three different strings', () => {
    const userText = 'do the thing'
    const addMsg = buildDeltaUserMessage('add', userText)
    const removeMsg = buildDeltaUserMessage('remove', userText)
    const swapMsg = buildDeltaUserMessage('swap', userText)
    // All three are distinct (different hint texts)
    expect(addMsg).not.toBe(removeMsg)
    expect(removeMsg).not.toBe(swapMsg)
    expect(addMsg).not.toBe(swapMsg)
  })
})

// ─── Quantity handling ────────────────────────────────────────────────────────
//
// The delta path SUBSTITUTES one copy for a missing or invalid quantity where
// the deck and section parsers DROP the entry. The named card is the point of a
// delta edit; the count is incidental.

describe('parseDeltaResponse — quantity defaults to 1 rather than dropping the entry', () => {
  it('TC-DP-13: an add entry with no quantity survives as one copy', () => {
    const result = parseDeltaResponse(JSON.stringify({ add: [{ name: 'Shock' }] }))
    expect(result.add).toEqual([{ name: 'Shock', quantity: 1 }])
  })

  it('TC-DP-14: a non-positive or non-numeric quantity becomes one copy', () => {
    const result = parseDeltaResponse(
      JSON.stringify({ add: [{ name: 'A', quantity: 0 }, { name: 'B', quantity: 'four' }] }),
    )
    expect(result.add).toEqual([
      { name: 'A', quantity: 1 },
      { name: 'B', quantity: 1 },
    ])
  })

  it('TC-DP-15: quantities are NOT clamped to the 4-copy rule', () => {
    const result = parseDeltaResponse(JSON.stringify({ add: [{ name: 'Shock', quantity: 9 }] }))
    expect(result.add).toEqual([{ name: 'Shock', quantity: 9 }])
  })
})
