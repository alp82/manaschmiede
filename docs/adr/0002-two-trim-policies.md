# Deck-size enforcement has two trim policies, not one

Trimming an oversized deck to 60 takes a `trimPolicy` of `'rebuild'` or
`'delta'` rather than one fixed rule, because the two situations want opposite
things. A rebuild trims non-lands first, since the land count was computed
deliberately and `section-plan.ts` enforces a floor of 18. A delta trims basic
lands first, since the user asked for one swap and shedding a Forest beats
shedding a spell they never mentioned.

## Considered options

One winner for both paths. Rejected: each behaviour is pinned by a passing test
(`deck-diff.test.ts` `TC-EDS-02` asserts a Forest goes 2 to 1 on the delta
path), so unifying naively silently changes outcomes on whichever path loses.

## Consequences

- The flag is named for the situation, not the mechanic - `trimPolicy:
  'rebuild' | 'delta'`, not `trimBasicsFirst: boolean` - so the name says why.
- `'rebuild'` is the word for this everywhere. The chat intent classifier's
  `'change'` is renamed to match.
- Lock checking stays in `resolveRemoveIds`, not the enforcer. Deciding which
  cards a delta touches and deciding how big the deck is are separate jobs.
