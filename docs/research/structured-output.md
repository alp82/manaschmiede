# How does each provider express structured output, and what must the seam abstract?

Research for [#54](https://github.com/alp82/manaschmiede/issues/54), part of the
wayfinder map [#50](https://github.com/alp82/manaschmiede/issues/50). Builds on
the gateway resolution (#53, `docs/research/llm-gateway.md`: OpenRouter, bare
`fetch` to `/v1/chat/completions`, Convex V8 runtime) and the slate (#52,
`docs/research/model-slate.md`).

**Every claim below was checked on 2026-08-26** against OpenRouter's docs and
live API, or the provider's own docs. Live capability data comes from
`GET https://openrouter.ai/api/v1/models` and
`GET https://openrouter.ai/api/v1/models/{id}/endpoints`, both keyless. Where a
claim rests on a single source or an inference it is marked **unverified**.

## Headline

**Through OpenRouter there is exactly one request shape for enforced JSON, and
every bench-first model accepts it** — `response_format: {type: "json_schema",
json_schema: {name, strict: true, schema}}`, sent with
`provider: {require_parameters: true}`. The gateway translates it per provider
(for Anthropic it applies the structured-outputs beta header itself). So the
seam does *not* need a per-provider request builder. What it needs is three
things the gateway does **not** normalize:

1. **Enforcement strength is per endpoint, not per model, and the gateway
   only says whether the parameter is *accepted*, never whether it was
   *enforced*.** The `structured_outputs` flag in `supported_parameters` is the
   only signal. `require_parameters: true` keeps a request off endpoints that
   lack the flag; it does not make a "strong hint" endpoint into a
   constrained-decoding one. The four labs on the bench-first six all document
   constrained decoding (OpenAI, Anthropic, Meta, Inception), so on their
   first-party endpoints `strict: true` is a real guarantee. DeepSeek is the
   exception — see below.
2. **Truncation is normalized, and the normalized value is the one to read.**
   OpenRouter maps every provider's stop reason onto
   `finish_reason ∈ {stop, length, tool_calls, content_filter, error}` and
   keeps the raw one in `native_finish_reason` (nullable). `isTruncated()`
   becomes `finish_reason === 'length'`. Truncated structured output is the
   ticket's worst case and it is *real* on every reasoning model here:
   reasoning tokens count against `max_tokens` on OpenAI, Anthropic, Meta and
   (via OpenRouter's effort→budget mapping) everyone else, so a deck request
   with `max_tokens: 1024` and effort left at its default can spend the whole
   budget thinking and return `length` with an empty or partial JSON body.
3. **Schema failure has three faces and the seam must fold them into one.**
   A schema the endpoint cannot compile is an HTTP 400. A model that refuses
   surfaces as `message.refusal` (OpenAI-shape, which OpenRouter's response
   schema carries) or as a typed `refusal` error. A model on a weakly-enforcing
   endpoint returns prose or fenced JSON with `finish_reason: 'stop'`, which
   only `jsonLadder` plus a schema check can catch.

The consequence for the bench: **"schema conformance" must be measured on the
output, never inferred from the flag.** Parse, validate against the schema,
and count `length`, `refusal` and validation failures separately.

## Per-candidate table (bench-first six)

`Endpoints` is the live count of OpenRouter endpoints advertising
`structured_outputs` over the total for that slug, 2026-08-26. `Reasoning`
is the model entry's `reasoning` metadata from `/api/v1/models`.

| Model | OpenRouter id | Request shape | Guarantee on first-party endpoint | Endpoints w/ `structured_outputs` | Reasoning (default / off?) | Reasoning-vs-JSON hazard |
| --- | --- | --- | --- | --- | --- | --- |
| GPT-5.6 Luna | `openai/gpt-5.6-luna` | `json_schema` strict; or strict function | **Schema** — "always generate responses that adhere to your supplied JSON Schema" | 6 / 7 (Bedrock lacks it) | on, `medium`; **`none` supported** | reasoning tokens count toward output cap; refusal → `refusal` field |
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` | `json_schema` strict (gateway adds beta header); strict tool needs header passed manually | **Schema** — "constrained decoding … Always valid … No retries needed" | 6 / 9 (the 3 Google/Vertex endpoints lack it) | adaptive, on, `high`; no `none` in OR metadata | thinking counts toward `max_tokens`; forced tool + *manual* thinking = 400 (adaptive OK); `stop_reason: refusal` exists |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` | same as Sonnet | **Schema** (listed as supported model) | 5 / 8 (Google endpoints lack it) | off unless asked; no effort param | none by default — the safest of the six |
| Mercury 2 | `inception/mercury-2` | `json_schema` strict, `json_object`, tools (`required`) | **Schema** ("strictly typed, machine-parseable"; constrained wording weaker than OpenAI/Meta) | 1 / 1 | on, `medium`; **`none`/`instant` supported** | `max_tokens` default 16,384, cap 50,000 |
| Muse Spark 1.2 | `meta/muse-spark-1.2` | `json_schema` (strict optional — output constrained either way) | **Schema** — "decoding itself is constrained, so the output is guaranteed to conform" | 1 / 1 | **mandatory**, `medium`; `none` → **HTTP 400** | "If the model spends most of the budget on reasoning, the visible response may be truncated" — documented by Meta |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | `json_schema` on 11 third-party hosts; DeepSeek's own API has only `json_object` + strict *tools* (beta) | **Host-dependent.** Lab guarantees syntactic JSON only via `json_object`; schema only via strict function calling on `/beta` | 11 / 17 (Sail, GMICloud, SiliconFlow, Novita, Azure lack it; Cloudflare has `structured_outputs` but not `response_format`) | on, `high`; efforts `xhigh`/`high` only in OR metadata | lab docs: "The API may occasionally return empty content" in JSON mode; vLLM issue reports wrong structured output when thinking enabled (**unverified** for the OR hosts) |

### Rest of the slate — enforcement mode OpenRouter reports (live, 2026-08-26)

Model-level `supported_parameters` from `/api/v1/models`. `native` = both
`response_format` and `structured_outputs`; `json-only` = `response_format`
without `structured_outputs`. All of these also advertise `tools` and
`tool_choice`, so forced-tool fallback is available everywhere.

| Model | Mode | Reasoning control advertised |
| --- | --- | --- |
| `z-ai/glm-4.7-flash`, `z-ai/glm-4.7` | native | `reasoning` only |
| `qwen/qwen3.7-flash` | **json-only** (no `structured_outputs` flag) | `reasoning` only |
| `minimax/minimax-m3` | native | `reasoning` only |
| `google/gemini-3.7-flash`, `google/gemini-3.5-flash-lite` | native | `reasoning_effort` (cannot fully disable, per #52) |
| `deepseek/deepseek-v4-pro` | native (same host caveat as Flash) | `reasoning_effort` |
| `moonshotai/kimi-k2.7-code` | native | `reasoning` only |
| `meta/muse-spark-1.2-contributor`, `meta/muse-glimmer-30b` | native | `reasoning_effort`, mandatory |
| `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b` | native | `reasoning_effort` |
| `mistralai/mistral-small-2603` | native | `reasoning_effort` |
| `mistralai/mistral-large-2512` | native | none (non-reasoning) |
| `x-ai/grok-4.3` | native | `reasoning_effort` |

Qwen 3.7 Flash is the one slate model where `jsonLadder` is the *primary*
path, not the fallback. For every model, the model-level flag is a union over
endpoints — pin the provider (`provider.order` + `allow_fallbacks: false`) or
use `require_parameters` before trusting it.

## The gateway layer

### Request shape

From [Structured Outputs](https://openrouter.ai/docs/features/structured-outputs)
(2026-08-26):

```json
{
  "model": "…",
  "messages": [],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "deck", "strict": true, "schema": { } }
  },
  "provider": { "require_parameters": true }
}
```

- *"Set `strict: true` so that providers with a native strict mode enforce your
  schema exactly."* But: *"some providers guarantee schema-conforming output,
  while others translate your schema into their own structured-output format or
  treat it as a strong hint, so exact compliance is not guaranteed on every
  endpoint."*
- *"Support is determined per endpoint, not just per model."* The signal is
  `structured_outputs` in an endpoint's `supported_parameters`.
- Unsupported model: *"The request will fail with an error indicating lack of
  support."* Invalid schema: *"The model will return an error if your JSON
  Schema is invalid."* Both are loud — good.
- `response_format` also accepts `json_object` (plain JSON mode; the
  [parameters reference](https://openrouter.ai/docs/api-reference/parameters)
  says "when using JSON mode, you should also instruct the model to produce
  JSON yourself"), plus `grammar` and `python` types listed in the
  [chat-completion reference](https://openrouter.ai/docs/api-reference/chat-completion).
  Neither grammar type is documented per provider; **do not rely on them**.

### Routing interaction

From [Provider Routing](https://openrouter.ai/docs/features/provider-routing)
(2026-08-26):

- `require_parameters: true` → *"the request won't even be routed to that
  provider"* if it lacks a requested parameter. Default `false` silently drops
  the parameter on incompatible endpoints — which is exactly how a gate reports
  a pass it did not earn.
- Even with `require_parameters: false`, *"tools, response_format (including
  structured outputs), and verbosity"* get soft routing preference.
- Anthropic specifics: for `response_format.type: "json_schema"` *"the header
  is automatically applied"*; for strict **tool** use *"you must explicitly pass
  the `structured-outputs-2025-11-13` header. Without this header, OpenRouter
  will strip the `strict` field and route normally."* So the forced-tool
  fallback on Claude is only strict if the seam sends that header.

### Truncation and stop reasons

From the [API overview](https://openrouter.ai/docs/api-reference/overview)
(2026-08-26): *"OpenRouter normalizes each model's `finish_reason` to one of
the following values: `tool_calls`, `stop`, `length`, `content_filter`,
`error`."* The raw value is in `native_finish_reason`, which can be `null`
(confirmed by [pydantic-ai#3581](https://github.com/pydantic/pydantic-ai/issues/3581),
a validation failure caused by a null `native_finish_reason`).

Provider-native values the seam will see in `native_finish_reason`:

| Provider | Native truncation value | Native refusal signal |
| --- | --- | --- |
| Anthropic | `max_tokens`; also `model_context_window_exceeded` on 4.5+ ("Treat as truncated") | `stop_reason: "refusal"` — an HTTP 200, `stop_details` names the policy category |
| OpenAI (Chat Completions) | `length` | `message.refusal` string |
| Meta | `length` (OpenAI-shape) | not documented |
| Inception | `length` (`stop, length, tool_calls, content_filter`) | not documented |
| DeepSeek | `length`; also `insufficient_system_resource` | not documented |

**Neither Anthropic value is `length`, which is why the seam reads the
normalized field.** Whether OpenRouter maps `model_context_window_exceeded` to
`length` is **unverified** — the bench should provoke it once.

### Failure surfaces

From [Errors](https://openrouter.ai/docs/api-reference/errors) (2026-08-26):

- Pre-stream errors are HTTP 4xx/5xx with a typed `error_type`. Two are
  relevant: `"refusal"` (400, *"The model explicitly refused to comply with the
  request"*) and `"content_policy_violation"` (400).
- Non-streaming provider errors can be *"embedded in final response as
  `choices[].error`"* **alongside partial content**, with `finish_reason:
  'error'`. A 200 with a `choices[0].error` object is therefore a real case.
- The response schema carries `message.refusal` (*"Refusal message if content
  was refused"*) and `message.reasoning`.

So a structured call can fail as (a) HTTP error, (b) 200 + `choices[0].error`,
(c) 200 + `message.refusal`, (d) 200 + `finish_reason: length` + partial JSON,
(e) 200 + `stop` + non-conforming content. The seam must check in that order.

### Reasoning

From [Reasoning Tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens)
(2026-08-26): one `reasoning: {effort | max_tokens, exclude, enabled}`
object; effort maps to ~95/80/50/20/10 % of `max_tokens`; *"`max_tokens` must
be strictly higher than the reasoning budget to ensure there are tokens
available for the final response after thinking."* Reasoning tokens are billed
as output and reported in `usage.completion_tokens_details.reasoning_tokens`.

Per-model `reasoning` metadata from `/api/v1/models` (live, 2026-08-26) is
the input the seam should read rather than hardcode:

| Model | `mandatory` | `default_enabled` | `supported_efforts` | `default_effort` |
| --- | --- | --- | --- | --- |
| `openai/gpt-5.6-luna` | false | true | max, xhigh, high, medium, low, **none** | medium |
| `anthropic/claude-sonnet-5` | false | true | max, xhigh, high, medium, low | high |
| `anthropic/claude-haiku-4.5` | false | — | — | — |
| `inception/mercury-2` | false | true | high, medium, low, **none** | medium |
| `meta/muse-spark-1.2` | **true** | — | xhigh, high, medium, low, minimal | medium |
| `deepseek/deepseek-v4-flash` | false | — | xhigh, high | high |

Note the docs and the metadata disagree in two places: OpenRouter's docs list
`minimal` and `none` as universal levels, but Sonnet 5's metadata has neither
(Anthropic's own docs say `thinking: {type: "disabled"}` is accepted on Sonnet
5 — #52), and DeepSeek's lab docs list `low` while OR's metadata does not.
Send only what the metadata lists, or expect a 400.

## Per-provider detail

### OpenAI — GPT-5.6 Luna

- Request: `response_format: json_schema` with `strict: true`, or a function
  with `strict: true`. Two forms, *"recommending function calling for tool
  integration and `text.format` for response structuring."*
- Guarantee: *"the model will always generate responses that adhere to your
  supplied JSON Schema, so you don't need to worry about the model omitting a
  required key, or hallucinating an invalid enum value."* JSON mode is weaker:
  *"only Structured Outputs ensure schema adherence."*
- Schema rules: *"All fields … must be specified as `required`"*,
  *"`additionalProperties` must be set to `false`"*; supports `pattern`,
  `format`, `minimum`/`maximum`, `minItems`/`maxItems` (a superset of what
  Anthropic accepts — see below).
- Refusal: *"the response includes a `refusal` field instead of following the
  schema"* — *"programmatically detectable"*.
- Truncation: Chat Completions `finish_reason: "length"`. Reasoning tokens
  *"occupy space in the model's context window and are billed as output
  tokens"*; OpenAI recommends *"reserving at least 25,000 tokens for reasoning
  and outputs"* when experimenting. With `reasoning.effort: "none"` that
  reservation is moot, which is why `none` matters for the mechanical tier.
- Sources: [Structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs),
  [Chat object reference](https://developers.openai.com/api/docs/api-reference/chat/object),
  [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) — all 2026-08-26.

### Anthropic — Claude Sonnet 5, Claude Haiku 4.5

- Request (native): `output_config.format: {type: "json_schema", schema}` for
  JSON outputs; `strict: true` on a tool for strict tool use. Beta header
  *"no longer required"* natively; OpenRouter still applies it for
  `json_schema` and requires you to pass it for strict tools.
- Guarantee: *"Structured outputs guarantee schema-compliant responses through
  constrained decoding: Always valid … Type safe … Reliable: No retries needed
  for schema violations."* Both Sonnet 5 and Haiku 4.5 are in the supported
  list.
- Schema rules — **narrower than OpenAI**: no recursive schemas, no
  `minimum`/`maximum`/`multipleOf`, no `minLength`/`maxLength`, no `pattern`,
  `minItems` only 0 or 1. **The deck schema must be written to the Anthropic
  subset** or the same schema will 400 on Claude and pass on GPT. First use of
  a schema compiles a grammar (extra latency, cached 24h); changing the schema
  or the tool set invalidates it and the prompt cache.
- Refusal: `stop_reason: "refusal"` on a normal 200 — *"Claude declined to
  respond."* What OpenRouter maps this to is **unverified**; expect
  `native_finish_reason: "refusal"` with `finish_reason` either `stop` or
  `content_filter`. The seam must read `native_finish_reason` for this case.
- Truncation: `stop_reason: "max_tokens"`; *"`max_tokens`, which includes all
  thinking Claude generates in the current turn, is enforced as a strict
  limit."* On 4.5+ hitting the context window gives
  `model_context_window_exceeded` rather than an error.
- Thinking interaction: *"Forced tool use (`tool_choice: {"type": "any"}` or
  `{"type": "tool", ...}`) is incompatible with manual extended thinking but
  works with adaptive thinking."* Sonnet 5 is adaptive (fine). Haiku 4.5 only
  has manual extended thinking, so **forced-tool fallback on Haiku must not be
  combined with a `reasoning` budget** — it would 400. Also *"You can't
  pre-fill the assistant response while thinking is on"*, so the `{`-prefill
  trick is not a fallback on Sonnet 5.
- Sources: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
  [Handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons),
  [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking),
  [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) — all 2026-08-26.

### Inception — Mercury 2

- Request: `response_format` ∈ `text | json_object | json_schema` with
  `strict: true`; `tool_choice` ∈ `auto | required | none`; `reasoning_effort`
  ∈ `instant | low | medium | high`, default `medium` (OpenRouter exposes the
  same as `none | low | medium | high`).
- Guarantee: *"strictly typed, machine-parseable responses"* that *"enforce
  structured data output"*. The wording does not say "constrained decoding",
  so treat as **schema-enforced per vendor claim, to be confirmed by the
  bench**.
- Truncation: `finish_reason` ∈ `stop | length | tool_calls | content_filter`;
  `max_tokens` default 16,384, max 50,000. No refusal field documented.
- Single endpoint on OpenRouter (Inception's own), `structured_outputs: true`.
- Sources: [Structured outputs](https://docs.inceptionlabs.ai/capabilities/structured-outputs),
  [Chat completion reference](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion.md)
  — 2026-08-26.

### Meta — Muse Spark 1.2

- Request: `response_format: {type: "json_schema", json_schema: {name, schema}}`.
  *"This is not post-processing: decoding itself is constrained, so the output
  is guaranteed to conform."* `strict` only adds server-side validation of the
  schema against the strict subset: *"`strict: false` currently behaves the
  same as `strict: true`."*
- Schema rules: no recursion (HTTP 400), depth ≤ 10, ≤ 5,000 properties,
  ≤ 120,000 characters of names/enums.
- Reasoning: *"`none` … returns HTTP 400"* on Muse Spark; *"Reasoning tokens
  count toward your output-token budget … If the model spends most of the
  budget on reasoning, the visible response may be truncated."* This is the
  clearest vendor statement of the ticket's worst case, from a model whose
  reasoning cannot be turned off.
- Refusal / `finish_reason` with structured output: not documented.
- Sources: [Structured output](https://ai.developer.meta.com/docs/features/structured-output/),
  [Reasoning](https://dev.meta.ai/docs/reasoning.md) — 2026-08-26.

### DeepSeek — V4 Flash

- Lab API: `response_format` is *"Must be one of `text` or `json_object`"* —
  **no `json_schema`**. Schema enforcement exists only as strict *function
  calling* on `base_url .../beta` with `strict: true` on every tool; *"supported
  by both thinking and non-thinking mode"*; same OpenAI-style rules (all
  properties required, `additionalProperties: false`, types limited to object,
  string, number, integer, boolean, array, enum, anyOf).
- JSON mode caveats from the lab: must *"Include the word 'json' in the system
  or user prompt, and provide an example"*; *"The API may occasionally return
  empty content"*; set `max_tokens` to *"prevent the JSON string from being
  truncated midway."*
- Through OpenRouter, `deepseek/deepseek-v4-flash` never routes to DeepSeek
  itself (#52 noted the $0.09/$0.18 price is third-party). 11 of 17 hosts
  advertise `structured_outputs` (DigitalOcean, StreamLake, DeepInfra, Alibaba,
  Venice, AtlasCloud, Baidu, CoreWeave, Parasail, Mancer 2, Phala); Sail,
  GMICloud, SiliconFlow, Novita and Azure accept `response_format` but not
  `structured_outputs`; Cloudflare advertises `structured_outputs` without
  `response_format` (a metadata inconsistency — avoid it). Enforcement on those
  hosts is the host's inference stack (vLLM/SGLang-style guided decoding),
  which OpenRouter's docs classify as "translate or treat as a hint". A
  [vLLM issue](https://github.com/vllm-project/vllm/issues/41132) reports
  incorrect structured output for V3.2/V4 with thinking enabled — **unverified**
  against any OpenRouter host, but exactly what the bench should probe.
- Truncation: `finish_reason` ∈ `stop | length | content_filter | tool_calls |
  insufficient_system_resource`. Thinking is on by default at `high`.
- Sources: [Chat completion reference](https://api-docs.deepseek.com/api/create-chat-completion),
  [JSON output](https://api-docs.deepseek.com/guides/json_mode),
  [Tool calls / strict mode](https://api-docs.deepseek.com/guides/tool_calls),
  [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode) — 2026-08-26.

## Design: the minimum adapter interface

The gateway collapses the request side, so the seam is thin. What it owns is
(1) capability lookup, (2) the fallback ladder, (3) result normalization.

### Request

```ts
interface LlmJsonRequest<T> {
  model: string                       // OpenRouter slug, read from the models list
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  schema: JsonSchema                  // written to the Anthropic subset, additionalProperties:false, all required
  schemaName: string                  // json_schema.name / tool name; stable, since Anthropic caches grammars by it
  maxTokens: number                   // hard ceiling on reasoning + answer
  reasoning?: { effort: Effort } | { maxTokens: number } | 'off'   // one axis; 'off' sends effort:'none' only where metadata lists it
  provider?: { order?: string[]; allowFallbacks?: boolean }        // pin the host for the bench
}
```

### Result — what joins `stopReason` and cost in `LlmResult`

```ts
interface LlmJsonResult<T> {
  // already there
  text: string; model: string; inputTokens: number; outputTokens: number
  durationMs: number; costUsd: number            // from usage.cost; drop the "estimated" name
  stopReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null  // OpenRouter-normalized finish_reason
  // new
  nativeFinishReason: string | null              // e.g. 'max_tokens', 'refusal', 'model_context_window_exceeded'
  provider: string | null                        // which host answered (response `provider`)
  reasoningTokens: number                        // usage.completion_tokens_details.reasoning_tokens ?? 0
  cachedTokens: number                           // usage.prompt_tokens_details.cached_tokens ?? 0
  schemaEnforced: 'native' | 'tool' | 'json-only' | 'none'   // which rung produced the text
  refusal: string | null                         // message.refusal, or the typed refusal error's message
  providerError: { code: number; message: string } | null    // choices[0].error on a 200
  value: T | null                                // parsed AND validated; null when any check below failed
  failure: 'truncated' | 'refused' | 'provider-error' | 'unparseable' | 'schema-mismatch' | null
}
```

`isTruncated` reads `stopReason === 'length'` — and, until the Anthropic
mapping is verified, also `nativeFinishReason` in
`{'max_tokens','model_context_window_exceeded'}`. `value` is only non-null when
`failure` is null; a call site never sees a partial deck.

### Request-building strategy

1. **Schema-first.** Look up the model's endpoints once (cache the
   `/models/{id}/endpoints` response for the process). If any endpoint has
   `structured_outputs`, send `response_format: json_schema` with `strict:
   true` and `provider.require_parameters: true`. Result: `schemaEnforced:
   'native'`. Still validate — the flag says accepted, not enforced.
2. **Forced tool call** when no endpoint has `structured_outputs` but all have
   `tools` + `tool_choice` (Qwen 3.7 Flash; any pinned host without the flag):
   one function whose `parameters` is the schema, `tool_choice: {type:
   'function', function: {name}}`, `strict: true`, plus the
   `structured-outputs-2025-11-13` header for Anthropic slugs. Read
   `message.tool_calls[0].function.arguments`; expect `finish_reason:
   'tool_calls'`. Never combine with a `reasoning` budget on Haiku 4.5.
   Result: `'tool'`.
3. **`json_object`** where only `response_format` is advertised, with the word
   "JSON" and an example in the system prompt (DeepSeek's rule, harmless
   elsewhere). Result: `'json-only'`.
4. **`jsonLadder`** on whatever came back, at every rung, then schema
   validation. Result: `'none'` when nothing above applied.

The ladder is chosen from metadata, not from a hardcoded per-model table, so
the seam has no knowledge of who answers. The one per-provider fact that
cannot be derived from metadata — the Anthropic strict-tool header — is a
single `if (model.startsWith('anthropic/'))`.

Two rules the strategy depends on: **budget `maxTokens` for answer plus
reasoning** (use `reasoning: 'off'` on the mechanical tier wherever the
metadata allows `none`; on mandatory-reasoning models, raise `maxTokens` and
watch `reasoningTokens`), and **write one schema in the Anthropic subset** so
the same schema is valid on every constrained-decoding provider.

### What the bench's "schema conformance" column measures

Per (model, host, effort) cell, over N runs:

- **conformance rate** = runs where `value !== null` / N, with `failure`
  broken out into `truncated`, `refused`, `provider-error`, `unparseable`,
  `schema-mismatch`. The last one is the enforcement measurement: a host
  advertising `structured_outputs` with a non-zero `schema-mismatch` rate is a
  "hint" endpoint.
- **which rung** produced each pass (`schemaEnforced`), so a model that only
  passes through `jsonLadder` is not scored as native.
- **`reasoningTokens` and `outputTokens`** alongside, so a cell with a high
  `truncated` rate is diagnosed as budget, not schema.
- **One deliberate truncation probe** per model (`maxTokens` below the known
  answer size) to confirm `stopReason === 'length'` arrives and `value` is
  null — the test that guards the ticket's worst case.

## Hazards found

- A partial JSON body with `finish_reason: 'length'` on a reasoning model is
  the default outcome, not an edge case, for a 1,024-token `maxTokens` with
  reasoning at its default `medium`/`high`. Every current call site uses such
  budgets (#52's table).
- `strict: true` on a Claude **tool** is silently stripped by OpenRouter
  without the beta header — the fallback rung would run unenforced and look
  identical to the enforced one.
- The deck schema needs `additionalProperties: false` and every property
  `required` (OpenAI, DeepSeek strict) **and** no numeric/string-length
  constraints or `pattern` (Anthropic). A schema that uses `minimum: 0` on
  quantities passes OpenAI and 400s on Claude.
- `native_finish_reason` can be `null`; never destructure it as a string.
- A 200 can carry `choices[0].error` with partial content; check it before
  reading `message.content`.
- DeepSeek through OpenRouter is a different product from DeepSeek's API:
  different hosts, different enforcement, and the model-level flag hides that
  6 of 17 hosts do not enforce. Pin the host on the bench.
- Muse Spark cannot stop reasoning (`none` → 400) and Meta documents that
  reasoning can eat the visible answer. Its mechanical-tier viability is a
  `maxTokens` question the bench must answer with `reasoningTokens` recorded.

## Sources (all checked 2026-08-26)

- OpenRouter: [Structured Outputs](https://openrouter.ai/docs/features/structured-outputs);
  [Provider Routing](https://openrouter.ai/docs/features/provider-routing);
  [Tool Calling](https://openrouter.ai/docs/guides/features/tool-calling);
  [Reasoning Tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens);
  [API overview / response schema](https://openrouter.ai/docs/api-reference/overview);
  [Chat completion reference](https://openrouter.ai/docs/api-reference/chat-completion);
  [Parameters](https://openrouter.ai/docs/api-reference/parameters);
  [Errors](https://openrouter.ai/docs/api-reference/errors);
  live `GET /api/v1/models` and `GET /api/v1/models/{id}/endpoints`.
- OpenAI: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs);
  [Chat completion object](https://developers.openai.com/api/docs/api-reference/chat/object);
  [Reasoning](https://developers.openai.com/api/docs/guides/reasoning).
- Anthropic: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs);
  [Handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons);
  [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking);
  [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).
- Inception: [Structured outputs](https://docs.inceptionlabs.ai/capabilities/structured-outputs);
  [Chat completion reference](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion.md).
- Meta: [Structured output](https://ai.developer.meta.com/docs/features/structured-output/);
  [Reasoning](https://dev.meta.ai/docs/reasoning.md).
- DeepSeek: [Chat completion](https://api-docs.deepseek.com/api/create-chat-completion);
  [JSON output](https://api-docs.deepseek.com/guides/json_mode);
  [Tool calls (strict mode)](https://api-docs.deepseek.com/guides/tool_calls);
  [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode).
- Secondary, flagged as such: [pydantic-ai#3581](https://github.com/pydantic/pydantic-ai/issues/3581)
  (null `native_finish_reason`); [vllm#41132](https://github.com/vllm-project/vllm/issues/41132)
  (DeepSeek structured output with thinking).
