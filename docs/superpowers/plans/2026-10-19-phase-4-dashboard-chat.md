# Phase 4 — Dashboard + Chat Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A polished, responsive React dashboard at `http://app.localhost/` that lets admins and members do everything the Phase 3 API offers (log in, accept invites, manage servers, keys, team and invites, read the audit log), plus a chat page where an LLM agent answers questions by calling the gateway's MCP tools **as the logged-in user**, audited as `source = chat`.

**Architecture:**
- **LLM layer (gateway, `src/chat/llm/`).** One `OpenAICompatibleProvider` (fetch to `${baseUrl}/chat/completions`) configured for **Groq** (primary) or **OpenRouter** (fallback). It retries 429/5xx with backoff, honours `retry-after`, never sleeps past the turn deadline, and normalises every failure to an `LlmError` code. Nothing outside `src/chat/llm/` knows which provider is active (CLAUDE.md §2).
- **Agent (gateway, `src/chat/`).** `POST /api/chat` runs one turn: it opens a real MCP client to the gateway's own `/mcp` over `127.0.0.1` (ADR-010), authenticating with a freshly minted 300 s internal token **per request**. Then it loops LLM → tool calls → LLM, up to 8 steps, 60 s per turn, with tool results truncated to 6,000 characters and wrapped as untrusted data.
- **Dashboard (`apps/dashboard`).** React 19 + Vite + Tailwind 4 + Radix primitives + TanStack Query, with a typed `apiFetch`. It is served by `nginx-unprivileged` from its own pod. The `app.localhost` Ingress routes `/api` and `/mcp` to the gateway and `/` to the dashboard, so the browser stays same-origin and the Phase 3 CSRF and cookie rules work unchanged.

**Tech Stack:** As Phase 3, plus React 19.3.1, react-router 8.5.0, Vite 8.3.4, @vitejs/plugin-react 6.1.2, Tailwind CSS 4.3.3 (+ @tailwindcss/vite 4.3.3), radix-ui 1.8.1, @tanstack/react-query 5.104.4, lucide-react 1.59.0, clsx 2.1.1, @fontsource-variable/inter 5.3.0, Vitest 5.0.5 + jsdom 30.1.3 + @testing-library/react 16.3.3 + user-event 14.6.8 + jest-dom 7.0.1, @playwright/test 1.64.1, eslint-plugin-react-hooks 7.1.1, `nginxinc/nginx-unprivileged:1.30.6-alpine`.

**Spec:** [`docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`](../specs/2026-10-18-mcp-gateway-design.md) (§6.2 `POST /api/chat`, §6.9, §6.10, §7, §8.3, §8.4 `llm-api-keys`, §8.5, §8.7, §9, §10, §11). The master plan is [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md): the Phase 4 tasks, "Interface notes from Phase 3 (as built)" and the Phase 4 carry-forward list are binding. ADRs 010 and 011.

