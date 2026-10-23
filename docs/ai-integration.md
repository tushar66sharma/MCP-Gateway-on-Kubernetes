# AI integration (the chat agent's LLM layer)

> **Status (end of Phase 4).** Built and verified on the local cluster: the provider-independent LLM layer in `apps/gateway/src/chat/llm/`, the Groq configuration (default model `openai/gpt-oss-120b`), the `llm-api-keys` Secret pushed by `scripts\create-secrets.ps1`, and live chat turns through the dashboard (2026-10-19, 2026-10-20, and 2026-10-22 after the final-review fix wave). The **OpenRouter** configuration was exercised only by the model spike (`scripts/dev/llm-probe.mjs`, 2/2 correct tool calls); the gateway's **fallback path** is covered by unit tests but was **not tested live** (the local values leave `gateway.llm.fallbackProvider` empty). Free-tier limits below were read from the providers' pages on 2026-10-19 and **change without notice**.

Evidence labels: **live** = run against the k3d cluster or the real provider; **tested** = pinned by an automated test ([testing.md](testing.md)); **expected** = follows from the code, not run.

Related: the decision is [ADR-011](decisions/ADR-011-llm-provider-abstraction.md); how a chat turn reaches the tools is [ADR-010](decisions/ADR-010-chat-agent-loopback.md) and [workflow 15](workflows.md#15-a-chat-turn-tool-loop-retries-and-fallback); a captured request and response with every field explained is [learning/04-chat-agent.md](learning/04-chat-agent.md); setting it up step by step is the run guide's [Set up the AI chat](run-guide.md#set-up-the-ai-chat).

Contents: [1. The layer](#1-the-layer) | [2. Configuration](#2-configuration) | [3. Getting a free key](#3-getting-a-free-key) | [4. Putting keys in place, switching, adding a provider](#4-putting-keys-in-place-switching-and-adding-a-provider) | [5. Limits and token budget](#5-limits-and-token-budget) | [6. The model spike](#6-the-model-spike) | [7. Failures](#7-failures-retries-deadline-and-fallback) | [8. Privacy and prompt injection](#8-privacy-and-the-residual-prompt-injection-risk)

## 1. The layer

The chat agent never talks to a provider directly. It calls one small interface, and the provider is a configuration of one adapter.

```mermaid
flowchart LR
  R["POST /api/chat<br/>api/chat.routes.ts"] --> S["chat service<br/>chat/service.ts"]
  S --> A["agent loop<br/>chat/agent.ts"]
  A -- "LlmProvider.chat()" --> REG["registry<br/>primary + optional fallback"]
  REG --> P1["OpenAI-compatible adapter<br/>configured for Groq"]
  REG -.->|"once, on 429 or unavailable"| P2["OpenAI-compatible adapter<br/>configured for OpenRouter"]
  P1 -- "HTTPS POST /chat/completions" --> G[("api.groq.com")]
  P2 -- "HTTPS POST /chat/completions" --> O[("openrouter.ai")]
  A -- "tools/list, tools/call" --> L["MCP loopback client<br/>chat/mcpLoopback.ts"]
```

**Reading the diagram.** The route validates the request and the service applies the per-user limits; the agent loop is the only code that uses the model. It sees `LlmProvider` and nothing else, so it does not know which provider answers. The registry wraps the primary provider and, when configured, a fallback that is tried once. Both are the same adapter class with different settings. Tool calls go the other way, through the gateway's own `/mcp` ([ADR-010](decisions/ADR-010-chat-agent-loopback.md)).

### File map

| File | Holds | Provider-specific? |
|---|---|---|
| `apps/gateway/src/chat/llm/types.ts` | `ChatMessage`, `ToolCall` (`arguments` is the model's raw JSON text), `ToolSpec`, `Usage`, `LlmChatRequest {messages, tools, signal, deadline}`, `LlmChatResult {message, toolCalls, usage?, provider, model}`, `LlmProvider {name, model, chat()}` | no |
| `apps/gateway/src/chat/llm/errors.ts` | `LlmError` with `code`, `retryAfterSec?`, `provider?`, `httpStatus?`, `providerCode?` (only when it matches `^[a-z_]{1,40}$`), `fallbackProvider?`, `fallbackCode?`. Messages are fixed text; a provider's body never becomes a message. | no |
| `apps/gateway/src/chat/llm/providers.ts` | The provider table: base URL, default model, which key variable, optional extra headers and body fields, and body fields per model pattern | **yes, data only** |
| `apps/gateway/src/chat/llm/openaiCompatible.ts` | The one adapter: builds the request, classifies the answer, retries with backoff, honours `retry-after`, never sleeps past the deadline | the wire format only |
| `apps/gateway/src/chat/llm/registry.ts` | `createLlmFromConfig` (primary plus optional one-shot fallback, `null` when the primary has no key) and `llmStatusOf` (what `GET /api/chat/status` returns) | no |
| `apps/gateway/src/config.ts` | Validates every variable in [section 2](#2-configuration); refuses a fallback equal to the primary | no |
| `apps/gateway/src/main.ts` | Builds the provider at start and logs `llm configured: <provider>/<model>` or `llm not configured: chat is disabled (no API key for the provider)` | no |
| `chat/agent.ts`, `chat/service.ts`, `chat/systemPrompt.ts`, `chat/mcpLoopback.ts`, `api/chat.routes.ts` | The tool loop, limits, prompt, loopback client and HTTP route (see [workflow 15](workflows.md#15-a-chat-turn-tool-loop-retries-and-fallback)) | no |

### The request and response format

Every call is `POST <baseUrl>/chat/completions` with `Authorization: Bearer <key>` and a JSON body (real call captured on 2026-10-20, trimmed; the full exchange is in [learning/04-chat-agent.md](learning/04-chat-agent.md#4-the-wire-format-a-real-captured-turn)):

```json
{
  "model": "openai/gpt-oss-120b",
  "messages": [
    { "role": "system", "content": "You are the assistant inside the Urumi MCP Gateway dashboard. ..." },
    { "role": "user", "content": "Use the calculator: what is 6 times 7?" }
  ],
  "tools": [
    { "type": "function", "function": { "name": "utils__calculate", "description": "[Utilities] Evaluate arithmetic: + - * / % ^ and parentheses, decimals allowed.", "parameters": { "type": "object", "properties": { "expression": { "type": "string", "minLength": 1, "maxLength": 200 } }, "required": ["expression"] } } }
  ],
  "tool_choice": "auto",
  "temperature": 0.2,
  "max_completion_tokens": 2048,
  "reasoning_effort": "low"
}
```

- `tools` holds all 15 gateway tools as the user sees them, each description cut to 300 characters (the longest today is 137, so nothing is cut).
- `reasoning_effort: "low"` is added **only for model ids matching `^openai/gpt-oss-`** (`modelExtraBody` in `providers.ts`); other Groq models may reject it (**tested**: `sends reasoning_effort only for gpt-oss models`).
- The adapter reads `choices[0].message.content`, `choices[0].message.tool_calls[].{id, function.name, function.arguments}` and `usage.{prompt_tokens, completion_tokens, total_tokens}`. Anything else (Groq's `reasoning`, `x_groq`, timings) is ignored. A response without a usable `message`, or with a `tool_calls` entry that has no string `name` or `arguments`, is `LLM_BAD_RESPONSE`.
- Tool results go back as `role: "tool"` messages with the matching `tool_call_id`, wrapped as `<tool_result name="...">…</tool_result>` and cut to 6,000 characters.
- Redirects are not followed (`redirect: 'manual'`), so the bearer key cannot be forwarded to another host.

## 2. Configuration

In the cluster these are set by the Helm chart (`charts/urumi-platform/templates/gateway/gateway.yaml`); the keys come from the Secret `llm-api-keys`, never from a values file. Out of the cluster (tests, a local run) the gateway reads them from its environment. The gateway refuses to start when a value is out of range and names the variable, never the value.

| Variable | Helm value | Default | Allowed | Meaning |
|---|---|---|---|---|
| `LLM_PROVIDER` | `gateway.llm.provider` | `groq` | `groq`, `openrouter` | The primary provider. |
| `LLM_MODEL` | `gateway.llm.model` | `""` | any id | Model id at the provider; empty means the provider's default (Groq `openai/gpt-oss-120b`, OpenRouter `nvidia/nemotron-3-super-120b-a12b:free`). |
| `LLM_BASE_URL` | `gateway.llm.baseUrl` | `""` | empty or an `http:`/`https:` URL (any other scheme stops the gateway at start-up, naming only the variable; **tested**) | Overrides the primary's API URL (for example a compatible proxy). The fallback always uses its own default URL. With `http:`, the API key travels unencrypted, so use it only for a proxy on the same machine or cluster. |
| `LLM_FALLBACK_PROVIDER` | `gateway.llm.fallbackProvider` | `""` | `""`, `groq`, `openrouter` | Tried once when the primary is rate limited or unavailable. Must differ from `LLM_PROVIDER` (the gateway and the chart both refuse otherwise). |
| `LLM_FALLBACK_MODEL` | `gateway.llm.fallbackModel` | `""` | any id | Empty means the fallback provider's default. |
| `GROQ_API_KEY` | Secret `llm-api-keys` | `""` | | Empty means "not configured". |
| `OPENROUTER_API_KEY` | Secret `llm-api-keys` | `""` | | Empty means "not configured". |
| `LLM_TIMEOUT_MS` | `gateway.llm.timeoutMs` | `30000` | 5000-120000 | Timeout of **one** HTTP request to the provider. |
| `LLM_MAX_RETRIES` | `gateway.llm.maxRetries` | `2` | 0-5 | Retries of the primary per model call (so at most 3 attempts). |
| `CHAT_TURN_TIMEOUT_MS` | `gateway.chat.turnTimeoutMs` | `60000` | 10000-120000 | The whole turn, model calls and tool calls included. |
| `CHAT_MAX_STEPS` | `gateway.chat.maxSteps` | `8` | 1-16 | Model responses with tool calls per turn. |
| `CHAT_RATE_LIMIT_PER_MIN` | `gateway.chat.rateLimitPerMin` | `10` | 1-120 | Turns per user per minute. |
| `LLM_MAX_OUTPUT_TOKENS` | `gateway.llm.maxOutputTokens` | `1024` | 256-4096 | Output cap on every main-model call (section 9). |
| `CHAT_TOPIC_CHECK` | `gateway.chat.topicCheck` | `true` | `true`, `false` | The on-topic check before each turn (section 9). |
| `CHAT_TOPIC_CHECK_MODEL` | `gateway.chat.topicCheckModel` | `""` | any id | Empty means Groq `openai/gpt-oss-20b`; on OpenRouter the main model. |
| `CHAT_TOPIC_CHECK_TIMEOUT_MS` | `gateway.chat.topicCheckTimeoutMs` | `5000` | 1000-15000 | Timeout of the check; no retries, no fallback provider. |
| `CHAT_DAILY_TOKEN_BUDGET` | `gateway.chat.dailyTokenBudget` | `50000` | 0-10000000 | Tokens per user per day; 0 is unlimited (section 9). |
| `STORE_TIMEZONE` | `storeSetup.timezone` | `UTC` (chart: `Asia/Kolkata`) | an IANA zone | The zone the system prompt uses for "today" and "this week". |

Which Secret the keys come from: `llm-api-keys` in namespace `gateway`, or the name in `secrets.existing.llmApiKeys`. The reference is `optional: true`, so a missing Secret never blocks the gateway pod; chat then answers `LLM_NOT_CONFIGURED` (**live**: before the Secret existed the log said `llm not configured: chat is disabled`). `scripts\create-secrets.ps1` always writes the name `llm-api-keys` (a known limitation: it does not read `secrets.existing.llmApiKeys`).

`GET /api/chat/status` (any logged-in user) returns `{configured, provider, model, fallbackProvider, topicCheck, budget}` and never key material (**tested**). `topicCheck` is true when the check model is configured; `budget` is `{limit, used, remaining, resetsAt}` for the calling user today, or `null` when `CHAT_DAILY_TOKEN_BUDGET` is 0 (**tested**). The dashboard's Chat page uses it to show the "not configured" state or the provider badge.

`.env.example` lists the variables a developer fills in; only the two keys are read from `.env` by `create-secrets.ps1`, the rest are Helm values for the cluster.

## 3. Getting a free key

Never paste a key into a chat, an issue, a commit or a screenshot. Each key below is shown **once** by the provider's console.

**Groq (primary, needed for chat).**

1. Open <https://console.groq.com/> and sign in (Google, GitHub or email). The free plan needs no card (as of 2026-10-19).
2. Go to **API Keys** (<https://console.groq.com/keys>) and press **Create API Key**. Give it a name such as `urumi-local`.
3. Copy the key straight into `.env` as `GROQ_API_KEY=` followed by the key (no quotes needed). You cannot see it again; if you lose it, delete it in the console and create a new one.

**OpenRouter (optional fallback).**

1. Open <https://openrouter.ai/> and sign in.
2. Open **Keys** (<https://openrouter.ai/settings/keys>) and press **Create Key**. A credit limit is optional; free (`:free`) models cost nothing.
3. Put it in `.env` as `OPENROUTER_API_KEY=`. It is only used when you set `gateway.llm.fallbackProvider: openrouter` (or make OpenRouter the primary).

No Google or Gemini key is used anywhere in this project (CLAUDE.md rule).

## 4. Putting keys in place, switching and adding a provider

### Keys into the cluster

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-secrets.ps1
```

1. The script reads only `GROQ_API_KEY` and `OPENROUTER_API_KEY` from the repository's `.env` (comments and every other line are ignored; an `export ` prefix, quotes and an unquoted ` # comment` are handled). It prints only `set` or `empty` for each.
2. It refuses to run if both are empty, or if the namespace does not exist.
3. It builds the Secret `llm-api-keys` in memory and pipes it to `kubectl apply --server-side`. **Server-side apply** matters: a client-side `kubectl apply` would store the plaintext keys in the `last-applied-configuration` annotation, which `kubectl describe` prints (**live**: the Secret has no such annotation). Both keys are always written, an empty one as `""`, so removing a key from `.env` also clears it in the cluster.
4. It restarts the gateway (`kubectl rollout restart` and waits for the rollout), because a pod reads Secret values into its environment only when it starts. Add `-NoRestart` to skip this; `-EnvFile` and `-Namespace` choose another file or namespace.
5. Check the result: `kubectl -n gateway logs deploy/gateway | Select-String "llm "` should show `llm configured: groq/openai/gpt-oss-120b` (**live**, 2026-10-19).

The full beginner walk-through is the run guide's [Set up the AI chat](run-guide.md#set-up-the-ai-chat).

### Switching provider or model

The provider and model are Helm values, not secrets. Edit `deploy/values-local.yaml`:

```yaml
gateway:
  llm:
    provider: groq                  # groq | openrouter
    model: ""                       # "" = provider default; for example openai/gpt-oss-20b
    fallbackProvider: openrouter    # "" = no fallback
    fallbackModel: ""               # "" = nvidia/nemotron-3-super-120b-a12b:free
```

then redeploy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy
```

The chart schema rejects an unknown provider, a fallback equal to the provider, a `baseUrl` that is not `http(s)`, unknown keys under `gateway.llm` and out-of-range numbers before anything is deployed (**live**: `helm template` with each bad value failed). The new values reach the gateway as environment variables, so the redeploy restarts it (**expected**). Switching changes nothing else: the agent, the API, the dashboard and the audit log are the same for every provider. What can change is the model's behaviour (how reliably it picks tools, how it words replies), which is why a new model should be checked with `scripts/dev/llm-probe.mjs` first (section 6).

### Adding a provider

- **Another OpenAI-compatible provider** (most are): add its id to `ProviderId` and `PROVIDER_IDS` and an entry to `PROVIDERS` in `providers.ts` (base URL, default model, key variable, optional headers or body fields). The key variable then has to be wired where keys are read: the `apiKeyEnv` type and `LlmConfig` in `registry.ts`, the schema in `config.ts`, the `secretKeyRef` in the chart's `gateway.yaml`, the provider enum in `values.schema.json`, and the `$wanted` list in `create-secrets.ps1`. No agent, API or dashboard code changes.
- **A provider with a different wire format:** write one class that implements `LlmProvider` (`name`, `model`, `chat({messages, tools, signal, deadline})` returning `{message, toolCalls, usage?, provider, model}` and throwing `LlmError` with one of the five codes), and choose it in `registry.ts` `build()`. The retry and deadline rules in `openaiCompatible.ts` are the reference behaviour to copy.

Neither path was exercised (no third provider exists); the steps are read from the code.

## 5. Limits and token budget

**Free-tier limits** (from the providers' pages on 2026-10-19; re-check before relying on them):

| Provider | Model | Requests / min | Requests / day | Tokens / min | Tokens / day | Source |
|---|---|---|---|---|---|---|
| Groq (free plan) | `openai/gpt-oss-120b` and `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 | <https://console.groq.com/docs/rate-limits> |
| OpenRouter | any `:free` model | 20 | 50 (1,000 after buying at least 10 credits once) | not published per model | | <https://openrouter.ai/docs/api-reference/limits> |

The Groq row was also confirmed by Groq's own response headers during the capture on 2026-10-20: `x-ratelimit-limit-requests: 1000` (the daily request limit) and `x-ratelimit-limit-tokens: 8000` (**live**). On a 429 Groq sends `retry-after` in seconds. Groq retired `llama-3.3-70b-versatile` for free and developer accounts on 2026-08-16 (<https://console.groq.com/docs/deprecations>), which is why the master plan's spike candidate was replaced (section 6). OpenRouter's free catalogue changes often; the default fallback model is configurable for that reason.

**What a turn costs** (measured on the cluster, 2026-10-19 and 2026-10-20):

- A turn that uses one tool makes **two** model calls (the call that picks the tool, then the answer). Each call carries the system prompt and the 15 tool schemas, about **1.5K prompt tokens**, so a single-tool turn costs about **3.0-3.3K tokens** (for example 3,193 / 87 / 3,280 prompt / completion / total for "create a draft product"; 3,117 / 46 / 3,163 for the calculator turn). Completion is only 45-95 tokens.
- A turn that ran four tools cost **9,057 tokens** (4 steps, 11.8 s).
- The Phase 4 system-prompt fix (plain text, no guessed currency) added about 130 prompt tokens per call (2,966 → 3,117 for the calculator turn).

What that means on Groq's free plan (derived, not a measured limit): 8K tokens per minute allow about **two single-tool turns per minute** before Groq answers 429, and 200K tokens per day about **60 single-tool turns per day**. A four-tool turn needs more than 8K tokens in about a minute and still went through once in testing. The gateway's own per-user limit (10 turns a minute) is therefore not the binding one on this plan.

## 6. The model spike

`scripts/dev/llm-probe.mjs` sends the real 15-tool catalogue (captured from the gateway into `apps/gateway/test/fixtures/gateway-tools.json`) and a system-prompt draft, asks two questions ("Q1: what orders came in today" should call `woo__list_orders`; "Q2: create a draft product" should call `woo__create_product`), and checks only the first tool call (tools are not executed). It reads the key from `.env` and prints only `set`. Run on 2026-10-19 (**live**), no 429s, every call returned arguments that parse:

| Model | Question | Runs correct | Prompt / completion / total tokens per call | `reasoning_effort` |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | Q1 | 3/3 | 1281 / 49 / 1330 | default |
| `openai/gpt-oss-120b` | Q2 | 3/3 | 1288 / 77-80 / 1365-1368 | default |
| `openai/gpt-oss-120b` | Q1 | 3/3 | 1281 / 38 / 1319 | low |
| `openai/gpt-oss-120b` | Q2 | 3/3 | 1288 / 61-64 / 1349-1352 | low |
| `openai/gpt-oss-20b` | Q1 | 3/3 | 1281 / 45 / 1326 | default |
| `openai/gpt-oss-20b` | Q2 | 3/3 | 1288 / 51 / 1339 | default |
| `openai/gpt-oss-20b` | Q1 | 3/3 | 1281 / 32-43 / 1313-1324 | low |
| `openai/gpt-oss-20b` | Q2 | 3/3 | 1288 / 50 / 1338 | low |
| `nvidia/nemotron-3-super-120b-a12b:free` (OpenRouter) | Q1 | 1/1 | 2648 / 56 / 2704 | n/a |
| `nvidia/nemotron-3-super-120b-a12b:free` (OpenRouter) | Q2 | 1/1 | 2657 / 110 / 2767 | n/a |

Totals over the six Groq calls per configuration:

| Configuration | Correct | Total tokens |
|---|---|---|
| `openai/gpt-oss-120b` | 6/6 | 8,088 |
| `openai/gpt-oss-120b`, effort low | 6/6 | 8,007 |
| `openai/gpt-oss-20b` | 6/6 | 7,995 |
| `openai/gpt-oss-20b`, effort low | 6/6 | 7,975 |

**Decision** ([ADR-011](decisions/ADR-011-llm-provider-abstraction.md)): the default Groq model is **`openai/gpt-oss-120b` with `reasoning_effort: low`**. All four Groq configurations were 6/6. The 20b model used about 1% fewer tokens, which is within run-to-run noise; the 120b is the stronger model for multi-step turns at identical free-tier limits. `reasoning_effort: low` kept 6/6 and saved completion tokens, so it is sent, but only for `gpt-oss` models. The prompt was about 1.3K tokens with 15 tools, far below the 6K budget the plan allowed; the gateway's final prompt is about 1.5K (section 5). The OpenRouter model passed both questions once and becomes the default **fallback** model (its tokenizer counts about twice as many tokens for the same prompt). Reverting to the 20b is a one-line change in `providers.ts` or `gateway.llm.model: openai/gpt-oss-20b`.

## 7. Failures, retries, deadline and fallback

### What the user sees

| Code (HTTP) | When | Retried by the gateway? | Chat page shows | Log (`chat turn`, level warn) |
|---|---|---|---|---|
| `LLM_NOT_CONFIGURED` (503) | The primary provider's key is empty. Checked before any MCP connection. | no | The Chat page shows the empty state "The AI provider isn't configured" with a pointer to the run guide (it reads `GET /api/chat/status` first). A send that still gets 503 shows "The AI provider isn't configured." | no turn line; the start-up warning `llm not configured: chat is disabled` |
| `LLM_RATE_LIMITED` (429) | The provider answered 429 and the retries (and the fallback, if any) did not help, the provider asked for a wait over 20 s, or waiting would pass the deadline | yes, up to `LLM_MAX_RETRIES`, honouring a `retry-after` of up to 20 s; a longer `retry-after` (for example a spent daily quota) is not waited for: the fallback is tried at once, if configured | "The AI provider is rate limited. Try again in N seconds." with a countdown; Retry is disabled until it reaches 0. The response always has a `Retry-After` header and `details.retryAfterSec`: the provider's value, or **60 s** when it gave none. | `code`, `provider`, `httpStatus` 429, `providerCode`, `fallbackProvider`/`fallbackCode` when a fallback was tried |
| `LLM_AUTH_FAILED` (502) | The provider answered 401 or 403 (wrong, revoked or expired key) | no | "The AI provider rejected the API key. An admin needs to update it." | `httpStatus` 401/403 |
| `LLM_UNAVAILABLE` (502) | Network error, provider 5xx, request timeout (`LLM_TIMEOUT_MS`) after retries | yes (network and 5xx), then the fallback once | "The AI provider is unavailable right now." | `httpStatus` 5xx or none |
| `LLM_BAD_RESPONSE` (502) | Unparseable body, no usable message, malformed `tool_calls`, any other 4xx. A Groq `400` with `error.code: tool_use_failed` (the model produced a broken tool call) is retried **once** first. | only `tool_use_failed`, once | "The AI returned an unexpected answer. Try rephrasing." | `httpStatus`, `providerCode` such as `tool_use_failed` |

Every error response carries `details.toolCalls`: the tool calls that **already ran** in this turn. The Chat page lists them under "These actions already ran. Check them before asking again, so nothing is created twice." (**tested**: `llm error after a tool call keeps the trace`, `shows executed tool calls on error`). Provider text is never shown; it can echo request content. The request id is shown for support.

**What the next request tells the model** (`toWire` in `apps/dashboard/src/features/chat/useChat.ts`). The failed user turn stays in the thread, and the page records the names and outcomes of the calls that ran (never their arguments or results). Every later request then carries, right after that user turn, a fixed assistant note such as `(The previous request failed after these actions already ran: woo__create_product succeeded. Do not repeat them unless asked.)`. **Retry** in that state does not resend the original request on its own: the note is followed by the user message `Continue from where you stopped.`, so the model continues instead of starting over. A failed turn where no tool ran is followed by the note `(no reply)` when the next message is sent, so two user messages are never sent back to back. Empty messages are never sent (the API rejects them). (**tested**: `after an error with tool calls, the next message carries a note of what already ran`, `retry after a partial run sends the note and does not duplicate the user turn`, `an unanswered turn without tool calls is followed by a no-reply note`, `never sends an empty assistant reply back`.) Whether the model always obeys the note is not guaranteed; the trace and the audit log stay the record of what ran.

Other outcomes of a turn that are not `LLM_*` errors:

| Outcome | HTTP | What the user sees |
|---|---|---|
| Per-user limit (`CHAT_RATE_LIMIT_PER_MIN`, 10) | 429 `RATE_LIMITED` with `Retry-After` | "You're sending messages too quickly." (the seconds are not shown, and Retry stays disabled until they pass; a deferred minor) |
| A second turn while one is running for the same user | 409 `CONFLICT` | "A reply is already being generated." |
| The turn ran out of time (`CHAT_TURN_TIMEOUT_MS`) | 200, `stoppedReason: "timeout"` | The reply "This took too long and was stopped. The actions listed below already ran." plus the trace so far; when no tool call ran, "This took too long and was stopped. No actions ran." (**tested**) |
| The browser disconnected during the turn | none (nobody is listening) | The turn is stopped and logged as `stoppedReason: "client_closed"` (**tested**); the loopback connect is cancelled with it, and a request whose socket is already closed when the handler starts never starts a turn (**tested**) |
| The model's final answer is empty or only whitespace | 200, `stoppedReason: "final"` | The fixed reply "I couldn't produce an answer. Try rephrasing your question." (**tested**), so an empty message never enters the history |
| More than `CHAT_MAX_STEPS` tool steps | 200, `stoppedReason: "max_steps"` | "I stopped after 8 tool steps without a final answer. Try a narrower question." |
| A tool failed (`isError`, bad arguments, unknown tool) | 200 | The trace row shows **Failed** with the preview; the model is told and usually explains. Not an `LLM_*` error. |
| Loopback connect or `tools/list` failed (rare) | 500 `INTERNAL` | The generic error with a request id (a deferred minor: not mapped to a friendlier code) |

### The retry rules (as built in `openaiCompatible.ts`)

- **Retryable:** a network error (not caused by the caller's abort), HTTP 429, HTTP 5xx, and a 400 `tool_use_failed` once. **Not retryable:** 401/403, any other 4xx, an unparseable or unusable body.
- **Attempts:** at most `1 + LLM_MAX_RETRIES` (3 by default). The one `tool_use_failed` retry uses an attempt from that budget, so with `LLM_MAX_RETRIES=0` nothing is retried.
- **Wait:** `retry-after` seconds when the provider sent one, up to **20 s**; otherwise exponential backoff `500 ms × 2^attempt` plus up to 250 ms of random jitter.
- **A wait over 20 s is not retried.** A `retry-after` above 20 s (Groq sends one when the daily quota is spent) fails the call at once with `LLM_RATE_LIMITED` and the provider's own `retryAfterSec`, without sleeping. The registry then tries the fallback immediately, if one is configured, and otherwise the client gets the true `Retry-After` (**tested**: `fails fast when retry-after is above the 20 s cap`, and the registry's `uses the fallback at once when the primary asks for a long wait`). Before the Phase 4 final review such a wait was capped at 20 s and retried twice, which cost about 40 s per message.
- **Deadline:** every call receives the turn's deadline. If `now + wait` would reach it, the error is returned **at once** instead of sleeping, so a `retry-after: 50` with 20 s of the turn left gives an immediate `429` with `Retry-After: 50` (**tested**: `does not sleep past the deadline`). Each HTTP request also has its own `LLM_TIMEOUT_MS` timeout and is aborted when the turn's signal aborts (a closed browser tab or the turn timeout); that abort is never retried.
- **Fallback** (`registry.ts`): tried **once, with no retries**, only after the primary failed with `LLM_RATE_LIMITED` or `LLM_UNAVAILABLE`, only when the fallback's key is set and the turn was not aborted. If the fallback fails too, the **primary's** error is reported (it carries the provider's `retry-after`), with `fallbackProvider` and `fallbackCode` added for the log (**tested**: a failing fallback with `LLM_MAX_RETRIES` 2 makes 3 primary requests and exactly 1 fallback request). Limitation: a fallback model may call tools differently; it is best-effort.
- **No retries above the provider call.** The agent never repeats a model call or a tool call. A tool call is never retried anywhere (a retry could repeat a write such as `woo__create_product`).

### Diagnosing

Each turn writes one `chat turn` log line: on success (info) `userId, steps, tools, stoppedReason (`final`, `max_steps`, `timeout` or `client_closed`), durationMs, usage, provider, model`; on an `LLM_*` error (warn) `userId, steps, tools, code, provider, httpStatus, providerCode, fallbackProvider, fallbackCode, durationMs, usage`; on any other error `code: INTERNAL` and the error class. Message content, tool arguments and keys are never logged (**tested**: message text and JWT-shaped strings are absent from the logs). Read it with `kubectl -n gateway logs deploy/gateway | Select-String "chat turn"`. Fixes for each code: [troubleshooting](troubleshooting.md#chat-says-the-ai-provider-isnt-configured).

## 8. Privacy and the residual prompt-injection risk

- **The conversation lives only in the open Chat page.** It is kept in React state, never in browser storage or on the server. Leaving the Chat page (for example to open the Audit log), reloading it or pressing **New conversation** ends the conversation, and a turn that is still running is cancelled in the browser. The gateway stops a turn when its response is closed (**tested**), but a tool call that had already started is not undone, and a turn whose cancellation arrives late may still finish on the gateway (a deferred minor). The audit log (source **Chat**) shows every tool call such a turn ran.
- **What leaves the cluster.** The chat messages, the system prompt (which names the user and the store's time zone), the tool schemas and every tool result of the turn are sent to the provider (Groq, or OpenRouter when it is used). Tool results can contain store data such as customer names and order totals. Do not use the chat with data you may not share with that provider; read its data policy. The gateway itself does not log message content.
- **Untrusted text.** Tool results and tool descriptions come from upstream servers (and, through `woo__*`, from anything a shopper typed into an order). They reach the model inside `<tool_result>` blocks; a result that contains `<tool_result` or `</tool_result` has it rewritten to `tool-result`, so it cannot close its own block; the match ignores case and allows whitespace inside the tag, so `</TOOL_RESULT>`, `</tool_result >`, `< /tool_result>` and `<tool_result` plus a line break `>` are rewritten too (**tested**: `neutralises case and whitespace variants of the tool_result tags`); the tool name in the attribute keeps only `[A-Za-z0-9_-]`; and the system prompt says text inside those blocks and in tool descriptions is untrusted data, never instructions.
- **What can still go wrong (residual risk, accepted).** A model can still be persuaded by text in a tool result to call another tool. The damage is bounded by the user: every call goes through `/mcp` as that user, with that user's access, is visible in the trace, and is audited with source **Chat**. There is no confirmation step before a write; "change data only when the user asked" is a prompt rule, not an enforced one. The full threat model is Phase 6 (`threat-model.md`, planned).

## 9. Guardrails: scope, topic check, answer cap and daily budget (Phase 5b)

Why: the chat runs on one shared free quota (section 5), so it must not become a general chatbot, and one user must not spend all of it. Decision and alternatives: [ADR-020](decisions/ADR-020-chat-guardrails.md).

**The four layers, in the order a turn meets them:**

| # | Layer | Default | What it does | Where |
|---|---|---|---|---|
| 1 | **Budget check** | 50,000 tokens per user per day | After the rate limit and the in-flight check: if the user's tokens today are at or over the limit, `429 CHAT_BUDGET_EXCEEDED` and no model is called. | `chat/service.ts`, `chat/usageRepo.ts` |
| 2 | **Topic check** | on | A small model sees the last user message and up to 500 characters of the previous assistant message and answers `ALLOW` or `BLOCK`. `BLOCK` returns the refusal (HTTP 200, `stoppedReason: "off_topic"`, no tools); the main model is not called. | `chat/topicCheck.ts` |
| 3 | **Scope rule** | always | One line in the main system prompt tells the model to reply with exactly the refusal text for anything else. | `chat/systemPrompt.ts` |
| 4 | **Answer cap** | 1024 tokens | `LLM_MAX_OUTPUT_TOKENS` on every main-model call. A final reply cut at the cap (`finish_reason: length`) ends with ` (Answer shortened.)`. | `chat/llm/*`, `chat/agent.ts` |

The refusal text is fixed: `I can only help with this store, your notes and small utility tasks (calculations, dates and times) in this dashboard.`

**Topic check details.**

- Model: the primary provider only (Groq `openai/gpt-oss-20b`; OpenRouter: the main model), no retries, no fallback, `CHAT_TOPIC_CHECK_TIMEOUT_MS` (5000 ms), output capped at 64 tokens because gpt-oss spends output tokens on reasoning. The system prompt is the one validated by the Task 5b.1 probe (28 cases, `scripts/dev/topic-probe.mjs`).
- Input: `<previous_assistant>...</previous_assistant>` (omitted when there is none) and `<user_message>...</user_message>`, as one user message. Tag-like text inside either is neutralised so a message cannot close its block (**tested**).
- Verdict: the first word, upper-cased, letters only. `BLOCK` blocks, `ALLOW` allows, anything else (including an empty reply) allows.
- **Fail-open rule.** A thrown error (rate limit, timeout, 5xx), an unrecognised or empty reply, or no check model: the turn runs and only layer 3 guards it. The user sees no new error; the `chat turn` log line says `topicCheck: "error"`, `"unparsed"` or `"skipped"` (**tested** with a scripted model).

**What is counted.** Total tokens reported by the provider for the topic check **and** every main-model call of the turn, including turns that ended in an `LLM_*` error (the usage before the failure) or in a timeout (**tested**: `usage of a failed turn is counted`; the timeout path itself is not separately tested). A turn that starts under the limit may end over it; the next turn is refused (**tested**). Refusing an off-topic message costs only the check. Tokens are added with one atomic upsert-increment per turn into `chat_usage_daily` (**tested** with two concurrent calls). Admins have the same budget.

**The budget day** is the calendar day in `STORE_TIMEZONE` (the chart passes `storeSetup.timezone`, `Asia/Kolkata` locally) and resets at 00:00 there, daylight saving included (**tested** for Asia/Kolkata, UTC and America/New_York). The 429 carries `Retry-After` (seconds to the reset) and `details: {limit, used, resetsAt}`.

**Limits of these guardrails.**

- A determined jailbreak can still get an answer from the main model (layer 3 is a prompt); it is bounded by the 1024-token cap and the daily budget, not prevented.
- A false refusal is possible (the user rephrases). The probe required 100 % of its allowed prompts to pass; that is a sample, not a proof.
- The check shares the Groq quota (8K tokens a minute); under pressure it is rate limited and fails open.
- The budget counts what the provider reports. A call without usage counts as 0.

**Verified live on the local cluster, 2026-10-23** (Groq, `openai/gpt-oss-120b` main, `openai/gpt-oss-20b` check; 3 chat turns in total):

- With the budget set to 1000: "Use the calculator: what is 6 times 7?" - the check allowed it (783 ms), `utils__calculate` ran, the reply was "- 42", 3,275 tokens for the main model; the budget used was then 3,534 (check included).
- The next request: `429 CHAT_BUDGET_EXCEEDED`, `Retry-After: 29322` (seconds to 00:00 Asia/Kolkata), `details {limit: 1000, used: 3534, resetsAt}`, no model called.
- Budget restored to 50,000. "give me the code of binary search": the check **timed out** after 5.0 s (`topicCheck: "error"`, fail open) and the scope rule in the main prompt refused it with the exact refusal text (13.1 s, 1,629 tokens). The cause of the timeout was not investigated.
- The same message again: `off_topic`, the refusal text, model `openai/gpt-oss-20b`, 256 tokens, check 757 ms, main model not called.
- Not tested live: OpenRouter as the primary or as the check model; a check that returns an unrecognised reply; the reset at midnight on the real clock; `scripts\check-dashboard.ps1` (its chat prompt is the calculator turn above, which passed through the API).
