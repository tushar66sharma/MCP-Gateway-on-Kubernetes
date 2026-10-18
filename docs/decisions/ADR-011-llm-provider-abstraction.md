# ADR-011: One OpenAI-compatible LLM adapter; Groq primary, OpenRouter fallback; no Gemini

## Status

Accepted for the adapter and provider choice. The **default model** is Proposed: it is finalized in Phase 4 after a spike comparing `openai/gpt-oss-120b` and `llama-3.3-70b-versatile` on Groq.

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
- Nothing is implemented yet.

## Revisit if

- Free-tier quotas change or a provider drops tool calling for the chosen model.
- The Phase 4 spike shows that neither Groq model calls tools reliably.