**Pre-flight research (done while writing this plan, 2026-10-19, from the providers' official pages):**
- **Groq** (`https://api.groq.com/openai/v1`, OpenAI-compatible `tools` / `tool_calls`). Production models are `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`. The rate-limits page lists **30 RPM / 1K RPD / 8K TPM / 200K TPD** for both gpt-oss models. `retry-after` (seconds) is sent only on 429.
  - **`llama-3.3-70b-versatile` was shut down for free and developer tiers on 2026-08-16** (deprecations page). The master plan's spike candidate is therefore replaced: the spike compares **`openai/gpt-oss-120b` vs `openai/gpt-oss-20b`**. Groq's gpt-oss models do not support *parallel* tool calls, which the agent loop handles anyway (it executes calls one by one).
  - Groq answers `400` with error code `tool_use_failed` when the model emits a malformed tool call; one retry is the documented remedy.
- **OpenRouter** (`https://openrouter.ai/api/v1`). `:free` models allow **20 RPM and 50 RPD** (1,000 RPD after buying at least 10 credits once). The free tool-capable catalogue changes often; on 2026-10-19 it included `nvidia/nemotron-3-super-120b-a12b:free`, which becomes the default fallback model (configurable). Google models are not used (CLAUDE.md: no Gemini; Gemma is avoided to keep that rule unambiguous).
- **Package versions** above were read from the npm registry on 2026-10-19. The nginx tag is the newest `stable` line (`1.30.6-alpine`).

## Global Constraints

- **Git:** branch `phase-4-dashboard-chat` (created from `main`, which contains merged Phase 3). Several commits per task, conventional prefixes. **Never push. No `Co-Authored-By` or any Claude/AI attribution.**
- **Root path:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes` (spaces, so quote it). **Line endings:** LF, except `*.ps1` (CRLF).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`. The gateway keeps ESM `NodeNext` with `.js` extensions. The dashboard tsconfig overrides `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `lib: [ES2023, DOM, DOM.Iterable]`, `noEmit`. No `any` without an eslint-disable line and a reason.
- **Pinned versions:** exact (`npm install -E`), as in the Tech Stack line. Existing pins stay unchanged.
- **No secrets anywhere visible:** never print, log, return or screenshot LLM keys, API keys, session/invite tokens, passwords, internal tokens or upstream credentials. The only exceptions are the one-time key plaintext and the invite link inside their "shown once" dialogs. **Chat message content is not logged** (privacy); the turn log line has the user id, step count, tool names, outcome, duration and token usage only. Playwright runs with `screenshot: 'off'`, `trace: 'off'`, `video: 'off'`.
- **No Gemini** (API, keys or Google model ids) anywhere.
- **LLM limits (spec §6.9, §6.10):** request timeout `LLM_TIMEOUT_MS` 30000; `LLM_MAX_RETRIES` 2; turn timeout 60000 ms; max 8 tool steps; tool result to the model ≤ 6000 characters; trace `resultPreview` ≤ 500 characters; tool description sent to the model ≤ 300 characters.
- **Chat input bounds:** `messages` 1–20 items, roles `user` | `assistant` only (the client can never send `system` or `tool`), content 1–4000 characters, the last message is from `user`. Per user: 10 turns per minute, and one turn in flight at a time.
- **New API error codes:** `LLM_NOT_CONFIGURED` 503, `LLM_RATE_LIMITED` 429 (with `Retry-After`), `LLM_AUTH_FAILED` 502, `LLM_UNAVAILABLE` 502, `LLM_BAD_RESPONSE` 502. Existing codes are unchanged (spec §6.2).
- **CSRF and cookies are unchanged:** the dashboard is same-origin with the API. `apiFetch` always sends `Content-Type: application/json` on mutating calls; the browser sends `Origin`. **The CSRF guard is never loosened**; the Vite dev server proxies `/api` and `/mcp` to `http://app.localhost` and rewrites `Origin`.
- **Design system (spec §7):** neutral slate surfaces, one indigo accent; status colours always paired with a text label (green connected, red unreachable, grey disabled); Inter (self-hosted via @fontsource, no external font CDN); 4 px spacing scale; light and dark themes via CSS variables (system default plus a manual toggle). Sidebar becomes a drawer below 1024 px; tables become stacked cards below 640 px. WCAG AA contrast, visible focus rings, labelled inputs, focus-trapped dialogs, semantic landmarks.
- **Every data view** has loading (skeleton), empty and error (with retry) states. Destructive actions use `ConfirmDialog`. Forms validate inline. Server status refetches every 10 s.
- **Security headers (HTML responses, nginx):** `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `/.well-known/*` answers 404 (MCP clients probe OAuth metadata there). `/api` responses gain `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
- **Kubernetes (spec §8.5, §8.7):** the dashboard pod runs as uid/gid 101 with `runAsNonRoot`, seccomp `RuntimeDefault`, no service-account token, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `readOnlyRootFilesystem: true` with an emptyDir at `/tmp`, probes on `GET /healthz`, resources 10m/16Mi → 100m/64Mi, port 8080. `llm-api-keys` is referenced with `optional: true`, so a missing Secret never blocks the gateway pod.
- **Docs:** state only what was verified, and label the rest "expected" or "not tested". `docs/run-guide.md` gets dashboard and chat sections. `docs/ai-integration.md` is created. Nothing unbuilt is described as available (NetworkPolicies are Phase 5).
- **Verification commands:**
  - `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`;
  - `helm lint charts/urumi-platform -f deploy/values-local.yaml` (and `-f deploy/values-prod.yaml`);
  - scripts run as `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\<x>.ps1`.

## Review Focus

These five inputs are the most likely to hurt a user and are not exercised by the spec's own examples; each one is pinned by a test in the task named.

1. **A rate-limited provider near the turn deadline** (`retry-after: 50` with 20 s of the turn left). Expected: no sleep past the deadline; an immediate `LLM_RATE_LIMITED` with `retryAfterSec` → `429` with `Retry-After`. Test: Task 4.1 `does not sleep past the deadline`.
2. **The model emits a malformed tool call** (arguments that are not JSON, or a tool name that doesn't exist). Expected: the agent sends a tool error back to the model and records an `error` trace; the turn does not 500. Tests: Task 4.2 `invalid JSON arguments become a tool error` and `unknown tool is reported to the model`.
3. **A provider error after a tool has already run** (for example `woo__create_product` succeeded, then the next LLM call gets a 429). Expected: the error response carries `details.toolCalls` with the executed traces, and the chat page shows them with a "these actions already ran" note, so the user doesn't retry blindly and create a duplicate. Tests: Task 4.2 `llm error after a tool call keeps the trace` and Task 4.6 `shows executed tool calls on error`.
4. **A session that expires while a page is open** (any query gets `401 UNAUTHENTICATED`). Expected: the query cache is cleared and the app redirects to `/login?next=<current path>`, and after login it returns there. A `401` from logout counts as logged out. Tests: Task 4.3 `401 redirects to login with next` and `logout treats 401 as success`.
5. **An admin edits a server's URL to another host while a credential is stored.** Expected: the form detects the origin change and requires a new credential (or an explicit "remove credential") before submitting. A server-side `400 VALIDATION_FAILED` is still shown inline if it happens. Test: Task 4.4 `origin change requires credential`.

---

### Task 4.1: LLM provider layer, configuration and the model spike

**Files:**
- Create: `apps/gateway/src/chat/llm/{types,errors,openaiCompatible,providers,registry}.ts`
- Modify: `apps/gateway/src/config.ts` (LLM and chat settings), `apps/gateway/test/config.test.ts`
- Create: `apps/gateway/test/chat/llm/{openaiCompatible,registry}.test.ts`
- Modify: `scripts/dev/gateway-smoke.mjs` (add `--dump-tools <file>`)
- Create: `apps/gateway/test/fixtures/gateway-tools.json` (the live 15-tool catalogue: names, descriptions, input schemas; no secrets)
- Create: `scripts/dev/llm-probe.mjs` (committed; reused for troubleshooting)
- Modify: `.env.example`

**Interfaces:**
- Produces (used by Tasks 4.2 and 4.7):
```ts
// types.ts
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export interface ToolCall { id: string; name: string; arguments: string }          // arguments = raw JSON text from the model
export interface ChatMessage { role: ChatRole; content: string | null; toolCalls?: ToolCall[]; toolCallId?: string }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface Usage { promptTokens: number; completionTokens: number; totalTokens: number }
export interface LlmChatRequest { messages: ChatMessage[]; tools: ToolSpec[]; signal: AbortSignal; deadline: number }   // deadline = epoch ms the turn must end by
export interface LlmChatResult { message: ChatMessage; toolCalls: ToolCall[]; usage?: Usage; provider: string; model: string }
export interface LlmProvider { readonly name: string; readonly model: string; chat(r: LlmChatRequest): Promise<LlmChatResult> }
// errors.ts
export type LlmErrorCode = 'LLM_RATE_LIMITED' | 'LLM_AUTH_FAILED' | 'LLM_UNAVAILABLE' | 'LLM_BAD_RESPONSE' | 'LLM_NOT_CONFIGURED';
export class LlmError extends Error { readonly code: LlmErrorCode; readonly retryAfterSec?: number; readonly provider?: string }
// providers.ts
export type ProviderId = 'groq' | 'openrouter';
export const PROVIDERS: Record<ProviderId, { baseUrl: string; defaultModel: string; apiKeyEnv: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY'; extraHeaders?: Record<string, string>; extraBody?: Record<string, unknown> }>;
// registry.ts
export interface LlmConfig { LLM_PROVIDER: ProviderId; LLM_MODEL: string; LLM_BASE_URL: string; LLM_FALLBACK_PROVIDER: ProviderId | ''; LLM_FALLBACK_MODEL: string; GROQ_API_KEY: string; OPENROUTER_API_KEY: string; LLM_TIMEOUT_MS: number; LLM_MAX_RETRIES: number }
export interface LlmRuntime { fetch?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; random?: () => number; now?: () => number }
export function createLlmFromConfig(c: LlmConfig, rt?: LlmRuntime): LlmProvider | null;   // null when the primary's key is empty
export function llmStatusOf(c: LlmConfig): { configured: boolean; provider: ProviderId; model: string; fallbackProvider: ProviderId | null };   // no secrets
```
- **Config additions** (`Config` extends `LlmConfig` plus): `CHAT_TURN_TIMEOUT_MS` (60000, 10000–120000), `CHAT_MAX_STEPS` (8, 1–16), `CHAT_RATE_LIMIT_PER_MIN` (10, 1–120), `STORE_TIMEZONE` (default `UTC`, validated with `Intl.DateTimeFormat`). `LLM_PROVIDER` defaults to `groq`. `LLM_MODEL` / `LLM_FALLBACK_MODEL` default `''`, meaning the provider's `defaultModel`. `LLM_BASE_URL` is `''` or a URL. Keys default `''`. `LLM_TIMEOUT_MS` 30000 (5000–120000), `LLM_MAX_RETRIES` 2 (0–5). `LLM_FALLBACK_PROVIDER` is `''` or a provider id different from `LLM_PROVIDER` (superRefine).
- **Wire format** (`openaiCompatible.ts`). The body is `{model, messages, tools: [{type: 'function', function: {name, description, parameters}}], tool_choice: 'auto', temperature: 0.2, max_completion_tokens: 2048, ...extraBody}`. Messages map as follows:
  - assistant → `tool_calls: [{id, type: 'function', function: {name, arguments}}]`;
  - tool → `{role: 'tool', tool_call_id, content}`.

  The `Authorization: Bearer <key>` header goes only to that provider's `baseUrl`. The response parses `choices[0].message` (`content`, `tool_calls`) and `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`). A missing `choices[0]`, or `tool_calls` entries without a string `function.name` and `function.arguments`, become `LLM_BAD_RESPONSE`.
- **Retry policy** (one provider). The retryable failures are:
  - 429;
  - 5xx;
  - a network error or per-request timeout (each attempt has `AbortSignal.any([req.signal, AbortSignal.timeout(LLM_TIMEOUT_MS)])`);
  - a 400 whose body has `error.code === 'tool_use_failed'` (at most once).

  The delay is `retry-after` seconds when present (capped at 20 s), else `500·2^attempt + random()·250` ms. **If `now + delay` would pass `deadline`, throw at once** (no sleep). 401/403 → `LLM_AUTH_FAILED`, which is not retried and not sent to the fallback. Any other 4xx → `LLM_BAD_RESPONSE`. After retries: 429 → `LLM_RATE_LIMITED` (with `retryAfterSec` when known); 5xx, network or timeout → `LLM_UNAVAILABLE`.
- **Fallback** (`registry.ts`). When the primary throws `LLM_RATE_LIMITED` or `LLM_UNAVAILABLE` and a fallback with a non-empty key is configured, the fallback is tried **once, with no retries**. The result says which provider answered.
- `LlmError.message` is fixed text written by us. The provider's response body is never put into a message or a log (it can echo request content). Log the HTTP status and the provider's `error.code` string only, and only when it matches `^[a-z_]{1,40}$`.

- [ ] **Step 1: Write failing tests** in `test/chat/llm/openaiCompatible.test.ts` (fake `fetch`, fake `sleep` that records delays, fixed `random`/`now`):
  - `sends OpenAI tool format`: the body has `tools[0].type === 'function'`, `tool_choice === 'auto'` and the model; an assistant message with toolCalls and a tool message map to `tool_calls` and `tool_call_id`; the Authorization header equals `Bearer test-key`.
  - `parses tool_calls and usage`: the result has `toolCalls[0]` `{id: 'c1', name: 'woo__list_orders', arguments: '{"period":"today"}'}` and `usage.totalTokens === 120`.
  - `retries 429 honouring retry-after`: 429 with `retry-after: 1`, then 200 → resolves, and the sleep was called with 1000.
  - `does not sleep past the deadline`: 429 `retry-after: 50` with `deadline = now + 20000` → rejects `LLM_RATE_LIMITED`, `retryAfterSec === 50`, sleep never called.
  - `401 is LLM_AUTH_FAILED without retry`: fetch called once.
  - `malformed JSON body is LLM_BAD_RESPONSE`, and `missing choices is LLM_BAD_RESPONSE`.
  - `retries tool_use_failed once`: 400 `{error:{code:'tool_use_failed'}}` twice → `LLM_BAD_RESPONSE` after exactly 2 calls.
  - `5xx exhausts retries to LLM_UNAVAILABLE`: 3 calls with `LLM_MAX_RETRIES` 2.
  - `error message never contains the response body`: a 500 body `secret-echo` → `err.message` lacks `secret-echo`.

  In `registry.test.ts`:
  - `returns null without a primary key`;
  - `uses fallback after primary is rate limited`: the result's `provider === 'openrouter'`, and the fallback was called once;
  - `no fallback on auth failure`;
  - `llmStatusOf never includes keys`: the JSON of the result doesn't contain the key strings.

  In `config.test.ts`: the LLM defaults; `LLM_FALLBACK_PROVIDER equal to LLM_PROVIDER is rejected`; `invalid STORE_TIMEZONE names the variable only`.
- [ ] **Step 2: Run** `npm test -w @urumi/gateway -- test/chat test/config.test.ts` and expect FAIL (modules missing).
- [ ] **Step 3: Implement** the five `llm/*.ts` files and the config additions as specified above. `sleep(ms, signal)` rejects when the signal aborts.
- [ ] **Step 4: Run** the same command and expect PASS; then `npm run typecheck` and `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(gateway): add provider-agnostic LLM layer with retries, deadline and fallback`.
- [ ] **Step 6: Capture the tool catalogue.**
  - Add `--dump-tools <file>` to `scripts/dev/gateway-smoke.mjs`: after `tools/list`, write `[{name, description, inputSchema}]` sorted by name, then continue as usual (the key is still revoked and the session logged out in `finally`).
  - Run it against the cluster (admin credentials from the Secret via `check-gateway.ps1`'s environment pattern; nothing printed) to write `apps/gateway/test/fixtures/gateway-tools.json`. Expect 15 entries.
  - Commit `test(gateway): capture the live 15-tool catalogue as a fixture`.
- [ ] **Step 7: The model spike** (needs the user's Groq key in the git-ignored `.env`; **ask the controller to obtain it if `.env` has no `GROQ_API_KEY`**. Never read the key into the conversation).
  - Write `scripts/dev/llm-probe.mjs`. It loads `.env` itself without printing it, takes `--provider`, `--model` and `--runs N`, and sends the fixture's 15 tools (descriptions trimmed to 300 characters) plus the system prompt draft. It asks two questions:
    - Q1 "What orders came in today?" → expect `woo__list_orders` with `period: "today"`.
    - Q2 "Create a draft product called Probe Mug priced 12.50." → expect `woo__create_product` with `name`, `regular_price` and `status: "draft"`.
  - It **does not execute** tools. Per run it prints the model, the question, the tool called, whether the arguments parse and match, and the prompt, completion and total tokens. It never prints the key or headers.
  - Run it 3 times each for `openai/gpt-oss-120b` and `openai/gpt-oss-20b` on Groq. If `OPENROUTER_API_KEY` is set, run once on `nvidia/nemotron-3-super-120b-a12b:free`.
  - **Decision rule:** pick the Groq model with 6/6 correct calls. A tie goes to fewer total tokens. The prompt tokens with all 15 tools must stay under 6,000 (8K TPM headroom); if they don't, lower the description cap and re-measure. Also try `extraBody: {reasoning_effort: 'low'}` for the chosen gpt-oss model; keep it only if correctness stays 6/6.
  - Set `PROVIDERS.groq.defaultModel` and `extraBody` accordingly. Record the table of results (tokens, correctness and date) in the task report for Task 4.9's `docs/ai-integration.md` and ADR-011. Update `.env.example`: `LLM_MODEL` empty means the provider default; keys are pushed by `scripts/create-secrets.ps1` (Task 4.7); remove the "planned" wording.
  - Commit `chore(gateway): pick the default Groq model from the tool-calling spike`.

### Task 4.2: Agent loop, MCP loopback client and `/api/chat`

**Files:**
- Create: `apps/gateway/src/chat/{agent,mcpLoopback,systemPrompt,service}.ts`, `apps/gateway/src/api/chat.routes.ts`
- Modify: `apps/gateway/src/api/{errors,router}.ts`, `apps/gateway/src/server.ts` (`GatewayDeps.llm`, loopback URL), `apps/gateway/src/main.ts` (build `llm` from config, log `llm configured: provider/model` with no key)
- Create: `apps/gateway/test/chat/{agent,systemPrompt}.test.ts`, `apps/gateway/test/api/chat.test.ts`

**Interfaces:**
- Consumes: Task 4.1's `LlmProvider`, `LlmError`, `ToolSpec`, `ChatMessage`, `llmStatusOf`; Phase 3's `mintInternalToken(userId, secret)`, `requireSession`, `currentUser`, `LoginRateLimiter` (reused as a generic fixed-window limiter), `startMcpHttpServer` (`running.port`).
- Produces:
```ts
// mcpLoopback.ts — a real MCP client (@modelcontextprotocol/client 2.3.1) to http://127.0.0.1:<port>/mcp.
export interface McpToolClient { listTools(): Promise<ToolSpec[]>; callTool(name: string, args: unknown, signal: AbortSignal): Promise<{ isError: boolean; text: string }>; close(): Promise<void> }
export function connectLoopback(mcpUrl: string, mintToken: () => Promise<string>): Promise<McpToolClient>;
// agent.ts
export interface AgentToolTrace { name: string; arguments: unknown; outcome: 'success' | 'error'; durationMs: number; resultPreview: string }
export interface AgentTurnResult { reply: string; toolCalls: AgentToolTrace[]; stoppedReason: 'final' | 'max_steps' | 'timeout'; usage: Usage; provider: string; model: string }
export class AgentLlmError extends Error { readonly llmError: LlmError; readonly toolCalls: AgentToolTrace[] }
export function runAgentTurn(o: { history: ChatMessage[]; llm: LlmProvider; mcp: McpToolClient; now: Date; storeTimeZone: string; maxSteps: number; signal: AbortSignal; deadline: number }): Promise<AgentTurnResult>;
// systemPrompt.ts
export function buildSystemPrompt(o: { now: Date; storeTimeZone: string; userName: string }): string;
// service.ts
export interface ChatService { status(): ReturnType<typeof llmStatusOf>; runTurn(user: AuthUser, messages: ChatMessage[], clientSignal: AbortSignal): Promise<AgentTurnResult> }
export function createChatService(deps: GatewayDeps, mcpUrl: () => string): ChatService;
```
- **This changes a master-plan interface:** `connectLoopback` takes `mintToken: () => Promise<string>` instead of one token. The transport's `fetch` mints a fresh 300 s token for **every** HTTP request, so a long turn can never outlive its token (Phase 3 carry-over). `AgentToolTrace` uses `arguments` (spec §6.9 says `args`); align the spec to `arguments` in Task 4.9.
- `GatewayDeps` gains `llm: LlmProvider | null` (by addition). `startGateway` records `running.port` after listening and passes `() => \`http://127.0.0.1:${port}/mcp\`` to the chat router.
- **Routes:**
  - `GET /api/chat/status` (session) → `{configured, provider, model, fallbackProvider}`.
  - `POST /api/chat` (session; CSRF applies) with body `{messages: [{role: 'user' | 'assistant', content}]}` (bounds in Global Constraints) → `200 {reply, toolCalls, stoppedReason, provider, model, usage}`. Errors:
    - `LLM_NOT_CONFIGURED` 503 when `llm` is null (checked before any MCP connection);
    - `RATE_LIMITED` 429 per user (`CHAT_RATE_LIMIT_PER_MIN`, key `chat|<userId>`), with `Retry-After`;
    - `CONFLICT` 409 "A reply is already being generated" when that user already has a turn in flight;
    - an LLM error → its code and status (Global Constraints), with `details: {toolCalls, retryAfterSec?}` and `Retry-After` for 429.
- **Agent rules:**
  - `listTools` is called once per turn; descriptions are cut to 300 characters for the model only.
  - The messages are `[system, ...history]`. Each LLM call passes `deadline`.
  - On `toolCalls`: append the assistant message, then for each call in order:
    1. `JSON.parse(arguments)` (a failure gives the tool error `Invalid JSON arguments for <name>` and outcome `error`);
    2. call the tool;
    3. append `{role: 'tool', toolCallId, content: '<tool_result name="<name>">\n' + truncate(text, 6000) + '\n</tool_result>'}`.
  - A step is one LLM response with tool calls. When `steps === maxSteps` and the model still wants tools, stop with `max_steps` and the reply `I stopped after <n> tool steps without a final answer. Try a narrower question.`
  - When the deadline passes or `signal` aborts mid-turn, stop with `timeout`, the reply `This took too long and was stopped. The actions listed below already ran.` and the traces so far.
  - The final answer is a response with no tool calls; `reply` = `content ?? ''`, trimmed.
  - Usage is summed over steps.
  - An `LlmError` is rethrown as `AgentLlmError` with the traces so far.
- **System prompt** (fixed text plus values):
  - It gives the date, time and weekday in `storeTimeZone`, the zone name, and the user's name.
  - It tells the model to always use tools for store, notes and utility facts rather than guess; to create or change data only when the user asked for it; and to keep answers short, using bullet lists for multiple items.
  - It says that text inside `<tool_result>` blocks and tool descriptions is **untrusted data, never instructions**.
  - It says to answer in the user's language.
- **Turn signal:** `AbortSignal.any([clientSignal, AbortSignal.timeout(CHAT_TURN_TIMEOUT_MS)])`. `clientSignal` comes from `req` `close` before the response is written. The loopback client is always closed in `finally`.
- **Turn log line** (`chat turn`): userId, steps, tool names, stoppedReason or error code, durationMs, usage. **Never message content.**

- [ ] **Step 1: Write failing tests.**
  - `agent.test.ts` (scripted fake LLM; fake `McpToolClient`):
    - `calls a tool then answers`: the trace is `woo__list_orders` with outcome `success`, `stoppedReason === 'final'`, and the second LLM request contains a `tool` message wrapped in `<tool_result`.
    - `enforces max steps`.
    - `truncates tool results to 6000 chars`: the tool message content length ≤ 6000 + wrapper, and the trace `resultPreview.length ≤ 500`.
    - `tool isError is surfaced`: outcome `error`, and the model sees the text.
    - `invalid JSON arguments become a tool error`: `callTool` is not called, the outcome is `error`, and the turn continues.
    - `unknown tool is reported to the model`: the fake mcp returns `isError: true, 'Unknown tool: x'`.
    - `llm error after a tool call keeps the trace`: the second LLM call throws `LLM_RATE_LIMITED`, giving an `AgentLlmError` with 1 trace.
    - `timeout returns partial result`.
    - `descriptions are trimmed for the model`.
  - `systemPrompt.test.ts`: `2026-10-19T20:00:00Z` with `Asia/Kolkata` → the text contains `2026-10-20` and `Asia/Kolkata`, plus the untrusted-data sentence.
  - `api/chat.test.ts` (the Phase 3 test harness with PGlite and fake upstreams; a scripted fake LLM injected as `deps.llm`):
    - `chat calls tools as the session user`: the fake LLM asks for `utils__calculate`, the response is 200 with a trace, and **the audit row has `source = 'chat'`, `user_id` = the session user and `api_key_id` null**;
    - `503 LLM_NOT_CONFIGURED when llm is null`;
    - `401 without session`;
    - `403 CSRF without Origin`;
    - `400 for a system role or 21 messages or last message not user`;
    - `429 after the per-user limit`;
    - `409 when a turn is in flight`;
    - `LLM_RATE_LIMITED maps to 429 with Retry-After and details.toolCalls`;
    - `status endpoint has no key material`;
    - `a disabled user mid-turn gets tool errors, not data` (disable the user between steps; the next loopback call is rejected 401, the trace shows `error`, and the route returns 200 or an error but never tool data).
- [ ] **Step 2: Run** `npm test -w @urumi/gateway -- test/chat test/api/chat.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** the files above. In `errors.ts`, extend `ApiErrorCode` with the five LLM codes. In `router.ts`, mount the chat router, and add `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` to every `/api` response.
- [ ] **Step 4: Run** the gateway suite (all files) **3 times**; expect PASS each time. Then `npm run typecheck` and `npm run lint`.
- [ ] **Step 5: Commit** `feat(gateway): add chat agent tool loop acting as the logged-in user via MCP loopback`.

### Task 4.3: Dashboard foundation: workspace, design system, API client, app shell and login

**Files:**
- Create: `apps/dashboard/{package.json,tsconfig.json,vite.config.ts,vitest.setup.ts,index.html}`, `apps/dashboard/src/{main.tsx,App.tsx,router.tsx}`, `src/styles/{tokens.css,index.css}`, `src/lib/{api.ts,auth.tsx,queryClient.ts,format.ts,theme.ts}`, `src/components/ui/{Button,Input,Select,Textarea,Checkbox,Badge,StatusBadge,Card,Table,ResponsiveTable,Dialog,ConfirmDialog,Toast,EmptyState,ErrorState,Skeleton,CopyField,Spinner,PageHeader,FormField}.tsx`, `src/components/layout/{AppShell,Sidebar,TopBar,MobileNav}.tsx`, `src/pages/{Login,NotFound}.tsx`
- Modify: `eslint.config.js` (a `**/*.tsx` block with `eslint-plugin-react-hooks` recommended rules, plus browser globals for `apps/dashboard`), root `package.json` (nothing new needed beyond the workspace; confirm `npm run build` includes the dashboard), `.gitignore` (`apps/dashboard/dist`, `test-results`, `playwright-report`)
- Create: `apps/dashboard/test/{api,auth,Button,ConfirmDialog,Login}.test.tsx`

**Interfaces:**
- Produces (every page task uses these):
```ts
// lib/api.ts
export class ApiError extends Error { code: string; status: number; requestId?: string; details?: Record<string, unknown>; retryAfterSec?: number }
export function apiFetch<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal }): Promise<T>;  // JSON in/out, credentials 'same-origin', Content-Type JSON on mutating calls; 204 → undefined; non-JSON or network failure → ApiError code 'NETWORK' status 0
export function onUnauthenticated(handler: () => void): () => void;   // apiFetch calls it on 401 UNAUTHENTICATED (never for /api/auth/login)
// lib/auth.tsx
export interface Me { id: string; email: string; name: string; role: 'admin' | 'member' }
export function AuthProvider(p: { children: React.ReactNode }): JSX.Element;
export function useMe(): { me: Me | null; loading: boolean };
export function useLogin(): (email: string, password: string) => Promise<Me>;
export function useLogout(): () => Promise<void>;            // 401 counts as success; clears the query cache
export function RequireAuth(p: { children: React.ReactNode }): JSX.Element;     // /login?next=<path>
export function RequireRole(p: { role: 'admin'; children: React.ReactNode }): JSX.Element;   // members see a 403-style EmptyState
// components/ui
// <StatusBadge status="connected|unreachable|disabled|unknown"/> always renders a text label beside the colour dot.
// <ResponsiveTable columns rows rowKey renderCard/> renders a <table> ≥ 640 px and stacked cards below.
// <ConfirmDialog title body confirmLabel tone="danger" onConfirm/>; Esc and Cancel close it, and focus returns to the trigger.
// toast.success(msg) / toast.error(err: ApiError | string) via <Toaster/>; the error toast shows the requestId.
```
- **Routing** (`router.tsx`, react-router 8 data router):
  - public: `/login`, `/invite/:token`;
  - behind `RequireAuth` inside `AppShell`: `/` Overview, `/servers`, `/servers/:id`, `/keys`, `/audit`, `/chat`, `/team` (`RequireRole admin`);
  - `*` NotFound.

  Pages not built yet in this task render a `PageHeader` plus an `EmptyState` "Coming in this phase" **only until Tasks 4.4–4.6 replace them**. None may remain at the end of Task 4.6.
- **Vite:** dev server `5173`, proxy `/api` and `/mcp` → `http://app.localhost` with `changeOrigin: true` and a `proxyReq` hook that sets `Origin: http://app.localhost`; build `outDir: dist`, `sourcemap: false`. Vitest: `environment: 'jsdom'`, setup imports `@testing-library/jest-dom/vitest`.
- **Visual direction:** invoke the `frontend-design:frontend-design` skill (if available) at the start of this task. Keep spec §7's palette, font and component list, but give it a distinctive, polished enterprise look: clear hierarchy, generous whitespace and consistent radii and shadows. Define every colour as a CSS variable in `tokens.css` for both themes, with an AA-checked accent on both.
- **Login page:**
  - email and password with labels, a show-password toggle, and a submit spinner;
  - error messages: `INVALID_CREDENTIALS` → "Email or password is incorrect"; `RATE_LIMITED` → "Too many attempts. Try again in N seconds" (from `Retry-After`); a network error gets its own message;
  - after login, navigate to `next` (only a same-origin path that starts with `/` and not `//`) or `/`.

