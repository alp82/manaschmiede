/**
 * RED tests — buildIntentContextPrompt and colorFilterClause do not exist yet.
 * They must be exported from convex/lib/intentContext.ts.
 *
 * Import path: relative to this file's location in src/lib/__tests__/,
 * the convex module is at ../../../convex/lib/intentContext.
 * This mirrors how src/lib/card-validation.ts imports from ../../convex/lib/cardFilters.
 *
 * Asserted signatures:
 *
 *   interface IntentContext {
 *     colors: string[]
 *     archetypes: string[]
 *     traits: string[]
 *     customStrategy?: string
 *     budgetMin?: number | null
 *     budgetMax?: number | null
 *   }
 *
 *   buildIntentContextPrompt(ctx: IntentContext): string
 *   colorFilterClause(colors: string[]): string
 *
 * NOT unit-testable (noted here, not written):
 *   - legacy-deck panel pre-seed (manual UI)
 *   - inert-edit behavior (manual UI)
 *   - addCard-does-not-consult-gate (structural/code-review)
 */
import { describe, it, expect } from 'vitest'
import {
  buildIntentContextPrompt,
  colorFilterClause,
} from '../../../convex/lib/intentContext'

// ─── colorFilterClause ────────────────────────────────────────────────────

describe('colorFilterClause', () => {
  it("['W','U'] -> ' c:wu'", () => {
    expect(colorFilterClause(['W', 'U'])).toBe(' c:wu')
  })

  it("['R'] -> ' c:r'", () => {
    expect(colorFilterClause(['R'])).toBe(' c:r')
  })

  it('[] -> empty string', () => {
    expect(colorFilterClause([])).toBe('')
  })

  it("['W','U','B','R','G'] -> ' c:wubrg'", () => {
    expect(colorFilterClause(['W', 'U', 'B', 'R', 'G'])).toBe(' c:wubrg')
  })
})

// ─── buildIntentContextPrompt — basic structure ───────────────────────────

describe('buildIntentContextPrompt — structural checks', () => {
  it("starts with '\\n\\nDECK CONTEXT:' when colors are present", () => {
    const result = buildIntentContextPrompt({
      colors: ['W', 'U'],
      archetypes: [],
      traits: [],
    })
    expect(result.startsWith('\n\nDECK CONTEXT:')).toBe(true)
  })

  it('contains HARD CONSTRAINT line when colors non-empty', () => {
    const result = buildIntentContextPrompt({
      colors: ['W', 'U'],
      archetypes: [],
      traits: [],
    })
    expect(result).toContain('Allowed colors (HARD CONSTRAINT):')
  })

  it('contains will be rejected line when colors non-empty', () => {
    const result = buildIntentContextPrompt({
      colors: ['W', 'U'],
      archetypes: [],
      traits: [],
    })
    expect(result).toContain('will be rejected')
  })

  it('contains [WU] style color codes when colors are W and U', () => {
    const result = buildIntentContextPrompt({
      colors: ['W', 'U'],
      archetypes: [],
      traits: [],
    })
    expect(result).toContain('[WU]')
  })

  it('contains subset of {WU} constraint text', () => {
    const result = buildIntentContextPrompt({
      colors: ['W', 'U'],
      archetypes: [],
      traits: [],
    })
    expect(result).toContain('subset of {WU}')
  })
})

// ─── buildIntentContextPrompt — returns empty string ─────────────────────

describe('buildIntentContextPrompt — empty return', () => {
  it('returns empty string when colors empty AND archetypes/traits/strategy/budget all empty', () => {
    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: [],
      traits: [],
    })
    expect(result).toBe('')
  })

  it('returns empty string with all explicit empty/null/undefined', () => {
    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: [],
      traits: [],
      customStrategy: '',
      budgetMin: null,
      budgetMax: null,
    })
    expect(result).toBe('')
  })
})

// ─── buildIntentContextPrompt — archetypes / traits / strategy ───────────

describe('buildIntentContextPrompt — archetypes, traits, strategy', () => {
  it('archetypes set with empty colors -> non-empty, contains Archetypes: line', () => {
    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: ['aggro', 'burn'],
      traits: [],
    })
    expect(result).not.toBe('')
    expect(result).toContain('Archetypes:')
    expect(result).toContain('aggro')
    expect(result).toContain('burn')
  })

  it('traits set -> contains Traits: line', () => {
    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: [],
      traits: ['tribal', 'synergy'],
    })
    expect(result).toContain('Traits:')
    expect(result).toContain('tribal')
  })

  it('customStrategy set -> contains the strategy text', () => {
    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: [],
      traits: [],
      customStrategy: 'Swarm with cheap creatures',
    })
    expect(result).toContain('Swarm with cheap creatures')
    expect(result).toContain('Strategy:')
  })

  it('archetypes line not present when archetypes empty', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
    })
    expect(result).not.toContain('Archetypes:')
  })

  it('traits line not present when traits empty', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
    })
    expect(result).not.toContain('Traits:')
  })

  it('strategy line not present when customStrategy empty/undefined', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
    })
    expect(result).not.toContain('Strategy:')
  })
})

// ─── buildIntentContextPrompt — budget ───────────────────────────────────

describe('buildIntentContextPrompt — budget', () => {
  it('budgetMax 2.0 -> contains "max $2.00"', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
      budgetMax: 2.0,
    })
    expect(result).toContain('max $2.00')
  })

  it('budgetMin null -> NO min line in output', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
      budgetMin: null,
      budgetMax: 2.0,
    })
    expect(result).not.toContain('min $')
  })

  it('budgetMin 0.5 set -> contains "min $0.50"', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
      budgetMin: 0.5,
      budgetMax: 5.0,
    })
    expect(result).toContain('min $0.50')
  })

  it('budgetMin set without budgetMax -> min line present, no max line', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: [],
      traits: [],
      budgetMin: 0.25,
    })
    expect(result).toContain('min $0.25')
    expect(result).not.toContain('max $')
  })
})

