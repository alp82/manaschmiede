/**
 * The i18n contract, at runtime.
 *
 * `TranslationKey` is derived from `en.ts`, so the compiler already refuses a
 * `de.ts` that is missing a key or carries an extra one. These tests cover the
 * two things the type cannot: that the derivation still runs over the real
 * catalogs, and that `t`'s `?? key` fallback - which `localizeDeckSection`
 * reads as "no translation for this section" - keeps working.
 */
import { describe, it, expect } from 'vitest'
import { en } from '../i18n/en'
import { de } from '../i18n/de'
import { localizeDeckSection } from '../section-plan'
import type { DeckSection } from '../section-plan'
import type { TFn } from '../i18n/types'

describe('translation catalogs', () => {
  it('[R] carries the same keys in both locales', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  })

  it('[R] translates every key to a non-empty string', () => {
    for (const [key, value] of Object.entries(de)) {
      expect(value, key).not.toBe('')
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toBe('')
    }
  })

  it('[R] uses the same {placeholders} in both locales', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]))
    }
  })
})

describe('localizeDeckSection', () => {
  const section: DeckSection = {
    id: 'core-creatures',
    label: 'Stored Label',
    description: 'Stored description',
    targetCount: 12,
    role: 'creatures',
    scryfallHints: [],
  }

  it('[R] keeps the stored label when the catalog has no key for the section', () => {
    // `t` returning the key it was handed is how a missing translation reports
    // itself. A `t` that returned '' or threw instead would silently blank the
    // lane headers of every persisted deck.
    const missing: TFn = (key) => key

    const result = localizeDeckSection(section, missing)

    expect(result.label).toBe('Stored Label')
    expect(result.description).toBe('Stored description')
  })

  it('[R] takes the translation when the catalog has one', () => {
    const present: TFn = (key) =>
      key === 'section.core-creatures.label' ? 'Kreaturen' : 'Beschreibung'

    const result = localizeDeckSection(section, present)

    expect(result.label).toBe('Kreaturen')
    expect(result.description).toBe('Beschreibung')
  })

  it('[R] fills {tribe} from the persisted trait id', () => {
    const tribal: TFn = (key, params) =>
      key === 'trait.elves'
        ? 'Elves'
        : key === 'section.tribal-core.label'
          ? `${params?.tribe} Core`
          : key

    const result = localizeDeckSection(
      { ...section, id: 'tribal-core', tribalTraitId: 'elves' },
      tribal,
    )

    expect(result.label).toBe('Elves Core')
  })
})
