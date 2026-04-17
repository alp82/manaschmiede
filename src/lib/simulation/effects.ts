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

const PATTERNS: Pattern[] = [
  {
    re: /draw (a|\d+) cards?/i,
    action: (m) => ({ type: 'draw', count: m[1].toLowerCase() === 'a' ? 1 : parseInt(m[1], 10) }),
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
    re: /creates? (?:(\d+) )?(\d+)\/(\d+).*tokens?/i,
    action: (m) => ({
      type: 'create_token',
      count: m[1] ? parseInt(m[1], 10) : 1,
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
    }),
  },
  {
    re: /target player.*mills? (\d+)/i,
    action: (m) => ({ type: 'mill', count: parseInt(m[1], 10) }),
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
