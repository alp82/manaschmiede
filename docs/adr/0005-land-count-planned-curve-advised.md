# The land count is planned, the mana curve is only advised

"Decks are balanced" is a hard requirement, and the curve half of it was written
three times and enforced nowhere (issue #45): as prose in `generateDeck.ts`'s
`SYSTEM_PROMPT`, as reporting thresholds in `src/lib/balance.ts`, and as a
per-archetype land table plus a bare floor of 18 in `src/lib/section-plan.ts`.
Only the last of the three ever changed an outcome, and none of them referenced
the others.

Deck size took the opposite treatment in ADR-0001 and ADR-0002: it is forced
programmatically, because the model cannot be trusted to count and padding with
basic lands is always a safe correction. The curve does not get the same
treatment, because there is no safe mechanical correction.

## The decision

**The land count is planned.** `deriveSectionPlan` allocates the slots from a
per-archetype target before the model sees the deck, so the land count is
decided by the plan rather than checked after the fact. Every archetype target
sits inside `LAND_COUNT_RANGE`, and reserving that budget before the spell
sections are distributed is what holds the band.

The band yields to the deck size, not the other way round. A core crowded
enough that the spell sections plus the band exceed 60 takes the land count
down with it, because a plan that isn't 60 cards isn't a plan (ADR-0001). The
residual land section absorbs the mismatch and never overrides it.

**The mana curve is advised.** Bringing a curve down means swapping specific
cards for cheaper ones that do the same job. A mechanical enforcer could only
delete the deck's most expensive cards, which are usually its payoffs, so
enforcing the curve would trade one hard requirement ("decks are balanced")
against another ("great to play"). The curve stays a prompt rule the model is
told to hit plus a warning in the balance report.

**One rule set, three adapters.** `LAND_COUNT_RANGE`,
`ARCHETYPE_LAND_COUNT` and `MAX_AVERAGE_MANA_VALUE` live in
`convex/lib/deckRules.ts` and are adapted in that same file, the way
`cardFilters.ts` adapts the hard filter:

| Adapter | Consumer |
|---|---|
| `DECK_SHAPE_PROMPT_RULES` | `SYSTEM_PROMPT` in `convex/generateDeck.ts` |
| `checkLandCount`, `isAverageManaValueTooHigh` | `src/lib/balance.ts` |
| `LAND_COUNT_RANGE`, `SPELL_COUNT_RANGE`, `MAX_AVERAGE_MANA_VALUE` | the stat targets in `src/components/BalanceAdvisor.tsx` |
| `landCountForArchetype`, `fixingLandCountForColors` | `deriveSectionPlan` in `src/lib/section-plan.ts` |

## Considered options

**Enforce the curve like the deck size.** Rejected for the reason above: the
only mechanical correction available makes the deck worse.

**Leave the land count advisory too, and only reconcile the numbers.** Rejected
because the section plan already decides it - the plan allocates the slots, so
pretending the land count is advice would describe the code inaccurately.

**Keep the archetype table in `section-plan.ts` and have the prompt import it.**
Rejected because `section-plan.ts` is not dependency-free (it takes `t` and
imports the trait tables), so `convex/generateDeck.ts` cannot reach it. Shared
rules live in `convex/lib/`.

## Consequences

- `SectionTemplate` no longer carries a `landCount`. The number comes from
  `landCountForArchetype(primary)`, so a template and the prompt cannot disagree.
- Land-role sections come out of the land budget rather than the spell budget.
  Previously goodstuff's own `mana-fixing-lands` section was paid for out of the
  spell slots, which is why its land target read 18 - a number that matched
  nothing else in the app. It now reads 25, its real total.
- Fixing lands scale with color count for every archetype, goodstuff included.
  A mono-color deck gets no fixing section at all.
- A five-color deck now lands on its archetype's target instead of drifting to
  the top of the band, because the generic fixing section no longer adds on top
  of the land budget.
- The bare floor of 18 is gone, and nothing replaced it. It was the only reason
  `deriveSectionPlan` could return a 62- or 68-card plan: once a crowded core
  squeezed the spell sections, the floor won over the arithmetic that makes the
  plan add up. The plan is now exactly 60 for every archetype at every core size
  up to 40, which it was not before this change.
- `SPELL_COUNT_RANGE` is derived from the land band rather than written down.
  `BalanceAdvisor` used to print `22-26` and `34-38` as literal strings — the
  fourth and fifth copies of the rule, in the UI.
- `ARCHETYPE_LAND_COUNT` is keyed by the archetype ids in `section-plan.ts`, and
  an id it does not list takes `DEFAULT_LAND_COUNT`. Adding an archetype is not
  a breaking change, but its land target belongs in the table.