- [ ] **Step 1: Scaffold** the workspace with exact pins. `npm install` must update `package-lock.json` and leave the other workspaces' pins unchanged. Add the scripts `dev`, `build` (`tsc -p tsconfig.json && vite build`), `typecheck`, `test` (`vitest run`) and `preview`.
- [ ] **Step 2: Write failing tests:**
  - `api.test.ts`: `maps error JSON to ApiError` (code, status, requestId); `sends JSON content type on DELETE`; `204 returns undefined`; `network failure is NETWORK`; `401 calls onUnauthenticated except for login`; `reads Retry-After into retryAfterSec`.
  - `auth.test.tsx`: `401 redirects to login with next`; `logout treats 401 as success`; `RequireRole hides admin page from member`.
  - `Button.test.tsx`: renders, disabled while loading, has an accessible name.
  - `ConfirmDialog.test.tsx`: focus moves into the dialog; Esc closes it and focus returns to the trigger; Confirm calls `onConfirm`.
  - `Login.test.tsx`: `shows rate limit seconds`; `rejects next=//evil.example`.
- [ ] **Step 3: Run** `npm test -w @urumi/dashboard` and expect FAIL.
- [ ] **Step 4: Implement** the files listed. AppShell:
  - **Sidebar:** links with icons and an active state; Team only for admins.
  - **TopBar:** page title, theme toggle (system / light / dark, stored in `localStorage` inside try/catch), and a user menu with name, role badge and Log out.
  - **Below 1024 px:** a hamburger opens `MobileNav` as a Radix Dialog drawer.
  - **Skip-to-content link,** plus `<header>`, `<nav>` and `<main>` landmarks.
