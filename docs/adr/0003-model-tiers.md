# Two model tiers, and which calls earn the quality one

The app calls Anthropic on two tiers, named by role in `convex/lib/anthropic.ts`:

- `MODELS.main` (`claude-sonnet-5`) — whole-deck generation (`chat.generate`)
  and combo suggestion.
- `MODELS.fast` (`claude-haiku-4-5-20251001`) — intent classification, strategy
  parsing, delta edits, chat questions, and section fill.

The split is by what the call decides. Generation and combo suggestion decide
what belongs in a deck and how cards interact, which is AGENTS.md's first hard
requirement: *"Great recommendations that synergize and are fun to play."* The
rest route, classify, or fill a named slot against a card pool that is already
narrowed - mechanical work the cheap tier does well.

Cost follows the same line. Generation runs about once per deck build and combo
suggestion about once per combo pass, so they are the two least frequent calls
in the app; chat and section fill are the frequent ones and stay cheap.

## Considered options

**Haiku everywhere.** What the app did before this decision - not as a
trade-off, but because `MODELS.fast` got typed at every call site while the
quality tier sat unreachable behind `callAnthropic`'s default. Rejected because
recommendation quality is the product, and the tier was never actually chosen.

**A stronger tier everywhere.** Rejected: chat and section fill are frequent and
mechanical, so the spend buys little.

## Consequences

- `callAnthropic`'s `model` is **required**, not defaulted. A default meant the
  quality tier was reachable only by not choosing, which is how it stayed dead
  and stale. A tier you have to name is a tier somebody decided.
- `claude-sonnet-4-20250514` is gone. It was deprecated with retirement pending
  and nothing took it.
- Every entry in `MODELS` needs a `MODEL_PRICING` row, pinned by a test per
  tier. `estimatedCostUsd` on every `llmUsageLogs` row is only as good as that
  table.
- Sonnet 5 is priced at its standard $3 / $15, not the $2 / $10 introductory
  rate that runs through 2026-08-31. An estimate that reads high for a few days
  beats one that silently under-reports from September on.

## Still open

This decision is reasoned, not measured. Issue #46 asked for an A/B on deck
generation before deciding - *"the `stats` query already has the per-call cost,
and the simulation panel gives a quality signal that is not a vibe"* - and that
measurement has **not** been run. The tier assignment above is the hypothesis to
test, not its result. Re-open #46 with the numbers before treating it as
settled.
