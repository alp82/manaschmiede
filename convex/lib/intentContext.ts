/**
 * Shared deck-intent → prompt/query builders.
 *
 * The AI suggestion path has two entry points — `chat()` and `fillSection()` —
 * that must emit the IDENTICAL hard-constraint context block so off-color
 * drift is stopped the same way no matter which path runs. This module is the
 * single source of truth for that block plus the Scryfall color filter clause.
 *
 * Zero-dependency pure TypeScript so it can be imported from both convex/
 * (server actions) and src/ (tests / future client reuse), mirroring how
 * convex/lib/cardFilters.ts is shared.
 */

/**
 * Flat server-side shape of the deck intent that drives the prompt. This is
 * NOT the persisted DeckIntent (src/lib/deck-intent.ts) — colors here are an
 * already-resolved allowed-color array (committed colors, or the card-derived
 * fallback when committed is empty), and rarity is intentionally absent
 * because rarity is never sent to the prompt.
 */
export interface IntentContext {
  colors: string[]
  archetypes: string[]
  traits: string[]
  customStrategy?: string
  format?: string
  budgetMin?: number | null
  budgetMax?: number | null
}

/** Human-readable color names for the HARD CONSTRAINT line. */
export const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

/**
 * Build the `\n\nDECK CONTEXT:` block appended to the system prompt.
 *
 * Byte-identical to the inline block this replaced in fillSection so the two
 * AI paths can't drift (guarded by the byte-parity test in
 * src/lib/__tests__/intent-context.test.ts). Returns '' when there's nothing
 * to constrain — no colors, archetypes, traits, strategy, budget, or
 * non-casual format — so the prompt stays clean for unconstrained decks.
 */
export function buildIntentContextPrompt(ctx: IntentContext): string {
  let body = ''

  if (ctx.colors.length > 0) {
    const colorList = ctx.colors.map((c) => COLOR_NAMES[c] || c).join(', ')
    const colorCodes = ctx.colors.join('')
    body += `\nAllowed colors (HARD CONSTRAINT): ${colorList} [${colorCodes}]`
    body += `\nOnly suggest cards whose color identity is a subset of {${colorCodes}}. Anything outside this set - including multicolor cards that touch other colors - will be rejected.`
  }
  if (ctx.archetypes.length > 0) body += `\nArchetypes: ${ctx.archetypes.join(', ')}`
  if (ctx.traits.length > 0) body += `\nTraits: ${ctx.traits.join(', ')}`
  if (ctx.customStrategy) body += `\nStrategy: ${ctx.customStrategy}`
  if (ctx.format && ctx.format !== 'casual') body += `\nFormat: ${ctx.format}`
  if (ctx.budgetMin != null) body += `\nBudget: min $${ctx.budgetMin.toFixed(2)} per card`
  if (ctx.budgetMax != null) body += `\nBudget: max $${ctx.budgetMax.toFixed(2)} per card`

  return body === '' ? '' : `\n\nDECK CONTEXT:${body}`
}

/**
 * Scryfall color-identity filter clause for the card-pool query.
 * `['W','U'] -> ' c:wu'`, `[] -> ''`. Matches buildSectionCardPool's existing
 * clause so the chat() and fillSection() pools narrow identically.
 */
export function colorFilterClause(colors: string[]): string {
  return colors.length > 0 ? ` c:${colors.join('').toLowerCase()}` : ''
}

/**
 * Permissive castable-in (c<=) clause for STRATEGY queries — "playable in these
 * colors" — vs the strict c: identity colorFilterClause uses for trait/hint
 * scoping. Keeps the strategy pool broad; mirrors the StepCoreCards client
 * intent. `['W','U'] -> ' c<=wu'`, `[] -> ''`.
 */
export function colorCastableClause(colors: string[]): string {
  return colors.length > 0 ? ` c<=${colors.join('').toLowerCase()}` : ''
}