- [ ] **Step 5: Run** `npm test -w @urumi/dashboard`, `npm run typecheck`, `npm run lint` and `npm run build -w @urumi/dashboard`; all must pass. Then the manual check:
  - Start `npm run dev -w @urumi/dashboard` and log in at `http://localhost:5173` against the cluster.
  - Check the shell at 1440 px and 390 px (browser devtools device mode).
  - Note the result in the task report.
- [ ] **Step 6: Commit** `feat(dashboard): add design system, app shell, typed API client and login` (split scaffold, components and login into 2–3 commits).

### Task 4.4: Overview, Servers and Server detail

**Files:**
- Create: `apps/dashboard/src/pages/{Overview,Servers,ServerDetail}.tsx`, `src/features/servers/{api.ts,ServerFormDialog.tsx,serverForm.ts,ToolList.tsx}`, `src/features/audit/RecentCalls.tsx`
- Create: `apps/dashboard/test/{serverForm,ServerFormDialog,Servers}.test.tsx`

**Interfaces:**
- Consumes: Task 4.3's `apiFetch`, `useMe`, UI components; the Phase 3 `ServerView` (docs/system-design.md).
- Produces: `useServers()` (TanStack Query, key `['servers']`, `refetchInterval: 10000`), `useServer(id)`, and `serverForm.ts` with `validateServerForm(values, original?) → Record<field, message>` and `originChanged(oldUrl, newUrl): boolean`.
- **Overview:**
  - stat cards: servers connected / unreachable / disabled and total tools, from `useServers`;
  - a "Recent calls" list (`GET /api/audit?limit=5`: all rows for an admin, the member's own for a member);
  - a quick-start card: the MCP endpoint (`${location.origin}/mcp`) in a `CopyField`, a "Create an API key" button that links to `/keys`, and a "Try the chat" link.
- **Servers:**
  - `ResponsiveTable` columns: name with slug, StatusBadge, tools, last checked (relative time), last error (truncated, full text in a tooltip);
  - row click goes to the detail page;
  - admin only: "Add server" opens `ServerFormDialog`;
  - members see no mutating controls.
- **ServerFormDialog:**
  - **Fields:**
    - slug (create only; `^[a-z][a-z0-9-]{1,15}$`; hint "cannot be changed later");
    - name (1–100);
    - URL (`http://` or `https://`);
    - auth type (none / bearer / header);
    - header name (required for header, `^[A-Za-z0-9-]{1,64}$`);
    - credential (a password input; on edit: "leave blank to keep the current credential");
    - "Remove stored credential" checkbox (edit only, when `hasCredential`);
    - enabled.
  - **On edit, when `originChanged`** and the server has a credential, the credential field becomes required unless "remove" is checked, with an inline explanation.
  - **API errors:** `SSRF_REJECTED` → inline on the URL field (the server's message); `VALIDATION_FAILED` → inline per field when `details` maps fields, else a form-level error; `CONFLICT` → on slug.
- **ServerDetail:**
  - header with name, slug, StatusBadge and actions;
  - admin actions: Edit, Enable/Disable (ConfirmDialog when disabling), Refresh now (`POST /refresh`, toast with the new status), Delete (ConfirmDialog; for seeded slugs `woo`, `notes` and `utils` the dialog says it stays deleted and can be re-added with Add server);
  - an info card: URL, auth type, header name, "Credential stored: yes/no", last checked, last error;
  - `ToolList`: prefixed names with descriptions and a filter box;
  - a warning card listing `skippedTools` when it is non-empty;
  - 404 → an EmptyState "Server not found" with a back link.

- [ ] **Step 1: Write failing tests:**
  - `serverForm.test.ts`: `origin change requires credential`; `path-only change keeps credential`; `header auth needs header name`; `slug pattern`.
  - `ServerFormDialog.test.tsx`: `SSRF_REJECTED shows under URL field`; `blank credential on edit is omitted from PATCH body`; `remove credential sends clearCredential true`.
  - `Servers.test.tsx`: `member sees no Add server`; `renders status labels not only colours`; `empty list shows EmptyState`; `error shows ErrorState with retry`.
- [ ] **Step 2: Run** `npm test -w @urumi/dashboard` and expect FAIL.
- [ ] **Step 3: Implement** the pages and features.
- [ ] **Step 4: Run** the tests (PASS), then typecheck, lint and build. Do a manual dev-server check against the cluster as admin, at 1440 and 390 px:
  - disable then enable `notes` and watch its status;
  - try to add a server at `http://169.254.169.254/mcp` and see the inline SSRF error.
- [ ] **Step 5: Commit** `feat(dashboard): add overview, servers list, detail and admin management`.

### Task 4.5: API keys, Team (users and invites) and invite acceptance

**Files:**
- Create: `apps/dashboard/src/pages/{Keys,Team,AcceptInvite}.tsx`, `src/features/keys/{api.ts,KeyCreatedDialog.tsx,clientSnippets.ts,KeysTable.tsx}`, `src/features/team/{api.ts,UsersTable.tsx,InviteDialog.tsx,InviteCreatedDialog.tsx,InvitesTable.tsx,MemberKeysDialog.tsx}`
- Create: `apps/dashboard/test/{clientSnippets,KeyCreatedDialog,Team,AcceptInvite}.test.tsx`

**Interfaces:**
- Consumes: Task 4.3 components; the API `GET/POST/DELETE /api/keys`, `GET /api/users`, `PATCH /api/users/:id`, `GET/POST /api/users/:id/keys`, `DELETE /api/users/:id/keys/:keyId`, `GET/POST /api/invites`, `DELETE /api/invites/:id`, `GET /api/invites/:token`, `POST /api/invites/:token/accept`.
- Produces: `clientSnippets(mcpUrl: string, key: string): { claudeCode: string; cursor: string; inspector: string }`. The forms:
  - Claude Code: `claude mcp add --transport http urumi-gateway <url> --header "Authorization: Bearer <key>"`;
  - Cursor: the `mcpServers` JSON with `url` and `headers`;
  - Inspector: `npx -y @modelcontextprotocol/inspector@2.11.0 --cli <url> --transport http --header "Authorization: Bearer <key>" --method tools/list`.
- **Keys page:**
  - `ResponsiveTable` of own keys: name, prefix (monospace), created, last used, status (Active / Revoked);
  - "Create key" opens a name input dialog, then `KeyCreatedDialog`.
  - **`KeyCreatedDialog`:**
    - **Copy and snippets:** the key in a `CopyField`, and tabs with the three snippets, each copyable;
    - **Shown-once warning:** "You will not see this key again";
    - **Closing it:** needs an "I have copied the key" confirmation;
    - **No storage:** the plaintext lives only in component state, is dropped on close, and is never written to storage or the query cache;
  - Revoke uses a ConfirmDialog.
- **Team page** (admin):
  - Users table: name, email, role, status, created.
    - Role change: a Select; disabled for yourself, with a tooltip.
    - Disable / Enable: ConfirmDialog saying "signs them out and revokes all their API keys"; disabled for yourself.
    - "Keys…" opens `MemberKeysDialog` (list, issue, revoke). **Issuing is hidden for other admins**; a `409` for a disabled user is shown inline.
  - Invites section:
    - "Invite member" takes an email and a role (member/admin).
    - `InviteCreatedDialog` shows the link once, in a `CopyField`, with "valid for 72 hours, works once".
    - The pending invites table has email, role, expires (relative) and an Expired badge, and a cancel action (ConfirmDialog).
- **AcceptInvite** (`/invite/:token`, public, no AppShell):
  - Loading, then a preview card: "You've been invited as <role>" with the email (read-only).
  - Form: name (1–100), password (10–200), confirm password; inline validation; a show-password toggle.
  - Submit → the user is logged in (the cookie is set by the API), the `me` cache refreshes, then navigate to `/`.
  - `INVITE_INVALID` → an EmptyState "This invite link is invalid or has expired. Ask your admin for a new one."
  - If already logged in, show a note: "You are signed in as X; accepting creates a new account".
  - The page sets `<meta name="referrer" content="no-referrer">` while mounted (defence in depth beside the nginx header).

- [ ] **Step 1: Write failing tests:**
  - `clientSnippets.test.ts`: `snippets contain url and key exactly once`.
  - `KeyCreatedDialog.test.tsx`: `close requires confirmation`; `plaintext is not in localStorage or sessionStorage after close`.
  - `Team.test.tsx`: `cannot disable self`; `issue key hidden for other admins`; `disable shows confirm with revoke warning`.
  - `AcceptInvite.test.tsx`: `invalid token shows expired state`; `password mismatch blocks submit`; `success navigates home`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the tests, typecheck, lint and build (PASS). Manual dev-server check:
  - create a key, copy the Claude Code snippet, then revoke the key;
  - invite `qa+<time>@example.com`, open the link in a private window, accept it, see the member view (no Team, read-only servers), then disable that user as admin.
- [ ] **Step 5: Commit** `feat(dashboard): add API keys, team management and invite acceptance` (two commits: keys; team and invite).

### Task 4.6: Audit log and Chat

**Files:**
- Create: `apps/dashboard/src/pages/{Audit,Chat}.tsx`, `src/features/audit/{api.ts,AuditFilters.tsx,AuditTable.tsx}`, `src/features/chat/{api.ts,ChatThread.tsx,ChatComposer.tsx,ToolCallTrace.tsx,useChat.ts}`
- Create: `apps/dashboard/test/{AuditFilters,useChat,Chat}.test.tsx`

**Interfaces:**
- Consumes: `GET /api/audit` (`{items, nextCursor}`, filters `userId, serverSlug, toolName, outcome, from, to, limit, cursor`), `GET /api/users` (admin, for the user filter), `GET /api/servers` (server filter options), `GET /api/chat/status`, `POST /api/chat`.
- Produces:
  - `useChat()`: `{ messages, send(text), pending, error, reset }`. It keeps the turn history in React state (no browser storage) and sends only `{role, content}` pairs (the last 20).
  - `ToolCallTrace`: a collapsible list; each item shows the tool name, an outcome badge with a label, the duration, pretty-printed arguments and the result preview in `<pre>`.
- **Audit page:**
  - **Filter bar:** user (admin only), server, tool name (text), outcome (`success / error / timeout / denied / unauthorized`), from/to datetime. Filters are reflected in the URL search params.
  - **Table:** time (local and relative), user, source (`MCP client` / `Chat` badge), event, server, tool (`server__tool`), outcome badge, duration, error (truncated).
  - **Loading more:** "Load more" uses `nextCursor` (TanStack `useInfiniteQuery`).
  - **Empty and error states:** "No calls match these filters", with a Clear filters action; errors get an ErrorState.
  - **Members:** the page is the same, with no user filter (the API scopes the rows).
- **Chat page:**
  - **Not configured:** when `status.configured` is false, show an EmptyState that explains the AI provider isn't configured, with a link to the run-guide section name "Set up the AI chat" (text only) and the steps headline (`.env` → `scripts\create-secrets.ps1`). The page is otherwise usable as an EmptyState, with no dead buttons.
  - **Configured:**
    - **Header:** a provider/model chip, a "New conversation" button and suggested prompts ("What orders came in today?", "List the products in the store", "What's 15% of 2,340?", "Save a note: call the supplier on Monday").
    - **Thread:** user and assistant bubbles; replies rendered as plain text with line breaks preserved (no HTML or markdown rendering, so there is no XSS path). Each assistant turn has its `ToolCallTrace`.
    - **While waiting:** a "Thinking… calling tools" status line with `aria-live="polite"`.
    - **Composer:** a textarea (Enter sends, Shift+Enter adds a newline; max 4000 characters with a counter), disabled while pending.
  - **Errors** show as an inline alert above the composer, keeping the user's message for retry:
    - `LLM_RATE_LIMITED` → "The AI provider is rate limited. Try again in N seconds." The Retry button is disabled for N seconds.
    - `LLM_AUTH_FAILED` → "The AI provider rejected the API key. An admin needs to update it."
    - `LLM_UNAVAILABLE` → "The AI provider is unavailable right now."
    - `LLM_BAD_RESPONSE` → "The AI returned an unexpected answer. Try rephrasing."
    - `RATE_LIMITED` → "You're sending messages too quickly."
    - `CONFLICT` → "A reply is already being generated."
    - **When `details.toolCalls` is non-empty**, the alert shows the trace with "These actions already ran", so the user doesn't repeat a create.
  - The `stoppedReason` values `max_steps` and `timeout` show an info note under the reply.

- [ ] **Step 1: Write failing tests:**
  - `AuditFilters.test.tsx`: `filters round-trip through URL params`; `member has no user filter`.
  - `useChat.test.tsx`: `sends only role and content of last 20`; `keeps user text on error`.
  - `Chat.test.tsx`: `shows executed tool calls on error`; `not configured shows setup state`; `retry disabled for Retry-After seconds`; `reply is rendered as text not HTML` (a reply `<img src=x onerror=alert(1)>` appears as literal text).
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the tests, typecheck, lint and build (PASS); **confirm no "Coming in this phase" placeholder remains** (`grep -r "Coming in this phase" apps/dashboard/src` is empty). Manual dev-server check: the audit filters, and chat if the Groq key is in the cluster (Task 4.7 makes that possible; until then, check the not-configured state).
- [ ] **Step 5: Commit** `feat(dashboard): add audit log with filters` and `feat(dashboard): add chat with tool-call trace`.

### Task 4.7: Packaging: dashboard image, chart, LLM Secret and scripts

**Files:**
- Create: `docker/dashboard.Dockerfile`, `apps/dashboard/nginx.conf`, `charts/urumi-platform/templates/gateway/dashboard.yaml` (Deployment + Service), `scripts/create-secrets.ps1`
- Modify: `charts/urumi-platform/templates/gateway/{ingress.yaml,gateway.yaml}`, `charts/urumi-platform/{values.yaml,values.schema.json}`, `deploy/values-local.yaml`, `deploy/values-prod.yaml`, `scripts/{build-images.ps1,up.ps1}`, `charts/urumi-platform/templates/NOTES.txt`

**Interfaces:**
- **Image:**
  - **Build stage:** `node:24-alpine` installs only the root, `@urumi/dashboard` and its needs (`npm ci --include-workspace-root --workspace @urumi/dashboard`), then `npm run build -w @urumi/dashboard`.
  - **Runtime stage:** `nginxinc/nginx-unprivileged:1.30.6-alpine`, with the build copied to `/usr/share/nginx/html` and `nginx.conf` to `/etc/nginx/conf.d/default.conf`. `USER 101`, `EXPOSE 8080`.
- **nginx.conf:**
  - `listen 8080`;
  - `location = /healthz { return 200 'ok'; }`;
  - `location ^~ /.well-known/ { return 404; }`;
  - `location /assets/` with `Cache-Control: public, max-age=31536000, immutable`;
  - `location /` with `try_files $uri /index.html` and `Cache-Control: no-cache` for HTML;
  - the security headers from Global Constraints with `always`;
  - `server_tokens off`.
- **Values:**
  - `dashboard: {enabled: true, image: {repository: urumi/dashboard, tag: ""}, port: 8080, resources: {requests: {cpu: 10m, memory: 16Mi}, limits: {cpu: 100m, memory: 64Mi}}}`.
  - `gateway.llm: {provider: groq, model: "", baseUrl: "", fallbackProvider: "", fallbackModel: "", timeoutMs: 30000, maxRetries: 2}`.
  - `gateway.chat: {turnTimeoutMs: 60000, maxSteps: 8, rateLimitPerMin: 10}`.
  - `secrets.existing.llmApiKeys: ""`.
  - All typed in `values.schema.json` with the same bounds as the config.
- **Gateway env:**
  - `LLM_*` and `CHAT_*` from values;
  - `STORE_TIMEZONE` from the store's existing timezone value;
  - `GROQ_API_KEY` and `OPENROUTER_API_KEY` via `secretKeyRef {name: <llmApiKeys or "llm-api-keys">, key: GROQ_API_KEY | OPENROUTER_API_KEY, optional: true}`.
- **Ingress** (`app.localhost`):
  - `/api` and `/mcp` → gateway (unchanged);
  - `/` (Prefix) → `dashboard` when `dashboard.enabled`.

  The longest prefix wins in Traefik, so `/api` and `/mcp` stay with the gateway.
- **`scripts/create-secrets.ps1`:**
  - It reads `<root>\.env` (stops with a clear message if missing, pointing to `.env.example`) and parses only `GROQ_API_KEY` and `OPENROUTER_API_KEY` (`KEY=value` lines; ignores comments, trims quotes).
  - It builds the Secret JSON (`stringData`) **in memory** and pipes it to `kubectl apply -f -` (not argv, not a temp file), in namespace `gateway`.
  - It prints only `GROQ_API_KEY: set` / `empty` style lines.
  - It then runs `kubectl -n gateway rollout restart deploy/gateway` and waits (skipped with `-NoRestart`).
  - It refuses to run when both keys are empty.
  - Parameters: `-EnvFile`, `-Namespace`.
- **`build-images.ps1`** builds `urumi/dashboard:<tag>` with `docker/dashboard.Dockerfile` and imports it like the others. **`up.ps1`** prints `Dashboard : http://app.localhost/` (when `dashboard.enabled`). When Secret `llm-api-keys` does not exist in `gateway`, it also prints `AI chat : not set up - see docs/run-guide.md "Set up the AI chat"`. It checks only whether the Secret exists and never reads its data.

- [ ] **Step 1: Write the image, nginx config and chart changes.** Then run `helm lint` (local and prod values) and `helm template` checks:
  - the dashboard Deployment has the full securityContext, probes and `/tmp` emptyDir;
  - the Ingress has 3 paths;
  - the gateway env has both `optional: true` key refs;
  - no LLM key value appears in any rendered manifest (`grep -i "gsk_\|sk-or-"` finds nothing).
- [ ] **Step 2:** `docker build -f docker/dashboard.Dockerfile -t urumi/dashboard:test .`. Then run it locally with `docker run --rm -p 18080:8080 --read-only --tmpfs /tmp urumi/dashboard:test`. Check with `curl.exe -sI`:
  - `/` gives 200 with the CSP header;
  - `/servers` gives 200 (SPA fallback);
  - `/.well-known/oauth-authorization-server` gives 404;
  - `/healthz` gives 200.
- [ ] **Step 3:** Commit (`build(dashboard): add nginx-unprivileged image with security headers`, `feat(helm): serve dashboard through ingress alongside gateway API`, `feat(scripts): push LLM keys to the cluster with create-secrets.ps1`).
- [ ] **Step 4: Deploy:** `scripts\up.ps1 -Redeploy`. Every pod should be 1/1, including `dashboard-…` in `gateway`. Then:
  - `curl.exe -s -o NUL -w "%{http_code}" http://app.localhost/` gives 200; `/api/auth/me` gives 401 JSON; `/mcp` without a key gives 401.
  - `scripts\check-gateway.ps1 -Write` still passes with 15 tools.
  - If `.env` has a Groq key: run `scripts\create-secrets.ps1`; the gateway restarts, and its log line says `llm configured` with the provider and model only.

### Task 4.8: End-to-end verification: Playwright smoke at desktop and mobile, and the live chat

**Files:**
- Create: `apps/dashboard/playwright.config.ts`, `apps/dashboard/e2e/{auth.setup.ts,smoke.spec.ts,chat.spec.ts}`, `scripts/check-dashboard.ps1`
- Modify: `apps/dashboard/package.json` (`e2e` script; Playwright is not part of `npm test`)

**Interfaces:**
- `playwright.config.ts`:
  - `baseURL: process.env.E2E_BASE_URL ?? 'http://app.localhost'`;
  - projects `desktop` (1440×900) and `mobile` (390×844, `isMobile`, `hasTouch`), each depending on `setup`;
  - `screenshot: 'off'`, `trace: 'off'`, `video: 'off'`;
  - `retries: 0`, `workers: 1`.
- `auth.setup.ts` logs in with `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` and saves the storage state under `apps/dashboard/e2e/.auth/` (git-ignored). The email and password are never printed or logged.
- **`smoke.spec.ts`** (both projects):
  1. The overview shows "connected" stat ≥ 3.
  2. Servers lists `woo`, `notes` and `utils`, each with a "Connected" label. The `utils` detail shows 4 tools.
  3. Keys: create `e2e <time>`; the dialog shows a value starting with `ugw_` and the Claude Code snippet. Assert on these **without logging the value**. Confirm, close, revoke and see "Revoked".
  4. Audit: rows are visible. Filter by server `utils` and see only `utils` rows.
  5. Team: invite `e2e+<time>@example.com`, see the link dialog, close it, and cancel the invite.
  6. Mobile only: open the drawer and navigate through it; the servers table renders as cards.
  7. Log out and land on `/login`.
- **`chat.spec.ts`:**
  - It skips with a clear reason when `GET /api/chat/status` says not configured.
  - Otherwise it asks "Use the calculator: what is 6 times 7?" and expects a `utils__calculate` trace and a reply containing `42`.
  - Then it checks the Audit page with source filter or text for a `Chat` row.
- **`scripts/check-dashboard.ps1`:**
  - Checks Node and `node_modules`; checks the Playwright Chromium install (if missing, prints `npx playwright install chromium` and stops).
  - Reads the admin email and password from Secret `gateway-bootstrap` into **process environment variables only**, then runs `npx playwright test -c apps/dashboard/playwright.config.ts`.
  - Clears the variables in `finally` and exits with Playwright's code. It never prints secrets.

- [ ] **Step 1:** Write the config, specs and script.
- [ ] **Step 2: Run** `scripts\check-dashboard.ps1`. All smoke tests pass on both projects; record the counts and durations. Fix product bugs found here in the owning feature files (commit `fix(dashboard): …`).
- [ ] **Step 3: Live chat checks** (needs the Groq key in the cluster), done in the browser and also via the API with a session:
  1. "Create a draft product called Chat Test Mug priced 9.99". Expect a `woo__create_product` trace with success; the product is visible in wp-admin → Products → Drafts.
  2. Place one COD order on the storefront, then ask "What orders came in today?". Expect a `woo__list_orders` trace with `period: today`, and the reply lists that order.
  3. Ask "Save a note: call the supplier on Monday", then "What notes do I have?". Expect `notes__create_note`, then `notes__list_notes`.
  4. The Audit page shows these rows with source **Chat** and the admin user.
  5. Measure the token usage per turn from the gateway `chat turn` log lines (no content is logged) and record it for `docs/ai-integration.md`.
- [ ] **Step 4:** Run `npm test` 3 times back to back (record all results), and `npm run typecheck`, `npm run lint` and `npm run build`.
- [ ] **Step 5: Commit** `test(dashboard): add Playwright smoke at desktop and mobile viewports` and `feat(scripts): add check-dashboard.ps1`.

### Task 4.9: Documentation, diagrams, screenshots and plan bookkeeping

**Files:**
- Create: `docs/ai-integration.md`, `docs/decisions/ADR-015-dashboard-served-by-nginx.md`, `docs/screenshots/*.png` (no secrets: overview, servers, server detail, audit, chat with a calculator turn, mobile servers)
- Modify:
  - `docs/{system-design,architecture,workflows,security,error-handling,testing,troubleshooting,run-guide,deployment}.md`;
  - `docs/diagrams/*`;
  - `docs/decisions/{ADR-010,ADR-011,README}.md`;
  - `docs/learning/04-chat-agent.md` (new learning note: the tool loop and the LLM wire format with a real captured, redacted request/response);
  - `README.md`, `.env.example`, `apps/gateway/README.md`, `apps/dashboard/README.md` (new);
  - the spec (§6.9 `arguments`, `connectLoopback(mintToken)`, the spike result, `llama-3.3-70b-versatile` retired);
  - the master plan (tick the Phase 4 carry-forward items, with the task that resolved each).

**Content requirements:**
- **`ai-integration.md`:**
  - **The layer:** the provider abstraction with its file map, and the request/response format.
  - **Configuration:** the variables table; how to get a free Groq key (console.groq.com → API Keys) and an OpenRouter key.
  - **Putting keys in place:** `.env` → `create-secrets.ps1` → the gateway restart; how to switch provider or model (the Helm values `gateway.llm.*`, then `up.ps1 -Redeploy`); how to add a new provider (an entry in `providers.ts` or a new adapter class).
  - **Limits:** quotas and limits as verified on 2026-10-19 with links (Groq 30 RPM / 1K RPD / 8K TPM for gpt-oss; OpenRouter `:free` 20 RPM / 50 RPD), and a note that they change.
  - **Spike results:** the table from Task 4.1, and the measured tokens per turn from Task 4.8.
  - **Failures:** every `LLM_*` error with what the user sees; the retry, deadline and fallback rules; and the residual prompt-injection risk.
- **ADR-015:** a separate nginx pod vs serving the SPA from the gateway (rejected: it mixes concerns and needs an SPA-fallback carve-out for `/mcp`, `/api` and the probes) vs a Vercel-style host (rejected for local: it breaks same-origin cookies and CSRF).
- **ADR-011:** the chosen model and why; the master plan's llama candidate was retired by Groq. **ADR-010:** a token per request.
- **`workflows.md` and `diagrams/`:** Mermaid sequence diagrams for login, accepting an invite, creating a key, a chat turn (with the tool loop, retries and fallback) and admin editing a server (the origin-change rule). Each diagram gets an explanation in text and a failure table (CLAUDE.md §4).
- **`security.md`:**
  - **Browser headers:** CSP and the other headers.
  - **Chat as the user:** acting as the user with per-request internal tokens.
  - **Untrusted data:** tool output is treated as untrusted; prompt injection is a documented residual risk.
  - **Secrets:** where the LLM keys live; that the content of chat messages isn't logged.
  - **The key dialog:** its shown-once handling.
- **`error-handling.md`:** the chat failure matrix and the dashboard error states.
- **`testing.md`:** the dashboard unit tests (counts), the Playwright smoke (how to run it, what it covers, the verified dates) and the 3× `npm test` results.
- **`troubleshooting.md`:**
  - the chat says not configured;
  - `LLM_AUTH_FAILED`, and 429 rate-limited;
  - a blank dashboard or 404 on refresh;
  - Playwright browsers missing;
  - the Vite dev proxy gives 403 CSRF;
  - the dashboard image tag isn't found.
- **`run-guide.md`:**
  - **New sections:** "The dashboard (Phase 4)" (URLs, logging in, every page with what you can do as an admin and as a member, the mobile view) and "Set up the AI chat" (a step by step for a beginner: get the key, `.env`, `create-secrets.ps1`, check, use).
  - **Existing sections:** update section 4 (the URLs: the Dashboard row is now live), section 11 (each part of the project: the Dashboard and chat rows) and section 12 (health/logs: `kubectl -n gateway logs deploy/dashboard`).
- **`README.md`:** features, a screenshot, the dashboard and chat quick start, the free AI key setup, and the docs links. Keep every one of the 22 CLAUDE.md sections accurate; Phase 6 completes the README.
- **`deployment.md`:** the dashboard image and `llm-api-keys` for prod (a pre-created Secret), labelled not tested on a VPS.
- **Checks:** a link check (0 broken), a secret scan of the repository and the screenshots (no `ugw_`, `gsk_`, `sk-or-` or password strings), and `grep` for "(planned — Phase 4)" leftovers describing now-built features.
- **Commit:** `docs: document chat agent, AI provider setup and dashboard workflows` (plus `docs: add Phase 4 screenshots`).

---

## Phase 4 exit criteria (the user runs them)

1. `http://app.localhost/` shows the login page. Log in as the bootstrap admin, then use every page at desktop width and at phone width (browser devtools device mode, 390 px).
2. Invite a member and accept the link in a private window; the member sees read-only servers, their own keys, their own audit rows and no Team page.
3. With the Groq key pushed by `scripts\create-secrets.ps1`, the chat creates a draft product and lists today's orders. Both show in the Audit page with source **Chat**.
4. `scripts\check-gateway.ps1 -Write` and `scripts\check-dashboard.ps1` pass, and `npm test` passes.
