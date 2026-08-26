# The bench runs live through the gateway; replay only seeds a scenario

Every model the app calls is chosen by hypothesis, not measurement - ADR-0003
ends by saying so. The wayfinder map (issue #50) set out to replace the
hypothesis with a bench: a harness that runs the same question through every
candidate, measures each answer, and lets the one reviewer rank the survivors
blind. The first design question was where the answers come from.

`llmUsageLogs` looked like a free corpus: 56 real calls with their prompts and
responses already stored. The prototype for issue #57 replayed it, and the
replay showed why that cannot be a bench. No two logged rows share a prompt.
One `suggestCombos` candidate was an English Voltron build, the next a German
Nightmare build; ranking them against each other ranks the prompts, not the
models. A blind comparison needs one question.

## The decision

**A scenario is one real prompt, kept verbatim, and the bench fans it out
live.** Seeding takes the exact system prompt and messages of a completed
`llmUsageLogs` row - the card pool the app built, the intent block, the user's
words - and stores them as a `benchScenarios` row. A batch then sends that
scenario through OpenRouter to every candidate at once, so every run on the
board is an answer to the same question, measured by the same gateway on the
same day.

**Replay never supplies an answer.** The logged response is not a candidate,
even for the model that produced it: it was measured under a different key,
without `usage.cost`, on a different day. The incumbent earns its row the same
way as everyone else.

**Runs are rows.** A `benchRuns` row exists from the moment a run starts, so
the board fills in as answers arrive and a crashed batch leaves a `pending`
row rather than nothing. Each row carries the candidate as requested (model,
pinned host, structured mode, effort, budget), the gateway's measurements
(cost from `usage.cost`, tokens, reasoning tokens, cache tokens, the host that
answered, the normalized stop reason with the native one beside it), the
mechanical gate's verdict on the raw text, and the reviewer's rank.

**Bench runs never write `llmUsageLogs`.** They are not app usage; recording
them would put the bench into the corpus it seeds from and into the usage
stats.

**The gate anchors before the rank.** The scoreboard shows the gate verdict in
the same row as the rank pills, and a hard-failed run is dimmed. Issue #57
tried the unanchored order (rank first, gate revealed after) and the reviewer
did not prefer it: attention went to answers the gate would have discarded.

## Consequences

- The bench spends money. Every batch is live inference on every candidate;
  a five-run batch across the bench-first six is thirty calls. That is the
  price of a comparable measurement, and it is why the cost column is read
  from the gateway rather than modelled.
- Truncation is read from OpenRouter's normalized `length`, so `isTruncated`
  accepts `length` beside Anthropic's `max_tokens`. One predicate judges a
  bench run and an app call the same way.
- The bench carries the first half of the provider seam - the request and
  result shapes issue #54 fixed, in `convex/lib/gatewayShapes.ts` - but not
  the seam. The app still calls Anthropic directly. What replaces
  `callAnthropic` waits, by decision, until the bench says how many providers
  survive.
- A scenario set that stays fixed across model launches is the next step
  (issue #66); until it exists, scenarios are seeded by hand from whatever the
  local deployment logged.