// ─── buildIntentContextPrompt — no format concept ────────────────────────
//
// The app is 60-card casual only (docs/adr/0001-60-card-casual-only.md), so
// IntentContext carries no format and the prompt must never emit a Format
// line — not even from a deck saved before the concept was deleted.

describe('buildIntentContextPrompt — no format line', () => {
  it('never emits a Format line, whatever else is set', () => {
    const result = buildIntentContextPrompt({
      colors: ['W'],
      archetypes: ['aggro'],
      traits: ['tribal'],
      customStrategy: 'Go wide',
      budgetMin: 0.25,
      budgetMax: 2.5,
    })
    expect(result).not.toContain('Format:')
  })
})

// ─── BYTE-PARITY (B4 guard) ───────────────────────────────────────────────
//
// This test pins the extraction contract: buildIntentContextPrompt called with
// fillSection's exact input shape must reproduce the EXACT string that the
// inline block in convex/generateDeck.ts:644-659 produces.
//
// Reference block (verbatim from generateDeck.ts lines 648-659):
//
//   systemPrompt += `\n\nDECK CONTEXT:`
//   if (args.colors.length > 0) {
//     const colorList = args.colors.map((c) => colorNames[c] || c).join(', ')
//     const colorCodes = args.colors.join('')
//     systemPrompt += `\nAllowed colors (HARD CONSTRAINT): ${colorList} [${colorCodes}]`
//     systemPrompt += `\nOnly suggest cards whose color identity is a subset of {${colorCodes}}. Anything outside this set - including multicolor cards that touch other colors - will be rejected.`
//   }
//   if (args.archetypes.length > 0) systemPrompt += `\nArchetypes: ${args.archetypes.join(', ')}`
//   if (args.traits.length > 0) systemPrompt += `\nTraits: ${args.traits.join(', ')}`
//   if (args.customStrategy) systemPrompt += `\nStrategy: ${args.customStrategy}`
//   if (args.budgetLimit != null) systemPrompt += `\nBudget: max $${args.budgetLimit.toFixed(2)} per card`
//
// NOTE: The inline code uses `args.budgetLimit` (single field, max only).
// The extracted buildIntentContextPrompt takes separate budgetMax/budgetMin.
// The parity test uses only budgetMax (= budgetLimit) and no budgetMin,
// matching the inline shape precisely.

describe('buildIntentContextPrompt — BYTE-PARITY B4 guard', () => {
  it('reproduces the exact inline fillSection string for a known input', () => {
    // Input: colors=['W','U'], archetypes=['aggro'], traits=['tribal'],
    //        customStrategy='Go wide', budgetMax=2.50
    // (no budgetMin — matches the inline shape which has no min concept)
    const args = {
      colors: ['W', 'U'],
      archetypes: ['aggro'],
      traits: ['tribal'],
      customStrategy: 'Go wide',
      budgetMax: 2.50,
    }

    // Reconstruct the exact string the inline block produces:
    const colorNames: Record<string, string> = {
      W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
    }
    let expected = ''
    expected += '\n\nDECK CONTEXT:'
    const colorList = args.colors.map((c) => colorNames[c] || c).join(', ')
    const colorCodes = args.colors.join('')
    expected += `\nAllowed colors (HARD CONSTRAINT): ${colorList} [${colorCodes}]`
    expected += `\nOnly suggest cards whose color identity is a subset of {${colorCodes}}. Anything outside this set - including multicolor cards that touch other colors - will be rejected.`
    expected += `\nArchetypes: ${args.archetypes.join(', ')}`
    expected += `\nTraits: ${args.traits.join(', ')}`
    expected += `\nStrategy: ${args.customStrategy}`
    expected += `\nBudget: max $${args.budgetMax.toFixed(2)} per card`

    // The extracted function must produce the identical string.
    const result = buildIntentContextPrompt({
      colors: args.colors,
      archetypes: args.archetypes,
      traits: args.traits,
      customStrategy: args.customStrategy,
      budgetMax: args.budgetMax,
    })

    expect(result).toBe(expected)
  })

  it('parity: no colors, one archetype only — matches inline conditional output', () => {
    // When colors is empty the inline block emits nothing for colors,
    // then falls through to archetypes/traits/strategy/budget.
    const expected =
      '\n\nDECK CONTEXT:' +
      '\nArchetypes: midrange'

    const result = buildIntentContextPrompt({
      colors: [],
      archetypes: ['midrange'],
      traits: [],
    })

    expect(result).toBe(expected)
  })

  it('parity: colors only — the whole block is the color constraint', () => {
    const args = { colors: ['R'], archetypes: [], traits: [] }
    const colorNames: Record<string, string> = {
      W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
    }
    let expected = '\n\nDECK CONTEXT:'
    const colorList = args.colors.map((c) => colorNames[c] || c).join(', ')
    const colorCodes = args.colors.join('')
    expected += `\nAllowed colors (HARD CONSTRAINT): ${colorList} [${colorCodes}]`
    expected += `\nOnly suggest cards whose color identity is a subset of {${colorCodes}}. Anything outside this set - including multicolor cards that touch other colors - will be rejected.`

    const result = buildIntentContextPrompt({
      colors: args.colors,
      archetypes: [],
      traits: [],
    })

    expect(result).toBe(expected)
  })
})
