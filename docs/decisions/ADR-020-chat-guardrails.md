# ADR-020: Chat guardrails: a scope rule, an on-topic check and a daily token budget

## Status

Accepted. **Implemented in Phase 5b (Task 5b.3).** The number is 020 because ADR-018 (WordPress cron) already exists and ADR-019 is reserved for the external WooCommerce store.

## Date

2026-10-23

## Context

The chat agent runs on a shared, free LLM quota (Groq: 8K tokens a minute and 200K a day for the whole gateway). Any signed-in user could use it as a general chatbot ("write binary search in Python"), spending that quota and the answer length on things unrelated to the store. Before this change nothing limited what a user asked or how many tokens one user could spend.

## Decision

Four layers, cheapest first. Each has a default and can be configured.

1. **Scope rule in the system prompt.** One line: `- Only help with this store, the user's notes, small utility tasks and how to use this dashboard. For anything else, reply with exactly: "<refusal text>"`. It is always on and costs about 40 prompt tokens per call.
2. **On-topic check** (`CHAT_TOPIC_CHECK`, default on). Before the main turn, a small model (Groq `openai/gpt-oss-20b`; on OpenRouter the main model) is asked to answer one word, `ALLOW` or `BLOCK`, for the last user message (a message over 2,000 characters is sent as its first 1,000 and last 997 characters, so padding cannot hide a request at the end) plus up to 500 characters of the previous assistant message (so "yes, go ahead" is judged in context). Both are sent wrapped as data, with any tag-like text neutralised, at temperature 0. `BLOCK` ends the turn with HTTP 200, the fixed refusal text, `stoppedReason: "off_topic"` and no tool calls; the main model is not called. The prompt and the model come from the Task 5b.1 probe; after the Phase 5b review the prompt gained one sentence (a short confirmation counts as on topic only when the previous assistant message is on topic; a follow-up to an offer of off-topic work is blocked), and the probe was re-run with the gateway's own input builder and parameters: 3 runs of 30 cases, all as expected (2026-10-23; details in [ai-integration.md](../ai-integration.md#9-guardrails-scope-topic-check-answer-cap-and-daily-budget-phase-5b)).
3. **Fail open.** If the check fails (rate limit, timeout of `CHAT_TOPIC_CHECK_TIMEOUT_MS` 5000 ms, 5xx), returns an empty or unrecognised reply, or the check model is not configured, the turn runs with only layer 1. The user sees no new error. The log line records `topicCheck: "error"`, `"unparsed"` or `"skipped"`, and on `error` a `topicCheckCode` (the `LLM_*` code, `timeout` or `unknown`; never error text). The check has no retries and no fallback provider, and its output is capped at 64 tokens (gpt-oss spends part of it on reasoning).
4. **Answer cap and daily budget.** `LLM_MAX_OUTPUT_TOKENS` (1024) caps every main-model answer; a reply cut at the cap ends with ` (Answer shortened.)`. `CHAT_DAILY_TOKEN_BUDGET` (50000, 0 = unlimited) is per user and per day; the day is the calendar day in `STORE_TIMEZONE`, resetting at 00:00 there. It is checked **before** a turn (`429 CHAT_BUDGET_EXCEEDED`, `Retry-After` = seconds to the reset); a turn that starts under the limit may finish over it. Topic-check and main-model tokens are both counted, including those of a turn that ended in an LLM error or a timeout. Admins have the same budget.

Usage is stored in `chat_usage_daily(user_id, day, total_tokens, turns)`, one row per user and day, updated by one atomic upsert-increment (migration `0002_chat_usage_daily`). Rows are deleted with the user.

## Alternatives considered

- **Prompt only.** Free and always on, but a model that is following a long tool-use prompt drifts: it answers code requests anyway, and the answer is still paid for in full. Kept as layer 1, not as the only layer.
- **Keyword or regex filters.** Cheap and deterministic, but "code", "translate" or "joke" also appear in on-topic messages ("tax code", "translate the product title"), and any list is trivially bypassed by rewording.
- **Embeddings and a similarity threshold.** Needs a second provider or a local model and a labelled set of examples; short follow-ups ("and the second one?") have no useful embedding on their own.
- **A classifier call on every message with the main model.** Accurate, but doubles the cost of the largest prompt. A small model with a one-word answer costs a few hundred tokens.
- **Request-count limits only.** The existing 10 turns a minute does not bound tokens: a turn with four tools costs about 9K.

## Consequences/trade-offs

- Each turn pays one extra call, a few hundred tokens and (expected from the model's size) a fraction of a second to a second; the log records `topicCheckMs` so this can be measured.
- A false refusal is possible; the user sees the refusal text and rephrases.
- **The topic check stops casual misuse, not a determined user.** The scope rule, the answer cap and the daily budget are the real bounds. The conversation history is supplied by the browser (the server is stateless), so a forged assistant turn, for example an offer worded to look on-topic followed by "yes, go ahead", can get an off-topic request past the check; so can a cleverly worded message, or one that makes the check model reason past its 64-token cap (an empty reply allows the turn). A determined jailbreak of the main model is likewise bounded by the cap and the budget, not prevented (see [security.md](../security.md)). Most off-topic messages are refused before the main model runs; that is the claim, not "all".
- The check is a shared dependency on the Groq quota: at 8K tokens a minute it can itself be rate limited, which is why it fails open.
- A budget that is tracked per user also bounds what one compromised session can spend.
- Limits are checked before the turn, so one turn can overshoot by up to its own cost.

## Revisit if

- False refusals are reported for on-topic messages: re-run the probe (`scripts/dev/topic-probe.mjs`, after `npm run build -w @urumi/gateway`) with the new case.
- Server-side conversation history or signed assistant turns are added: then a forged assistant turn can no longer steer the follow-up rule, and the check can be relied on more.
- The provider changes its limits, or a paid plan removes the need for the per-user budget.
