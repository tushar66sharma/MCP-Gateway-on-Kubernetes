# Error handling

> **Status (end of Phase 4).** Covers the gateway, the three upstreams and the Postgres database, and since Phase 4 the chat agent with its LLM provider ([section 4](#4-the-chat-post-apichat)) and the dashboard's error states ([section 5](#5-the-dashboard)). The complete document is finished in Phase 6.

Each row answers: what fails, how it is detected, whether it is retried, what the caller sees, and what is logged or audited. Evidence labels:

- **live** = run against the k3d cluster on 2026-10-19 and the text copied from the answer;
- **tested** = pinned by an automated test (see [testing.md](testing.md)) but not triggered on the cluster;
- **expected** = follows from the code or Kubernetes behaviour, not run.

**Two kinds of failure.** A tool the model could plausibly fix or retry (bad argument, missing note, upstream down) is an MCP result with `isError: true` and HTTP 200. A request that is not allowed at all (no key, wrong method, bad host) is an HTTP error with a JSON-RPC error body. See [learning/02-mcp-protocol.md](learning/02-mcp-protocol.md#7-iserror-versus-a-protocol-error).

**Retries.** Tool calls are **never** retried anywhere (a retry could repeat a write), including by the chat agent and the dashboard. Health checks repeat every 15 s. Startup retries the database connection (30 attempts, 2 s apart). Since Phase 4 two more things retry: a **model call** to the LLM provider (429, 5xx and network errors, up to 2 retries that never pass the turn deadline, then an optional fallback once; [section 4](#4-the-chat-post-apichat)), and the dashboard's **reads** (network errors and 5xx, at most 2 retries; writes are never retried).

## 1. `/mcp` (the aggregated endpoint)

| Failure | Detected by | Retried? | What the client sees | Log and audit |
|---|---|---|---|---|
| No `Authorization` header | `authenticateBearer` | no | `401`, header `WWW-Authenticate: Bearer`, `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}` (**live**) | log `mcp auth rejected` reason `missing`; **no audit row** |
| Well-formed but unknown key (`ugw_` + 43 base62 characters) | hash lookup finds nothing | no | the same 401 (**live**) | audit row `auth_rejected`, outcome `unauthorized`, message `unknown credential`, user null (**tested**) |
| Unrecognisable value: another scheme (`Basic …`), `Bearer` alone, a malformed `ugw_` value, a token with a bad signature | format check, or JWT verification | no | the same 401 (**tested**) | **no audit row** (spec §6.8: rejections are audited "when the key is recognizable"); debug log line only, so garbage cannot grow the audit table (**tested**) |
| More than `MCP_AUTH_FAILURE_LIMIT_PER_MIN` (30) *recognised* rejections a minute from one `req.ip` | `deps.mcpAuthLimiter` in `mcp/auth.ts` | no | `429`, `Retry-After`, `{"jsonrpc":"2.0","error":{"code":-32029,"message":"Too many failed authentication attempts"},"id":null}` (**live**, **tested**); a valid key is still accepted | one `mcp auth failures limited` warn per IP per window; **no audit row** |
| Revoked key | `revoked_at` set | no | the same 401 (**live**: the isolation check revokes its key and sees 401) | audit `auth_rejected`, message `API key revoked`, attributed to the key's owner (**live**) |
| Key of a disabled user | `users.disabled_at` set (checked before `revoked_at`; disabling also revokes the keys) | no | the same 401 (**tested**) | audit `auth_rejected`, message `user disabled`, attributed to the owner |
| Expired internal chat token (valid signature) | JWT `exp` | no | the same 401 (**tested**) | audit `auth_rejected`, message `internal token expired`, **source `chat`, attributed to the token's user** (**tested**) |
| `GET /mcp` (or any non-POST) | route | no | `405`, header `Allow: POST`, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed"},"id":null}` (**live**) | request log line only |
| Host header not in `MCP_ALLOWED_HOSTS` | host check, before auth | no | `403`, `-32000 Invalid Host: <name>` (**tested** in the shared package; captured on the WooCommerce server in Phase 2, same code) | request log line |
| Malformed JSON body | body parser | no | `400`, `-32700 Invalid request body` (**tested**) | request log line |
| Body over 1 MB | body parser | no | `413`, `-32700 Invalid request body` (**tested**) | request log line |
| Unknown tool or unknown server slug | `callTool` | no | result `isError`: `Unknown tool: zzz__ping` (**live**); a requested name over 200 characters is shown as its first 200 plus `…` (**tested**) | audit `tool_call`, outcome `denied`, server null, tool name as sent, capped at 200 (**live**) |
| Server disabled or unreachable | state check | no | result `isError`: `Server '<slug>' is disabled or unreachable` (**tested**; tools of such servers are not listed, so only a stale client can call them) | audit `denied` |
| Upstream returns `isError` (for example `notes__delete_note` with a missing id) | the result flag | no | the upstream's own result, unchanged: `Note 999 not found.` (**live**) | audit outcome `error`, message = the first text, server `notes`, tool `delete_note` (**live**) |
| Upstream does not answer in 20 s | `AbortSignal.timeout` and the SDK request timeout | no | result `isError`: `Upstream '<slug>' did not respond within 20000ms` (**tested**) | audit outcome `timeout`; the server **stays connected** |
| Upstream answers a JSON-RPC error (protocol error) | `ProtocolError` | no | result `isError`: `Upstream '<slug>' error: <message>` (**tested**) | audit outcome `error`; stays connected |
| Connection-level failure during a call (refused, reset, DNS, SSRF block, redirect, HTTP 401/403/404/5xx) | `isConnectionLevelError` | no | result `isError`: `Upstream '<slug>' is unreachable: <reason>` (**tested**) | audit outcome `error`; the server is marked `unreachable` **at once** and its tools leave the list |
| Any other HTTP status during a call (for example `413` for an oversized request) | `SdkHttpError` status | no | result `isError`: `Upstream '<slug>' error: HTTP 413 from upstream` (**tested**) | audit outcome `error`; the server **stays connected** (the status concerns that call only) |
| The server is edited or deleted (`PATCH`/`DELETE /api/servers/:id`) while a call to it runs | the manager's entry was replaced | no | result `isError`: `Server '<slug>' was reconfigured during the call` (**tested**) | audit outcome `error`; the server is **not** marked unreachable |
| Client cancels the request | the request's abort signal | no | result `isError`: `Call to '<name>' was cancelled` (**tested**) | audit outcome `error` |
| Wrong arguments (for example `create_product` with price `abc`) | the **upstream's** zod validation (the gateway passes arguments through) | no | the upstream's `isError` text, for example `Input validation error: Invalid arguments for tool create_product: ...` (**live** on the upstream directly, [captured](learning/02-mcp-protocol.md#54-toolscall-tool-level-error-iserror-true)) | audit outcome `error` |
| Unexpected exception in the handler | shared server | no | `500`, `-32603 Internal error`, no details (**tested**) | error log line |
| Postgres down while a key is checked | the query throws | no | `500`, `-32603 Internal error` (**expected**) | error log line; `/readyz` is 503, so Kubernetes also stops sending traffic |

`lastError` strings produced by a failed health check or call (`describeUpstreamError`, **tested** against real SDK errors from the fake upstreams; also shown on the server's `ServerView`):

| `lastError` | Meaning |
|---|---|
| `connection refused` | Nothing listens at the address (pod down or port wrong). |
| `connection reset` | The upstream closed the connection (`ECONNRESET`, or undici's "other side closed"), typically a pooled keep-alive socket of a pod that just restarted. |
| `DNS lookup failed` | The name does not resolve, the resolver is unavailable, or the lookup took longer than the health timeout. |
| `timeout after 5000ms` | No answer within the check timeout. |
| `HTTP 401 from upstream` (or 403, 404, 5xx) | The upstream answered with that status. The body is never copied. 401 usually means the stored credential is wrong. |
| `HTTP 302 from upstream (redirects are not followed)` | The URL redirects; the gateway never follows a redirect (a redirect could point at an internal address). |
| `blocked by SSRF guard (<reason>)` | The name now resolves to a forbidden address. Reasons: `loopback`, `link_local`, `private`, `unspecified`, `scheme`, `credentials_in_url`, `invalid_url`. |
| `error: <message>` | Anything else, shortened to 200 characters. |

## 2. `/api` (the REST API)

All errors have the shape `{"error":{"code","message","details"?,"requestId"}}`. The `requestId` is also the `X-Request-Id` response header and appears in the logs.

| Status and code | When | Example (live unless noted) |
|---|---|---|
| `400 VALIDATION_FAILED` | A zod schema failed, or a body is malformed JSON or unknown fields (`.strict()`) | `details.issues[{path,message}]`, for example `slug: must match ^[a-z][a-z0-9-]{1,15}$` |
| `400 VALIDATION_FAILED` (server URL origin) | A `PATCH` changes the scheme, host or port of a server that has a stored credential, without a new `credential` or `clearCredential: true` | `changing the server URL origin requires re-entering the credential (or clearCredential: true)` (**tested**). A path-only change keeps the credential. |
| `400 SSRF_REJECTED` | A server URL fails the SSRF guard | `Upstream URL rejected: 169.254.169.254 resolves to a link-local address`, `details.reason` `link_local`. Also `loopback`, `private` (`... and is not allowlisted`), `scheme` (`file:`), `credentials_in_url`. |
| `401 UNAUTHENTICATED` | No session cookie, expired session, disabled user | `GET /api/keys` without logging in |
| `401 INVALID_CREDENTIALS` | Login failed. One answer for unknown email, wrong password and disabled user, so it reveals nothing. | `Email or password is incorrect` |
| `403 FORBIDDEN` | A member calls an admin route, or asks for another user's audit rows; an admin issues a key for **another admin** (`POST /api/users/:id/keys`) | `You do not have permission to do this`; `Admins create their own keys` (**tested**) |
| `403 CSRF_REJECTED` | A `POST`, `PUT`, `PATCH` or `DELETE` without `Content-Type: application/json` **or** without `Origin: http://app.localhost` | `Request rejected by CSRF protection`. Includes a body-less `DELETE`. |
| `404 NOT_FOUND` | Unknown route, server, user, key or invite id. Another user's key looks the same as a missing one. Also a server `PATCH` whose server was deleted by a concurrent `DELETE` (the server is then removed from the catalog too, **tested**). | `Key not found` |
| `404 INVITE_INVALID` | Invite token unknown, expired, used or cancelled | `This invite link is invalid or has expired` |
| `409 CONFLICT` | Duplicate slug, a user with that email exists, changing your own role or disabling yourself, an admin issuing a key for a disabled user | `A server with this slug already exists`; `User is disabled` (**tested**) |
| `413` (code `VALIDATION_FAILED`) | `/api` body over 100 kb (`/api/chat`: over 512 kb, parsed only after the session check, so an anonymous request gets `401` first) | `Request body too large` (**tested**) |
| `429 RATE_LIMITED` | More than 10 login attempts per minute for the same IP and email | `Too many login attempts; try again later`, header `Retry-After` (seconds left in the window, 1-60). The 11th attempt was refused, with `Retry-After: 60` (**live**). |
| `500 INTERNAL` | Anything unexpected, including a database error | `Internal error`, no message or stack; the log line has the request id and the error class only (**tested**) |

Details worth knowing:

- **CSRF runs before the session check**, even on public routes, so a request without the two headers is `403` whether or not you are logged in.
- **The login rate limit** counts every attempt, successful or not, keyed on `IP|email`. Behind Traefik the client IP is the rightmost `X-Forwarded-For` entry (the address Traefik saw) because the pod runs with `TRUST_PROXY=1`; without it every user would share the ingress IP. On k3s the ServiceLB in front of Traefik may SNAT every client to one address, so the limiter may effectively be per email (expected, not tested; Phase 5). The limiter is in memory, so a pod restart clears it.
- **Passwords** shorter than 10 characters are refused at invite acceptance (`VALIDATION_FAILED`), not at login.

## 3. Startup and Kubernetes

| Failure | Detected by | What happens | Where to look |
|---|---|---|---|
| Missing or invalid environment variable | `loadConfig` | The process prints `Invalid environment: <names>` (names only, never values) and exits 1; the pod goes `CrashLoopBackOff` (**tested**) | `kubectl -n gateway logs deploy/gateway` |
| Another gateway instance is migrating | `pg_advisory_lock` (key 7314420001) on the migration connection | no; the second instance waits for the lock | startup is delayed until the first finishes; the lock is released even when a migration throws (**tested** with a fake client) | none |
| Postgres not ready at start | connect, `select 1`, migrate | Up to 30 attempts 2 s apart, each logged as `database not ready` with a reason code; then `gateway startup failed` (step `database`) and exit 1, so the pod restarts. `/mcp` is never served on an unmigrated database (**tested**) | gateway log |
| Postgres goes away while running | `/readyz` runs `select 1` | `/readyz` is 503, the pod leaves the Service endpoints; `/healthz` stays 200 so the pod is **not** restarted. Requests that reach the database fail with 500. When Postgres returns, readiness recovers (**expected**, not run; the code logs pool errors instead of crashing) | `kubectl -n gateway get pods` shows `0/1` |
| An upstream pod is down | health loop | The gateway stays Ready (readiness does not depend on upstreams); that server becomes `unreachable` and its tools vanish within about 20 s (**live**: 4-12 s) | `GET /api/servers`, the Postgres `upstream_servers` table |
| An upstream comes back | next health check | A fresh client is built; status `connected` and the tools return, within one interval (**live**: 16.4 s after scaling back) | same |
| A seed credential env var is missing | seeding | The server is inserted without a credential and a warning names the variable; the upstream will answer 401 (**tested**) | gateway log `seed server credential env var is missing` |
| Pod receives SIGTERM | `preStop` sleep 5 s, then the signal handler | Stops accepting connections, lets in-flight requests finish for up to 25 s (then cuts the rest), stops the upstream clients, closes the pool, exits 0; grace period 35 s. A rollout uses `Recreate`: the new pod starts after the old one is gone | gateway log `shutting down: no new connections`, then `shutdown: http server closed` (`cutRequests`), `shutdown: upstream clients stopped`, `shutdown: database pool closed; exiting` |
| A built-in (seeded) server was deleted | seeding at start | It is **not** re-created: each seed slug is inserted once, ever (table `seeded_slugs`). Re-add it with `POST /api/servers` (**tested**) | `GET /api/servers` |
| The process is killed in the middle of a tool call | none | No audit row exists for that call, because the row is written after the call (spec §6.8; a known limit, no code change) | |

## 4. The chat (`POST /api/chat`)

A turn either succeeds (HTTP 200, possibly with failed tool calls inside its trace) or fails with one of the codes below. Every `LLM_*` error body carries `details.toolCalls`, the tool calls that already ran in that turn, because they are not undone. Provider text never reaches the user: `LlmError` messages are fixed, and the dashboard shows its own wording. Rules, numbers and the retry algorithm: [ai-integration.md](ai-integration.md#7-failures-retries-deadline-and-fallback); the turn as a diagram: [workflow 15](workflows.md#15-a-chat-turn-tool-loop-retries-and-fallback).

| Failure | Detected by | Retried? | HTTP and code | Chat page shows | Log (`chat turn`) |
|---|---|---|---|---|---|
| No key for the configured provider | `deps.llm` is null at the start of the turn | no | `503 LLM_NOT_CONFIGURED`; no MCP connection is opened (**tested**) | the empty state "The AI provider isn't configured" (the page reads `GET /api/chat/status` first) | no turn line; the start-up warning `llm not configured` |
| Bad body (a `system` or `tool` role, 0 or 21 messages, empty or 4,001-character content, last message not from the user, an unknown field) | zod | no | `400 VALIDATION_FAILED` (**tested**); the LLM is never called | not reachable from the page | request line |
| A second turn while one runs | per-user in-flight set | no | `409 CONFLICT` "A reply is already being generated" (**tested**) | "A reply is already being generated." | request line |
| More than `CHAT_RATE_LIMIT_PER_MIN` turns a minute | per-user limiter | no | `429 RATE_LIMITED`, `Retry-After` (**tested**) | "You're sending messages too quickly."; Retry waits for the seconds | request line |
| Provider rate limit | provider HTTP 429 | yes, up to `LLM_MAX_RETRIES` (2), honouring a `retry-after` of up to 20 s, never past the deadline; then the fallback once. A wait over 20 s is not retried: the call fails at once and the fallback, if any, is tried immediately (**tested**) | `429 LLM_RATE_LIMITED`, `Retry-After` = the provider's seconds or **60**, `details.retryAfterSec` (**tested**, including "does not sleep past the deadline") | "The AI provider is rate limited. Try again in N seconds." with a countdown | warn: `code`, `provider`, `httpStatus` 429, `providerCode`, `fallbackProvider`, `fallbackCode`, `usage` |
| Wrong or revoked AI key | provider HTTP 401/403 | no | `502 LLM_AUTH_FAILED` | "The AI provider rejected the API key. An admin needs to update it." | warn, `httpStatus` 401/403 |
| Provider down: network error, 5xx, request timeout (`LLM_TIMEOUT_MS`, 30 s) | the adapter | yes (backoff 500 ms × 2^attempt + up to 250 ms jitter), then the fallback once | `502 LLM_UNAVAILABLE` | "The AI provider is unavailable right now." | warn, `httpStatus` 5xx or none |
| Unusable answer: not JSON, no message, malformed `tool_calls`, another 4xx; Groq `400 tool_use_failed` | the adapter | `tool_use_failed` once (from the same budget); the rest no | `502 LLM_BAD_RESPONSE` | "The AI returned an unexpected answer. Try rephrasing." | warn, `providerCode` (for example `tool_use_failed`) |
| An LLM error after a tool already ran | `AgentLlmError` keeps the traces | no (tool calls are never retried) | the matching code above, with the executed calls in `details.toolCalls` (**tested**) | the message plus "These actions already ran. Check them before asking again, so nothing is created twice." and the trace (**tested**). Later requests tell the model which calls already ran, and **Retry** asks it to continue rather than start over ([ai-integration.md](ai-integration.md#7-failures-retries-deadline-and-fallback); **tested**) | `tools` lists them |
| The model sends arguments that are not a JSON object, or calls a tool that does not exist | the agent's parse; `/mcp` `Unknown tool` | no; the error goes back to the model, which may correct itself within the 8 steps | 200; the trace row is `error` (**tested**) | a **Failed** row; the model usually explains | `/mcp` audit `denied` for an unknown tool |
| A tool fails (upstream `isError`, timeout, upstream down, the user was disabled mid-turn) | `/mcp` ([section 1](#1-mcp-the-aggregated-endpoint)) | no | 200; the trace row is `error` with the preview (**tested**, disabled-user case included) | a **Failed** row | the `/mcp` audit row and `tool call` line |
| The turn takes longer than `CHAT_TURN_TIMEOUT_MS` (60 s) | deadline and turn signal | no | 200, `stoppedReason: "timeout"`, reply "This took too long and was stopped. The actions listed below already ran.", the trace so far; when no tool ran, "This took too long and was stopped. No actions ran." (**tested**) | that reply and the trace | `stoppedReason timeout` |
| The model's final answer is empty or only whitespace | the agent | no | 200, the fixed reply "I couldn't produce an answer. Try rephrasing your question." (**tested**); the page also never sends an empty message back (**tested**) | that reply | `stoppedReason final` |
| More than `CHAT_MAX_STEPS` (8) tool steps | step counter | no | 200, `stoppedReason: "max_steps"`, reply "I stopped after 8 tool steps without a final answer. Try a narrower question." (**tested**) | that reply | `stoppedReason max_steps` |
| The browser goes away (tab closed, page reloaded, Chat page left, **New conversation** mid-turn) | the response's `close` event aborts the turn | no | none (nobody is listening) (**tested**: the slot is freed) | nothing; a quick next send may get 409 until the old turn has stopped | `stoppedReason client_closed` (**tested**); a request whose socket is already closed when the handler starts never starts a turn and takes no slot (**tested**) |
| The loopback connect or `tools/list` fails for a reason other than the timeout | exception in the service | no | `500 INTERNAL` with a request id (not tested; rare; a deferred minor) | the generic error with the request id | `code INTERNAL` and the error class |

**What is never retried, and why.** Not a tool call (it may have written something), not a whole turn (the page's **Retry** sends the question again as a new turn; when tool calls already ran, it sends a note of them and asks the model to continue instead), and not a model call after a 401/403 or an unusable answer (repeating it would fail the same way).

**Leaving the Chat page ends the conversation.** The conversation is kept only in the open page (React state, for privacy). Leaving the Chat page, reloading it or pressing **New conversation** clears it, and a turn still in flight is cancelled in the browser. A cancelled turn may still finish on the gateway (a tool call already running is not undone), so check the audit log (source **Chat**) for any tools it ran.

## 5. The dashboard

The dashboard never leaves a blank screen: each failure has a visible state.

| Failure | Detected by | What the user sees | Recovery |
|---|---|---|---|
| A page's data fails to load (5xx, network error, a non-JSON answer such as a proxy's HTML error) | `apiFetch` turns it into `ApiError` (`NETWORK` when there was no usable answer); TanStack Query retries reads twice for network errors and 5xx | an error state in place of the list ("Servers didn't load", "The audit log didn't load", …) with the message, the request id when there is one, and **Try again** | **Try again** refetches; the rest of the page keeps working |
| The gateway is unreachable when the app starts (`/api/auth/me` fails) | `RequireAuth` | a retryable error, **not** a misleading redirect to the login page (**tested**) | **Try again** |
| The session expired, or the user was disabled | any `401 UNAUTHENTICATED` (except from the login call) | the login page with `next` set; after signing in, the same page again (**tested**) | sign in |
| A member opens an admin page by URL (`/team`) | `RequireRole` (and the API's 403) | "You don't have access to this page" with a link to the Overview (**tested**) | n/a |
| A form is invalid | inline validation before sending; a `400 VALIDATION_FAILED` maps `details.issues` to fields; `SSRF_REJECTED` goes to the URL field, `CONFLICT` to the slug field | inline field errors with `aria-invalid`; focus moves to the first bad field | fix and resubmit |
| A write fails (create, revoke, disable, delete, invite, role change) | the call's `ApiError` | an error toast with the message and the request id; a confirmation dialog stays open if its action failed | retry by hand; writes are never retried automatically |
| A server edit changes the URL's host while a credential is stored | the form's origin check (and the API's `400`) | an inline error on Credential: enter a new one or tick Remove (**tested**) | [workflow 16](workflows.md#16-an-admin-edits-a-server-and-the-url-origin-rule) |
| Server status changes while a page is open | the 10 s refetch | the status badge and tool count update by themselves | n/a |
| Empty data (no servers, no keys, no calls, no invites, filters that match nothing) | an empty list | an empty state that says what to do (**Add server**, **Create key**, **Clear filters**) | n/a |
| An unknown address | the router | a Not found page; a crash inside a page shows an error page with **Reload** instead of a blank screen | n/a |
| A chat failure | `ApiError` from `POST /api/chat` | an inline alert above the message box ([section 4](#4-the-chat-post-apichat)); the user's message stays in the thread so **Retry** resends it | **Retry**, after the countdown for a rate limit |
| The page is refreshed on a deep link (`/servers/<id>`) | nginx SPA fallback | the page loads normally (nginx answers `index.html` for unknown paths; `/assets/` and `/.well-known/` answer 404 for missing files) | n/a |

Logs for dashboard problems: the gateway log (every dashboard action is an `/api` request with an `X-Request-Id`, the same id the page shows) and `kubectl -n gateway logs deploy/dashboard` for file requests.
