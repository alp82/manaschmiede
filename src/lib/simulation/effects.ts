import type { CardEffect, CardType, EffectAction, EffectTrigger } from './types'

function defaultTrigger(cardType: CardType): EffectTrigger {
  if (cardType === 'creature') return 'etb'
  if (cardType === 'instant' || cardType === 'sorcery') return 'cast'
  return 'cast'
}

interface Pattern {
  re: RegExp
  action: (m: RegExpMatchArray) => EffectAction
  trigger?: (cardType: CardType, text: string) => EffectTrigger
}

/**
 * Wizards spells out how many objects an effect touches - cards, tokens - as a
 * word, and prints only measured values - power, toughness, damage, life - as
 * digits. A count group that accepts digits alone therefore never matches a
 * real card, which is why `create_token` and `mill` used to be blanks.
 */
const WORD_COUNTS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
}

/**
 * Matches either notation. Interpolate into a pattern, read the group with
 * `toCount`. The trailing `\b` matters: without it `seven` matches the front of
 * `seventeen` and the count comes out as 7.
 */
const COUNT = `(\\d+|${Object.keys(WORD_COUNTS).join('|')})\\b`

function toCount(raw: string | undefined): number {
  if (!raw) return 1
  return WORD_COUNTS[raw.toLowerCase()] ?? parseInt(raw, 10)
}

const PATTERNS: Pattern[] = [
  {
    re: new RegExp(`\\bdraw ${COUNT} cards?`, 'i'),
    action: (m) => ({ type: 'draw', count: toCount(m[1]) }),
  },
  {
    re: /you gain (\d+) life/i,
    action: (m) => ({ type: 'gain_life', amount: parseInt(m[1], 10) }),
  },
  {
    re: /deals? (\d+) damage to (?:target|any|each opponent)/i,
    action: (m) => ({ type: 'damage', target: 'opponent', amount: parseInt(m[1], 10) }),
  },
  {
    re: /destroy target creature/i,
    action: () => ({ type: 'destroy', target: 'creature' }),
  },
  {
    re: /destroy target (?:permanent|nonland permanent)/i,
    action: () => ({ type: 'destroy', target: 'any' }),
  },
  {
    re: new RegExp(`creates? (?:${COUNT} )?(\\d+)\\/(\\d+).*tokens?`, 'i'),
    action: (m) => ({
      type: 'create_token',
      count: toCount(m[1]),
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
    }),
  },
  {
    re: new RegExp(`target player[^.]*mills? ${COUNT}`, 'i'),
    action: (m) => ({ type: 'mill', count: toCount(m[1]) }),
  },
  {
    re: /search your library for a (?:basic )?land/i,
    action: () => ({ type: 'ramp', count: 1 }),
  },
  {
    re: /return target creature to its owner's hand/i,
    action: () => ({ type: 'bounce', target: 'creature' }),
  },
  {
    re: /gets? \+(\d+)\/\+(\d+) until end of turn/i,
    action: (m) => ({
      type: 'pump',
      power: parseInt(m[1], 10),
      toughness: parseInt(m[2], 10),
      target: 'self',
    }),
  },
  {
    re: /creatures you control get \+(\d+)\/\+(\d+)/i,
    action: (m) => ({
      type: 'pump',
      power: parseInt(m[1], 10),
      toughness: parseInt(m[2], 10),
      target: 'team',
    }),
    trigger: () => 'static',
  },
  {
    re: /each opponent loses (\d+) life/i,
    action: (m) => ({ type: 'lose_life', target: 'opponent', amount: parseInt(m[1], 10) }),
  },
]

export function parseEffects(oracleText: string, cardType: CardType): CardEffect[] {
  if (!oracleText) return []

  const effects: CardEffect[] = []

  for (const pattern of PATTERNS) {
    const match = oracleText.match(pattern.re)
    if (match) {
      const trigger = pattern.trigger
        ? pattern.trigger(cardType, oracleText)
        : defaultTrigger(cardType)
      effects.push({ trigger, action: pattern.action(match) })
    }
  }

  return effects
}
