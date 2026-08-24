import type { en } from './en'

export type Locale = 'de' | 'en'

/**
 * Every key the catalogs carry, derived from `en.ts` rather than listed.
 *
 * The hand-maintained list this replaced held 270 keys explicitly plus three
 * template-literal index signatures, and those signatures left 204 keys - every
 * `trait.*`, `trait.desc.*` and `section.*` - structurally unchecked in both
 * catalogs. Deriving from `en` closes that hole: a key exists exactly when
 * `en.ts` says it does.
 */
export type TranslationKey = keyof typeof en

/**
 * Keys built at runtime from a trait or section id, which the checker can only
 * see as a shape.
 *
 * These stay loose on purpose. Narrowing them needs `TRAITS` in the 681-line
 * `trait-mappings.ts` to become `as const` so `TraitId` is a real union, plus
 * the same treatment for section ids - a separate change. Until then a trait
 * key built from an id is accepted without the id itself being checked.
 */
export type DynamicKey =
  | `trait.${string}`
  | `trait.desc.${string}`
  | `section.${string}.label`
  | `section.${string}.desc`

/**
 * A complete catalog. `de.ts` is annotated with this, so a key added to `en.ts`
 * fails the German build until it is translated.
 */
export type Translations = Record<TranslationKey, string>

/**
 * The `t` function's shape.
 *
 * Modules that take `t` as a parameter import this rather than declaring their
 * own `(key: string) => string`: under `strictFunctionTypes` a narrowed `t` is
 * not assignable to a wider parameter, so a local alias would reject the real
 * `t` at the call site.
 */
export type TFn = (
  key: TranslationKey | DynamicKey,
  params?: Record<string, string | number>,
) => string
