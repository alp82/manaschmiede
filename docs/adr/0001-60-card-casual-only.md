# 60-card casual only

Manaschmiede builds 60-card casual decks and nothing else. The app briefly
shipped a Standard / Modern / Casual picker whose only real effect was a
Scryfall legality filter on the card pool; we removed it, along with
`DeckFormat`, `FORMAT_RULES`, and the sideboard zone, because a narrower pool
works against the product's first hard requirement - recommendations that
synergize and are fun to play.

## Consequences

- `card.legalities` is present in the Scryfall types and deliberately unread.
- A deck saved before this change with `format: 'standard'` silently becomes
  casual. The field is ignored on load rather than migrated.
- A deck is exactly 60 cards, not at least 60. The constant is named
  `TARGET_DECK_SIZE` so the name matches the rule.
