# ADR-011: One OpenAI-compatible LLM adapter; Groq primary, OpenRouter fallback; no Gemini

## Status

Accepted. **Implemented in Phase 4** (2026-10-19). The default model, Proposed until then, was finalized by the Phase 4 spike: **`openai/gpt-oss-120b` with `reasoning_effort: low`** on Groq (see Decision and "As built"). The master plan's other candidate, `llama-3.3-70b-versatile`, had been shut down by Groq for free and developer accounts on 2026-08-16, so the spike compared `openai/gpt-oss-120b` with `openai/gpt-oss-20b` instead.

## Date

2026-10-18

## Context

The chat agent needs an LLM that supports tool calling, at no cost. Project rules (CLAUDE.md) require free-tier providers, a provider-independent layer where switching is a configuration change, secrets only in the environment or secret manager, and **no Gemini API or keys anywhere**. Free tiers have hard limits. Verified on 2026-10-18:

- **Groq** (free Developer plan): for `openai/gpt-oss-120b`, 30 requests/min, 1K requests/day, 8K tokens/min, 200K tokens/day. Limit hits return HTTP 429 with a `retry-after` header.
- **OpenRouter** `:free` models: 20 requests/min; 50 requests/day if less than 10 credits were ever purchased, 1000/day with 10 or more.

Such limits can change; they must be re-checked before relying on them.

## Decision

