# Error handling

> **Status (end of Phase 3).** Covers the gateway, the three upstreams and the Postgres database. The LLM and chat rows of the spec (§10) are **not built** (Phase 4) and are listed at the end only so nothing is silently missing. The complete document is finished in Phase 6.

Each row answers: what fails, how it is detected, whether it is retried, what the caller sees, and what is logged or audited. Evidence labels:

- **live** = run against the k3d cluster on 2026-10-19 and the text copied from the answer;
- **tested** = pinned by an automated test (see [testing.md](testing.md)) but not triggered on the cluster;
- **expected** = follows from the code or Kubernetes behaviour, not run.

**Two kinds of failure.** A tool the model could plausibly fix or retry (bad argument, missing note, upstream down) is an MCP result with `isError: true` and HTTP 200. A request that is not allowed at all (no key, wrong method, bad host) is an HTTP error with a JSON-RPC error body. See [learning/02-mcp-protocol.md](learning/02-mcp-protocol.md#7-iserror-versus-a-protocol-error).

**Retries.** Tool calls are **never** retried anywhere (a retry could repeat a write). Health checks are the only repeated operation, every 15 s. Startup retries the database connection (30 attempts, 2 s apart).

## 1. `/mcp` (the aggregated endpoint)

| Failure | Detected by | Retried? | What the client sees | Log and audit |
|---|---|---|---|---|
| No `Authorization` header | `authenticateBearer` | no | `401`, header `WWW-Authenticate: Bearer`, `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}` (**live**) | log `mcp auth rejected` reason `missing`; **no audit row** |
| Unknown or malformed key (not `ugw_` + valid, or bad internal token) | hash lookup finds nothing | no | the same 401 (**live**) | audit row `auth_rejected`, outcome `unauthorized`, message `unknown or malformed credential`, user null (**live**) |
| Revoked key | `revoked_at` set | no | the same 401 (**live**: the isolation check revokes its key and sees 401) | audit `auth_rejected`, message `API key revoked`, attributed to the key's owner (**live**) |
| Key of a disabled user | `users.disabled_at` set | no | the same 401 (**tested**) | audit `auth_rejected`, message `user disabled` |
| Expired internal chat token | JWT `exp` | no | the same 401 (**tested**) | audit `auth_rejected`, message `internal token expired` |
| `GET /mcp` (or any non-POST) | route | no | `405`, header `Allow: POST`, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed"},"id":null}` (**live**) | request log line only |
| Host header not in `MCP_ALLOWED_HOSTS` | host check, before auth | no | `403`, `-32000 Invalid Host: <name>` (**tested** in the shared package; captured on the WooCommerce server in Phase 2, same code) | request log line |
| Malformed JSON body | body parser | no | `400`, `-32700 Invalid request body` (**tested**) | request log line |
| Body over 1 MB | body parser | no | `413`, `-32700 Invalid request body` (**tested**) | request log line |
| Unknown tool or unknown server slug | `callTool` | no | result `isError`: `Unknown tool: zzz__ping` (**live**) | audit `tool_call`, outcome `denied`, server null, tool name as sent (**live**) |
| Server disabled or unreachable | state check | no | result `isError`: `Server '<slug>' is disabled or unreachable` (**tested**; tools of such servers are not listed, so only a stale client can call them) | audit `denied` |
| Upstream returns `isError` (for example `notes__delete_note` with a missing id) | the result flag | no | the upstream's own result, unchanged: `Note 999 not found.` (**live**) | audit outcome `error`, message = the first text, server `notes`, tool `delete_note` (**live**) |
| Upstream does not answer in 20 s | `AbortSignal.timeout` and the SDK request timeout | no | result `isError`: `Upstream '<slug>' did not respond within 20000ms` (**tested**) | audit outcome `timeout`; the server **stays connected** |
| Upstream answers a JSON-RPC error (protocol error) | `ProtocolError` | no | result `isError`: `Upstream '<slug>' error: <message>` (**tested**) | audit outcome `error`; stays connected |
| Connection-level failure during a call (refused, reset, DNS, SSRF block, redirect, HTTP status) | `isConnectionLevelError` | no | result `isError`: `Upstream '<slug>' is unreachable: <reason>` (**tested**) | audit outcome `error`; the server is marked `unreachable` **at once** and its tools leave the list |
| Client cancels the request | the request's abort signal | no | result `isError`: `Call to '<name>' was cancelled` (**tested**) | audit outcome `error` |
| Wrong arguments (for example `create_product` with price `abc`) | the **upstream's** zod validation (the gateway passes arguments through) | no | the upstream's `isError` text, for example `Input validation error: Invalid arguments for tool create_product: ...` (**live** on the upstream directly, [captured](learning/02-mcp-protocol.md#54-toolscall-tool-level-error-iserror-true)) | audit outcome `error` |
| Unexpected exception in the handler | shared server | no | `500`, `-32603 Internal error`, no details (**tested**) | error log line |
| Postgres down while a key is checked | the query throws | no | `500`, `-32603 Internal error` (**expected**) | error log line; `/readyz` is 503, so Kubernetes also stops sending traffic |

`lastError` strings produced by a failed health check or call (`describeUpstreamError`, **tested** against real SDK errors from the fake upstreams; also shown on the server's `ServerView`):

| `lastError` | Meaning |
|---|---|
| `connection refused` | Nothing listens at the address (pod down or port wrong). |
| `DNS lookup failed` | The name does not resolve (or the resolver is unavailable). |
| `timeout after 5000ms` | No answer within the check timeout. |
| `HTTP 401 from upstream` (or 403, 404, 5xx) | The upstream answered with that status. The body is never copied. 401 usually means the stored credential is wrong. |
| `HTTP 302 from upstream (redirects are not followed)` | The URL redirects; the gateway never follows a redirect (a redirect could point at an internal address). |
| `blocked by SSRF guard (<reason>)` | The name now resolves to a forbidden address. Reasons: `loopback`, `link_local`, `private`, `unspecified`, `scheme`, `credentials_in_url`, `invalid_url`. |
| `error: <message>` | Anything else, for example a socket reset, shortened to 200 characters. |

## 2. `/api` (the REST API)

All errors have the shape `{"error":{"code","message","details"?,"requestId"}}`. The `requestId` is also the `X-Request-Id` response header and appears in the logs.

| Status and code | When | Example (live unless noted) |
|---|---|---|
| `400 VALIDATION_FAILED` | A zod schema failed, or a body is malformed JSON or unknown fields (`.strict()`) | `details.issues[{path,message}]`, for example `slug: must match ^[a-z][a-z0-9-]{1,15}$` |
| `400 SSRF_REJECTED` | A server URL fails the SSRF guard | `Upstream URL rejected: 169.254.169.254 resolves to a link-local address`, `details.reason` `link_local`. Also `loopback`, `private` (`... and is not allowlisted`), `scheme` (`file:`), `credentials_in_url`. |
| `401 UNAUTHENTICATED` | No session cookie, expired session, disabled user | `GET /api/keys` without logging in |
| `401 INVALID_CREDENTIALS` | Login failed. One answer for unknown email, wrong password and disabled user, so it reveals nothing. | `Email or password is incorrect` |
| `403 FORBIDDEN` | A member calls an admin route, or asks for another user's audit rows | `You do not have permission to do this` (**tested**) |
| `403 CSRF_REJECTED` | A `POST`, `PUT`, `PATCH` or `DELETE` without `Content-Type: application/json` **or** without `Origin: http://app.localhost` | `Request rejected by CSRF protection`. Includes a body-less `DELETE`. |
| `404 NOT_FOUND` | Unknown route, server, user, key or invite id. Another user's key looks the same as a missing one. | `Key not found` |
| `404 INVITE_INVALID` | Invite token unknown, expired, used or cancelled | `This invite link is invalid or has expired` |
| `409 CONFLICT` | Duplicate slug, a user with that email exists, changing your own role or disabling yourself | `A server with this slug already exists` |
| `413` (code `VALIDATION_FAILED`) | `/api` body over 100 kb | `Request body too large` (**tested**) |
| `429 RATE_LIMITED` | More than 10 login attempts per minute for the same IP and email | `Too many login attempts; try again later`, header `Retry-After: 60`. The 11th attempt was refused (**live**). |
| `500 INTERNAL` | Anything unexpected, including a database error | `Internal error`, no message or stack; the log line has the request id and the error class only (**tested**) |

Details worth knowing:

- **CSRF runs before the session check**, even on public routes, so a request without the two headers is `403` whether or not you are logged in.
- **The login rate limit** counts every attempt, successful or not, keyed on `IP|email`. Behind Traefik the real client IP comes from `X-Forwarded-For` because the pod runs with `TRUST_PROXY=1`; without it every user would share the ingress IP. The limiter is in memory, so a pod restart clears it.
- **Passwords** shorter than 10 characters are refused at invite acceptance (`VALIDATION_FAILED`), not at login.

## 3. Startup and Kubernetes

| Failure | Detected by | What happens | Where to look |
|---|---|---|---|
| Missing or invalid environment variable | `loadConfig` | The process prints `Invalid environment: <names>` (names only, never values) and exits 1; the pod goes `CrashLoopBackOff` (**tested**) | `kubectl -n gateway logs deploy/gateway` |
| Postgres not ready at start | connect, `select 1`, migrate | Up to 30 attempts 2 s apart, each logged as `database not ready` with a reason code; then `gateway startup failed` (step `database`) and exit 1, so the pod restarts. `/mcp` is never served on an unmigrated database (**tested**) | gateway log |
| Postgres goes away while running | `/readyz` runs `select 1` | `/readyz` is 503, the pod leaves the Service endpoints; `/healthz` stays 200 so the pod is **not** restarted. Requests that reach the database fail with 500. When Postgres returns, readiness recovers (**expected**, not run; the code logs pool errors instead of crashing) | `kubectl -n gateway get pods` shows `0/1` |
| An upstream pod is down | health loop | The gateway stays Ready (readiness does not depend on upstreams); that server becomes `unreachable` and its tools vanish within about 20 s (**live**: 4-12 s) | `GET /api/servers`, the Postgres `upstream_servers` table |
| An upstream comes back | next health check | A fresh client is built; status `connected` and the tools return, within one interval (**live**: 16.4 s after scaling back) | same |
| A seed credential env var is missing | seeding | The server is inserted without a credential and a warning names the variable; the upstream will answer 401 (**tested**) | gateway log `seed server credential env var is missing` |
| Pod receives SIGTERM | signal handler | Stops the checks and upstream clients, stops listening, closes the pool, exits 0. Observed: the old pod was gone after 8 s (**live**, grace period 30 s) | gateway log `shutting down` |
| The process is killed in the middle of a tool call | none | No audit row exists for that call, because the row is written after the call (spec §6.8; a known limit, no code change) | |

## 4. Not built yet (Phase 4)

LLM rate limits and fallback, the chat error messages, and the dashboard error states are in the spec (§10) but do not exist yet. No claim is made about them here.
