# What every LLM call site needs, and what it costs today

Inventory for [#51](https://github.com/alp82/manaschmiede/issues/51), under the
wayfinder map [#50](https://github.com/alp82/manaschmiede/issues/50).

Code facts were read from `main` at commit `72b497e` on 2026-08-26. Cost and
latency figures come from a snapshot export of the `llmUsageLogs` table taken
the same day. Prices follow the correction made in
[#52](https://github.com/alp82/manaschmiede/issues/52): **Sonnet 5 is
$2 / $10 per MTok, permanently**, not the $3 / $15 that
`convex/lib/anthropic.ts` still hardcodes. Haiku 4.5 is $1 / $5.

## Read this first: the corpus is thin, and it is not production

The `llmUsageLogs` export holds **56 rows spanning 2026-04-12 to 2026-08-25**,
from `CONVEX_DEPLOYMENT=anonymous:anonymous-manaschmiede` - an anonymous local
development deployment driven by one developer. There is no production
deployment configured in `.env.local`.

Three consequences, and every frequency claim below is qualified by them:

1. **Frequency is developer behavior, not user behavior.** A ratio of 31
   `fillSection` calls to 2 `chat.generate` calls says what got clicked during
   development, not what a player does.
2. **Most rows ran on models the app no longer uses.** 12 rows are
   `claude-sonnet-4-20250514`; 42 are Haiku 4.5, including 2 `chat.generate`
   and 7 `suggestCombos` rows that predate the quality-tier assignment in
   [#46](https://github.com/alp82/manaschmiede/issues/46). Exactly **2 rows in
   the entire corpus ran on `claude-sonnet-5`**, both `suggestCombos`, both on
   2026-08-25.
3. **`stopReason` is present on 4 of 56 rows.** The field was added on
   2026-08-25, so the truncation history before that date is simply not
   recorded. Anything said about truncation rests on those 4 rows.

Two labelled sites have **zero rows**: `chat.question` and `fillStrategyParse`.
Their cost columns below are marked unmeasured, not estimated.

## The finding that matters most

**Sonnet 5 spends most of its output budget on reasoning nobody asked for, and
that is what truncates the combo suggestion.**

Both `claude-sonnet-5` rows in the corpus report output token counts far above
the text they returned:

| Row | `output_tokens` | Chars of returned text | Text as tokens (approx.) | Unaccounted | `stop_reason` |
| --- | --- | --- | --- | --- | --- |
| 1 | 3890 | 2209 | ~610 | ~3280 | `end_turn` |
| 2 | 4096 | 1858 | ~515 | ~3580 | `max_tokens` |

`callAnthropic` sends only `model`, `max_tokens`, `system`, and `messages`. It
never requests extended thinking, and it never disables it. The gap between
billed output tokens and returned text is reasoning the model produced by
default. Three things follow, and each one lands on a different part of the
map:

- **It is a cost axis nobody is steering.** ~3.4k thinking tokens bill at the
  output rate. They are 85% of what `suggestCombos` pays for. #50's fog entry
  on the effort sweep already warns that effort is a cost axis; this is the
  measurement of it, before any sweep has been run.
- **It shares the `max_tokens` budget with the answer.** `max_tokens: 4096`
  covers thinking *plus* text. Row 2 spent the whole budget thinking and had
  its JSON cut mid-object, so `parseComboResponse` threw and the user got
  `TRUNCATED_RESPONSE_MESSAGE`. One of two observed Sonnet 5 combo calls
  failed this way. The other landed at 3890 of 4096 - within 5% of the same
  cliff.
- **There is no effort control in the codebase at all.** No call site passes a
  thinking budget, a reasoning-effort parameter, or anything equivalent,
  because `callAnthropic` has no parameter to pass. The map's effort axis
  currently has zero expression in the code. Whatever replaces `callAnthropic`
  has to introduce one.

## The per-site table

`Effort` is omitted as a column because it is the same for every row: **unset**.

| Site | Model today | `maxTokens` | Output shape | Parser |
| --- | --- | --- | --- | --- |
| `chat.generate` | `MODELS.main` (Sonnet 5) | 4096 | JSON: `name`, `description`, `explanation?`, `cards[]` | `parseResponse` → `parseCardList` (bare-object anchor `cards`) |
| `suggestCombos` | `MODELS.main` (Sonnet 5) | 4096 | JSON: `combos[]` of `{name, cards[], explanation}` | `parseComboResponse` → `parseCardList` |
| `fillSection` | `MODELS.fast` (Haiku 4.5) | 1024 | JSON: `cards[]`, `explanation` | `parseSectionResponse` → `parseCardList` (clamps copies) |
| `chat.delta` | `MODELS.fast` | 1024 | JSON delta ops | `parseDeltaResponse` |
| `chat.question` | `MODELS.fast` | 1024 | **Free prose** | none - text returned as-is |
| `chat.classify` | `MODELS.fast` via `callHaiku` | 256 | One word: `delta` / `rebuild` / `question` | string compare |
| `parseStrategy` | `MODELS.fast` via `callHaiku` | 256 | JSON: `{"queries":[...]}`, ≤3 fragments | `extractStrategyQueries` |
| `chatStrategyParse` | same code path as `parseStrategy` | 256 | same | same |
| `fillStrategyParse` | same code path as `parseStrategy` | 256 | same | same |

The last three are one function, `parseStrategyQueries` in
`convex/lib/strategyParse.ts`, distinguished only by the `logLabel` argument.
They are one model decision, not three.

### Input composition

Measured as mean characters of the assembled system prompt, split at the
`CARD POOL` and `HARD CONSTRAINT` markers:

| Site | System prompt | Static head | Card pool | Intent / context tail | Card pool's share |
| --- | --- | --- | --- | --- | --- |
| `chat.generate` | 11,078 | 1,164 | 9,158 | 756 | 83% |
| `chat.delta` | 10,524 | 1,167 | 8,866 | 491 | 84% |
| `fillSection` | 8,491 | 1,526 | 6,124 | 841 | 72% |
| `suggestCombos` | 3,345 | 3,345 | 0 | 0 | 0% (pool rides in the user message) |
| `parseStrategy` family | ~895 | ~895 | 0 | 0 | 0% |
| `chat.classify` | 563 | 563 | 0 | 0 | 0% |

**This is a direct input to
[#58](https://github.com/alp82/manaschmiede/issues/58).** For the three
pool-carrying sites, the cacheable static prefix is only 14-18% of the system
prompt; the rest is a Scryfall pool assembled fresh per call. A static-prefix
cache buys little there without restructuring the prompt so the pool moves
behind the cache breakpoint - or into the user message, which is where
`suggestCombos` already puts it. `suggestCombos` is the opposite case: its
system prompt is 100% static per language, so it is fully cacheable, though at
roughly 900 tokens it sits near Anthropic's 1024-token minimum cacheable
prefix.

### Measured cost and latency

Per call, by the model that actually ran. Cost is recomputed from the token
counts at corrected prices, so it does not match the stored
`estimatedCostUsd`.

| Site | Model that ran | n | Input tok (mean) | Output tok (mean) | Duration (mean) | Cost/call (corrected) |
| --- | --- | --- | --- | --- | --- | --- |
| `suggestCombos` | **sonnet-5** | 2 | 3,247 | 3,993 | **44.2 s** | **$0.0464** |
| `suggestCombos` | haiku-4.5 | 7 | 1,785 | 680 | 6.7 s | $0.0052 |
| `suggestCombos` | sonnet-4 | 2 | 6,960 | 559 | 11.0 s | $0.0195 |
| `fillSection` | **haiku-4.5** | 21 | 1,543 | 174 | 2.2 s | $0.0024 |
| `fillSection` | sonnet-4 | 10 | 5,874 | 108 | 3.7 s | $0.0128 |
| `chat.generate` | haiku-4.5 (stale tier) | 2 | 4,540 | 557 | 5.1 s | $0.0073 |
| `chat.delta` | haiku-4.5 | 1 | 4,368 | 158 | 2.0 s | $0.0052 |
| `parseStrategy` | haiku-4.5 | 5 | 330 | 43 | 1.1 s | $0.0005 |
| `chatStrategyParse` | haiku-4.5 | 3 | 327 | 42 | 1.0 s | $0.0005 |
| `chat.classify` | haiku-4.5 | 3 | 163 | 4 | 0.9 s | $0.0002 |
| `chat.question` | - | **0** | unmeasured | unmeasured | unmeasured | unmeasured |
| `fillStrategyParse` | - | **0** | unmeasured | unmeasured | unmeasured | unmeasured |

p95 is not reported per site because no site has enough rows to support one.
The largest bucket is `fillSection` at 31 rows across two models; every other
bucket is in single digits. Maxima, which are meaningful at this sample size:
`suggestCombos` max duration 45.0 s, `fillSection` max 4.5 s, `chat.generate`
max 5.2 s.

### `stopReason` distribution

All four rows that carry the field, in full:

| Site | Model | `stopReason` | Status |
| --- | --- | --- | --- |
| `suggestCombos` | sonnet-5 | `max_tokens` | **error** |
| `suggestCombos` | sonnet-5 | `end_turn` | complete |
| `parseStrategy` | haiku-4.5 | `end_turn` | complete |
| `parseStrategy` | haiku-4.5 | `end_turn` | complete |

One truncation in four recorded rows - and it is the site the whole wizard
hangs on. The 52 rows without the field cannot be checked, but two of them are
worth flagging as suspects on output-token grounds alone: nothing else in the
corpus comes within 10% of its cap, so the caps other than `suggestCombos`'s
appear to have headroom **at the token volumes Haiku produces**. That
qualifier is the point of the next section.

### Latency sensitivity and failure mode

| Site | User is waiting on | Failure mode |
| --- | --- | --- |
| `suggestCombos` | Wizard step 3, spinner, nothing else on screen | **Loud.** Parse throws, step 3 shows an error and the user re-rolls. A re-roll is a second full-price call. |
| `chat.generate` | Chat panel, message pending | **Loud.** Parse throws, the chat turn fails. |
| `fillSection` | Wizard step 4, per-lane spinner; auto-fill walks lanes in sequence | **Loud per lane** (`status: 'error'` on the lane), but **quiet on quality**: a lane whose cards the validator rejects retries once, and if the retry keeps nothing the first attempt's keepers are used anyway. Bad-but-valid cards land silently. |
| `chat.delta` | Chat panel, message pending | **Loud.** Parse throws. |
| `chat.question` | Chat panel, message pending | **Loud only because of an explicit check.** Free prose has no parser, so `chat()` calls `isTruncated` by hand and throws `TRUNCATED_RESPONSE_MESSAGE`. Remove that check and a half-answer about a rules interaction reads exactly like a finished one. |
| `chat.classify` | Nothing - runs ahead of the real call | **Silent by design.** Any unexpected label, truncation included, falls through to `rebuild`. A misroute sends a question to the deck generator. |
| `parseStrategy` family | `parseStrategy` blocks step 3 behind an 8 s race; the other two run inside the pool build | **Silent by design.** A failure or timeout degrades to zero fragments and a trait-only card pool. The theme still reaches the model through `customStrategy`, so the damage is a worse pool, never an error. |

Two structural notes that belong with this table:

- **The three silent sites are silent on purpose, and that is a quality-bar
  problem, not a bug.** `chat.classify` and the strategy parses degrade rather
  than fail. That is right for reliability and wrong for measurement: a model
  swap that makes either one worse produces no error, no log row marked
  `error`, and no user complaint - only slightly worse decks. Whatever the
  mechanical gate in [#55](https://github.com/alp82/manaschmiede/issues/55)
  checks, it cannot rely on the error rate for these two.
- **`chat.classify` is the highest-leverage cheap call in the app.** It costs
  $0.0002 and it decides which of three paths runs, one of which is a
  full-price `chat.generate`. A classifier that says `rebuild` when the user
  asked a question turns a $0.0002 call into a $0.05 one and rewrites the deck
  the user did not want touched.

## Cost per completed deck build

The map's ceiling is "under 5 cents per completed deck build". Here is what a
build actually costs at the current assignment, from measured token counts.

The wizard path, one combo pass, a free-text strategy present, an archetype
plan with 6 model-filled sections, and no retries. Section counts come from
`deriveSectionPlan`: templates carry 3-6 spell sections, plus a mana-fixing
section for any 2+ color deck; the basic-lands section is filled without a
model call.

| Call | Model | × | Cost each | Subtotal | Share |
| --- | --- | --- | --- | --- | --- |
| `parseStrategy` | Haiku 4.5 | 1 | $0.0005 | $0.0005 | 0.8% |
| `suggestCombos` | **Sonnet 5** | 1 | $0.0464 | **$0.0464** | **71.7%** |
| `fillStrategyParse` | Haiku 4.5 | 6 | $0.0005 | $0.0033 | 5.1% |
| `fillSection` | Haiku 4.5 | 6 | $0.0024 | $0.0145 | 22.4% |
| **Total** | | | | **$0.0647** | |

**1.3× the ceiling, and one call is 72% of it.**

That total is the floor, not the expectation. Three multipliers ride on top,
all of them normal use rather than edge cases:

- A validator retry on half the lanes adds 3 fills and 3 strategy parses:
  **+$0.0089**.
- One combo re-roll - which the corpus shows is routine, 11 `suggestCombos`
  calls against 2 `chat.generate` - adds **+$0.0464**, a second full-price
  call. Two re-rolls and the build is at 2.4× the ceiling from combos alone.
- A chat rebuild after the wizard adds a `chat.generate`. Projected below.

The 1.3× agrees with #52's figure by coincidence, not by arithmetic: #52
modelled a build as 8.0k input / 2.3k output across the quality tier; the
measured `suggestCombos` call alone produces 4.0k output tokens, **1.7× #52's
whole quality-tier output budget**. The estimate and the measurement land in
the same place because #52's model spread the budget over two quality-tier
calls where the wizard path only makes one.

### The projection this inventory cannot measure

**`chat.generate` has never run on Sonnet 5.** Its 2 rows are Haiku, from June,
before #46 assigned it the quality tier. Extrapolating from the Haiku token
counts and the reasoning overhead observed on `suggestCombos`:

| | Input tok | Output tok | Cost | Against `maxTokens: 4096` |
| --- | --- | --- | --- | --- |
| Measured, Haiku 4.5 | 4,540 | 557 | $0.0073 | comfortable |
| Projected, Sonnet 5, text only | 4,540 | 557 | $0.0147 | comfortable |
| Projected, Sonnet 5, +3.4k reasoning | 4,540 | ~3,957 | **~$0.0487** | **~97% of cap** |

If that projection holds, `chat.generate` on Sonnet 5 costs nearly the entire
5-cent ceiling by itself and sits on the same truncation cliff that already
broke `suggestCombos` - and it truncates a 60-card list, which is a longer
answer than 5 combos. **This is the single most valuable thing the bench in
[#57](https://github.com/alp82/manaschmiede/issues/57) can measure first**,
because it is a live production risk that no log row has caught yet.

The same cliff threatens every migration: `chat.delta`, `chat.question`, and
`fillSection` all run `maxTokens: 1024`, and the strategy parses run 256. Those
caps are sized for a model that answers directly. Any candidate that reasons by
default will spend the whole budget before it writes a character. **A cap
review is not optional cleanup in the migration; it is a precondition.**

## Does the two-tier split match where quality matters?

Three answers, one per assertion in `docs/adr/0003-model-tiers.md`.

**On "the two least frequent calls in the app" - half right, and the wrong half
matters.** `chat.generate` is genuinely rare: 2 of 56 rows. `suggestCombos` is
not: 11 of 56, 5.5× more often than `chat.generate` and second only to
`fillSection`. The ADR's parenthetical, "one per deck build, one per combo
pass", is literally accurate and reads as though a build makes one of each.
The corpus says otherwise, because step 3 lets the user re-roll and the code
feeds `rejectedCombos` and `missingMaybeColors` back into a fresh full-price
call. The ADR's cost argument - "the tier costs little in aggregate" - rests on
the frequency claim, and for `suggestCombos` the frequency claim does not hold.
Corrected: **the quality tier is 72% of a minimum build and grows with every
re-roll.**

**On putting `suggestCombos` in the quality tier - right, for a better reason
than the ADR gives.** The ADR justifies it on reasoning quality, which is
plausible and still unmeasured. What the corpus adds is that it is also the
cost and latency centre of the whole app: 72% of build spend and 44 s of a
60 s budget. That makes it the correct place to *start* eliminating candidates,
because it is where a cheaper model pays for itself most and where a slower one
breaks the ceiling first. It does not follow that Sonnet 5 is the right
occupant - only that the seat matters.

**On leaving `fillSection` in the cheap tier - the assumption most worth
testing.** It is the most-run site in the corpus, 6-12 calls per build, 22% of
build spend, and it picks real cards for real slots. Its per-call cost is
$0.0024, so the whole 6-call block costs a third of one combo call. That is a
cheap place to buy quality: doubling the fill model's price adds $0.015 to a
build, less than one combo re-roll. The ADR files fill under "mechanical calls
- the ones that route, classify, or fill a named slot rather than decide what
belongs in a deck". Filling a named slot *is* deciding what belongs in a deck;
the slot is named, the cards are not. That framing deserves a challenge on the
bench rather than in prose.

**A fourth site the two-tier framing hides.** `chat.classify` costs $0.0002 and
gates a $0.05 call. It is correctly in the cheap tier and it is also the site
where a cheap-model regression is most expensive, because its failure mode is
silent misrouting rather than an error. A tier assignment expressed only as
"quality vs mechanical" has nowhere to record that.

## What this hands the rest of the map

- **#55, the mechanical gate.** Three sites degrade silently, so error rate
  cannot be the gate's signal for them. The gate needs a per-site check:
  fragment count and shape for the strategy parses, label validity for the
  classifier.
- **#57, the bench.** Run `chat.generate` on Sonnet 5 first - the projection
  above says it may be truncating in production the moment anyone uses chat.
  Record output tokens separately from returned text on every run, or the
  reasoning overhead stays invisible exactly as it did here. And record cost
  per run, per #50's standing note.
- **#58, prompt caching.** The static prefix is 14-18% of the system prompt on
  the three pool-carrying sites and 100% on `suggestCombos`. Caching helps most
  where the money is *not*, unless the pool moves out of the system prompt
  first.
- **The provider seam.** It needs an effort or thinking-budget parameter, which
  `callAnthropic` does not have; and it needs `maxTokens` re-derived per site,
  because today's caps assume a model that does not think before answering.

## Reproducing this

```
npx convex export --path <dir>/export.zip
UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE unzip -q <dir>/export.zip -d <dir>/export
# rows land at <dir>/export/llmUsageLogs/documents.jsonl
```

The aggregation was one throwaway Node script over that JSONL; nothing about it
is worth keeping, and re-running it against a corpus with production traffic
would be worth more than re-reading these numbers.