- A small `LlmProvider` interface (`chat({messages, tools, signal})` returning a message, tool calls and optional usage) with one implementation, `OpenAICompatibleProvider`, that calls `${baseUrl}/chat/completions` with `fetch`. **Groq and OpenRouter are two configurations of that one adapter**; `providers.ts` holds their base URLs and default models.
- Configuration via `LLM_PROVIDER` (`groq` | `openrouter`), `LLM_MODEL`, optional `LLM_BASE_URL`, `LLM_FALLBACK_PROVIDER`, `LLM_TIMEOUT_MS` (30000) and `LLM_MAX_RETRIES` (2); keys `GROQ_API_KEY` and `OPENROUTER_API_KEY` come from Secret `llm-api-keys`, never from values.
- On 429 and 5xx: retry with exponential backoff and jitter, honouring `retry-after`; when retries are exhausted, try the fallback provider once.
- Errors are normalised to `LLM_RATE_LIMITED`, `LLM_AUTH_FAILED`, `LLM_UNAVAILABLE`, `LLM_BAD_RESPONSE`, `LLM_NOT_CONFIGURED`.
- **Default model (decided by the Phase 4 spike, 2026-10-19): `openai/gpt-oss-120b` on Groq, with `reasoning_effort: low`.** With the gateway's 15 tools and two demo questions (list today's orders, create a draft product), every Groq configuration made correct, parseable tool calls 6 times out of 6: 120b 8,088 tokens over the six calls, 120b with effort low 8,007, 20b 7,995, 20b with effort low 7,975. The 20b's lead of about 1% is run-to-run noise rather than a tie-break; the 120b is the stronger model for multi-step turns at the same free-tier limits, and it was the spec's first choice. `reasoning_effort: low` kept 6/6 and saved completion tokens, so it is sent, but **only for model ids matching `^openai/gpt-oss-`**, because other Groq models may reject the parameter. The OpenRouter fallback default is `nvidia/nemotron-3-super-120b-a12b:free` (2/2 in the spike). Full table: [ai-integration.md](../ai-integration.md#6-the-model-spike).

## Alternatives considered

- **Provider-specific SDKs.** Rejected: they tie business logic to one vendor and break the "switch by configuration" rule.
- **Gemini.** Excluded by project rule.
- **A single provider with no fallback.** Rejected: free-tier rate limits make a 429 during a demo likely enough to want a second route.
- **A paid model.** Rejected: CLAUDE.md requires free-tier API providers, so the project must not depend on paid services.
- **A self-hosted model.** Rejected: a model large enough to call tools reliably needs far more RAM than the roughly 9 GB budget the whole cluster shares (see the [setup log](../learning/00-setup-log.md)), and CLAUDE.md asks for free-tier API providers rather than self-hosted inference.
- **Generic LLM-gateway libraries.** Not chosen: a ~one-file adapter is all two OpenAI-compatible providers need.

## Consequences/trade-offs

- Switching between Groq and OpenRouter is configuration only; a provider with a different wire format needs one new adapter class and nothing else changes.
- Groq's 8K TPM is tight with tool schemas, so tool descriptions are kept short and results are truncated (ADR-010); the model choice in the Phase 4 spike weighs tool-calling reliability against the account's published limits.
- OpenRouter free models are very limited per day and may differ in tool-call behaviour, so the fallback is best-effort.
- "OpenAI-compatible" is not identical across providers; the adapter must tolerate small differences, covered by mocked-fetch tests.
- Implemented in Phase 4; see "As built". The OpenRouter route and the fallback were not exercised live through the gateway (unit-tested; the spike called OpenRouter directly).

## As built (Phase 4)

- Files: `apps/gateway/src/chat/llm/{types,errors,providers,openaiCompatible,registry}.ts`. The adapter is the function `createOpenAiCompatible(options, runtime)` rather than a class; `runtime` injects `fetch`, `sleep`, `random` and `now` for the tests.
- **The interface grew by addition** compared with the Decision above: `LlmProvider` has `name`, `model` and `chat({messages, tools, signal, deadline})`, and the result carries `message`, `toolCalls`, `usage?`, `provider` and `model` (the provider and model that actually answered, which differ after a fallback). `deadline` is the turn's end in epoch milliseconds: the adapter never sleeps past it.
- **Retries:** network errors, 429 and 5xx are retried up to `LLM_MAX_RETRIES` (2) times; a Groq `400` with `error.code: tool_use_failed` is retried once (it uses an attempt from the same budget); 401/403, other 4xx and unusable bodies are not. The wait is `retry-after` capped at 20 s, else `500 ms × 2^attempt` plus up to 250 ms of jitter; when `now + wait` reaches the deadline the error is returned immediately. Redirects are not followed, so the bearer key cannot follow a redirect to another host.
- **Fallback:** tried once with **no retries**, only after `LLM_RATE_LIMITED` or `LLM_UNAVAILABLE`, only when its key is set and the turn was not aborted. If it fails too, the primary's error is reported (it carries the provider's `retry-after`) with `fallbackProvider` and `fallbackCode` added for the log. The fallback is configured with `LLM_FALLBACK_PROVIDER` and `LLM_FALLBACK_MODEL` (Helm `gateway.llm.fallbackProvider`, `fallbackModel`); a fallback equal to the primary is refused by the gateway's config and by a chart `fail`.
- **Errors carry diagnostics, not text:** `LlmError` has `httpStatus` and `providerCode` (the provider's `error.code` only when it matches `^[a-z_]{1,40}$`); its message is fixed text, because a provider's body can echo the user's chat messages. The LLM layer itself does not log; the chat service writes these fields into its `chat turn` log line.
- **HTTP mapping** (in `api/chat.routes.ts`): `LLM_NOT_CONFIGURED` 503, `LLM_RATE_LIMITED` 429, `LLM_AUTH_FAILED`, `LLM_UNAVAILABLE` and `LLM_BAD_RESPONSE` 502. A 429 **always** sends `Retry-After`: the provider's value, or 60 s when it gave none (the free limits are per minute), so the dashboard's countdown is always defined.
- **Keys:** the Secret `llm-api-keys` (or `secrets.existing.llmApiKeys`) is referenced with `optional: true`; `scripts/create-secrets.ps1` creates it from `.env` with server-side apply (no plaintext `last-applied-configuration` annotation) and restarts the gateway. A missing key gives `LLM_NOT_CONFIGURED`, never a crash.
- **Measured cost** (2026-10-19/20, live): about 1.5K prompt tokens per model call with 15 tools; a single-tool turn (two calls) about 3.0-3.3K tokens; a four-tool turn 9.1K. On Groq's 8K tokens per minute that is about two single-tool turns per minute.
- Groq's response headers confirmed the free-plan limits during a capture on 2026-10-20: `x-ratelimit-limit-requests: 1000` (per day) and `x-ratelimit-limit-tokens: 8000` (per minute).

## Revisit if

- Free-tier quotas change or a provider drops tool calling for the chosen model.
- `openai/gpt-oss-120b` stops calling tools reliably, or Groq retires it for free accounts (as it did with `llama-3.3-70b-versatile` on 2026-08-16); re-run `scripts/dev/llm-probe.mjs` against the candidates.
