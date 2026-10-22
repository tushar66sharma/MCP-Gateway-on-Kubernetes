# Testing

> **Status: partial (end of Phase 4).** Covers the automated tests and cluster checks that exist today: the shared package, the three MCP servers, the gateway (including the chat agent and the LLM layer), the dashboard's component tests and the Playwright browser smoke. The NetworkPolicy checks and `scripts/smoke-test.ps1` belong to Phase 5 and do not exist yet. The complete document is Phase 6.

Test counts below come from the Phase 4 final-review fix wave on 2026-10-22 (`npm test` from the repository root: **586 tests, all passing**: shared 55, dashboard 123, gateway 299, mcp-notes 12, mcp-utilities 27, mcp-woocommerce 70). The root run passed **three times back to back**:

| Run | shared | dashboard | gateway | mcp-notes | mcp-utilities | mcp-woocommerce |
|---|---|---|---|---|---|---|
| 1 | 55/55 (1.84 s) | 123/123 (34.30 s) | 299/299 (52.63 s) | 12/12 | 27/27 | 70/70 |
| 2 | 55/55 (1.52 s) | 123/123 (11.35 s) | 299/299 (46.72 s) | 12/12 | 27/27 | 70/70 |
| 3 | 55/55 (1.48 s) | 123/123 (12.38 s) | 299/299 (44.34 s) | 12/12 | 27/27 | 70/70 |

Before the fix wave (Task 4.8, 2026-10-19) the same three runs gave 570 tests (dashboard 113, gateway 293).

Known flakiness (not reproduced in those runs): twice during Phase 4 a full root run had gateway test files fail, once with "Worker exited unexpectedly" while the Vite dev server was also running, once with two database-backed files failing; each time the next run was green. Memory pressure from PGlite and argon2 in parallel workers is the suspected cause (not proven).

## 1. The layers

| Layer | What it proves | Tools |
|---|---|---|
| Unit | Pure logic: naming, crypto, SSRF classification, calculator, period maths, error descriptions | Vitest |
| Integration, in process | The real gateway code over a real (in-memory) Postgres and real MCP over HTTP, against fake upstream servers; the chat agent with a scripted fake LLM | Vitest, PGlite, supertest, the MCP SDK client |
| Component (dashboard) | Pages, dialogs and hooks render the right states and send the right requests, in a simulated browser with a mocked `fetch` | Vitest, jsdom, Testing Library |
| Chart render | The Helm templates produce what the code expects | `helm lint`, `helm template` |
| Cluster end to end | The deployed system works: login, key, `/mcp`, audit, isolation | `scripts\check-gateway.ps1`, `scripts\check-mcp-woocommerce.ps1` |
| Browser end to end | The deployed dashboard works in Chromium at 1440 px and 390 px, including one real chat turn | Playwright through `scripts\check-dashboard.ps1` |
| Manual | MCP Inspector against `http://app.localhost/mcp`; the PowerShell snippets in the run guide; the Phase 4 exit run (every page at desktop and phone width, a member in a private window) | by hand |

## 2. Commands

Run from the repository root.

| Command | Does |
|---|---|
| `npm ci` | Install the pinned packages (once; Node 24, 24.15 or newer recommended because jsdom 30 warns on older Node 24 releases). |
| `npm test` | Runs `vitest run` in every workspace, about 70 s (the gateway suite is most of it). Playwright is **not** part of it. |
| `npm test -w @urumi/gateway` | Only the gateway (also `@urumi/dashboard`, `@urumi/shared`, `@urumi/mcp-notes`, `@urumi/mcp-utilities`, `@urumi/mcp-woocommerce`). |
| `npm test -w @urumi/gateway -- test/chat` | Only the files under one folder. |
| `npm run typecheck` | Builds `packages/shared`, then `tsc --noEmit` per workspace (the dashboard also type-checks `e2e/`). |
| `npm run lint` | ESLint over the whole repository. |
| `npm run build -w @urumi/dashboard` | Type-check and Vite production build of the dashboard (warns that the single JS chunk is over 500 kB; known). |
| `npx playwright install chromium` | Once, for the browser check (about 118 MiB into `%LOCALAPPDATA%\ms-playwright`). |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1` | The Playwright smoke against the cluster (`-Project desktop` or `mobile`, `-Base <url>`). |
| `helm lint charts/urumi-platform -f deploy/values-local.yaml` (and `-f deploy/values-prod.yaml`) | Chart lint. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-gateway.ps1` | Cluster end-to-end check, read-only calls. Add `-Write` and/or `-Isolation`. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1` | The WooCommerce MCP server check through a port-forward (`-Write` also creates a draft product). |

## 3. What each suite proves (counts from the Phase 4 runs)

### `packages/shared` (55 tests)

| File | Tests | Proves |
|---|---|---|
| `mcpHttpServer.test.ts` | 23 | The shared MCP HTTP server: Host check before auth, auth hook (a function or a bearer/header config), `extraRoutes`, request ids, `logPath` redaction of mounted paths, a throwing `logPath` logs `[unloggable path]` and the server keeps serving, graceful `close({ graceMs })` (in-flight request finishes, new connections refused, a request past the grace is cut), 405, malformed JSON, 413, probes, exactly one of `registerTools` or `buildServer` |
| `upstreamAuth.test.ts` | 12 | The bearer and header upstream auth middleware (timing-safe compare) |
| `logger.test.ts` | 7 | Secret redaction, including keys ending in `key` or `secret` |
| `period.test.ts` | 7 | `today`, `yesterday`, `last_7_days` in a time zone |
| `env.test.ts` | 3 | The env loader names variables, never values |
| `tools.test.ts` | 3 | `defineTool`, `registerTools`, `ok`, `toolError` |

### The three upstream servers

| Workspace | Tests | Proves |
|---|---|---|
| `mcp-notes` | 12 | The in-memory store (limits, ids never reused, search) and the five tools over HTTP, including a 401 without the bearer token and the note-limit text taken from the store's error |
| `mcp-utilities` | 27 | The hand-written calculator (precedence, `^` right-associative, `-2^2`, nesting depth, division by zero, no `eval`), the time tools, header auth |
| `mcp-woocommerce` | 70 | OAuth1 signing against a known vector, the REST client (timeouts, redirects not followed, redaction), the six tools, the server |

### `apps/gateway` (299 tests in 26 files)

| Area | Files (tests) | Proves |
|---|---|---|
| Config and scaffold | `config.test.ts` (18), `scaffold.test.ts` (9), `api.test.ts` (4) | Env validation names variables only; the 32-byte key rule; `SEED_SERVERS` rules; `SSRF_ALLOWED_INTERNAL_HOSTS` entry rules; `LLM_BASE_URL` only empty, `http:` or `https:`; call timeout at least 11000 and health timeout below the interval; the Postgres pool bounds; the six tables exist; foreign key actions; `/healthz`, `/readyz` (503 until the database answers); the startup retry succeeds and gives up; error shapes; invite tokens redacted in logs in any case, and `/invite/<token>` |
| Security | `crypto.test.ts` (6), `passwords.test.ts` (2), `ssrf.test.ts` (43) | AES-GCM round trip, tampering, wrong associated data, unique nonces; argon2id; SSRF: metadata, private, loopback and IPv6 forms, DNS failure, a lookup that never answers (bounded), allow-list, connect-time lookup in every `dns.lookup` calling form, called back on a later tick |
| Auth | `bearer.test.ts` (16), `internalToken.test.ts` (4), `rateLimit.test.ts` (1) | API keys and the HS256-only internal token, revoked and disabled users (disabled reported first), which credentials are recognisable (audited), an expired token keeps its user, the limiter window |
| API | `auth` (17), `invites` (9), `keys` (9), `users` (5), `servers` (16), `audit` (5), `trustProxy` (2) | Login (case and whitespace in emails, one answer for every failure, 429), CSRF, sessions (expired ones swept at login; a disable racing the login leaves no session), invite lifecycle (single use, 72 h, conflict), key lifecycle and ownership (no key for a disabled user or another admin; a racing disable leaves no live key), role checks, server CRUD without any credential in any response, URL origin change needs the credential again, a DELETE during a PATCH, a deleted seeded server stays deleted, audit filters and pagination, `TRUST_PROXY` |
| Upstreams | `naming` (8), `errors` (18), `seed` (7), `manager` (27) | Naming and the 64-character rule; the `lastError` texts derived from real SDK errors (including `connection reset`), which HTTP statuses concern the whole server; seeding each slug once ever (`seeded_slugs`), marking rows from before the table; the manager (below) |
| `/mcp` | `endpoint.test.ts` (14) | The aggregated list, routing, collision prefixes, per-user audit, 401 variants (only recognisable credentials write audit rows; an expired internal token is attributed to its user with source `chat`), `isError` becomes outcome `error`, unknown tool becomes `denied`, no secrets in logs |
| LLM layer (Phase 4) | `chat/llm/openaiCompatible.test.ts` (18), `chat/llm/registry.test.ts` (8) | The request body (`tools[].type` `function`, `tool_choice`, `reasoning_effort` only for `gpt-oss` models), response parsing and `usage`, the error mapping (401/403 auth, 429 rate limit with `retryAfterSec`, 5xx and network unavailable, other 4xx and malformed `tool_calls` bad response), `tool_use_failed` retried once, backoff with `retry-after`, **does not sleep past the deadline**, **a `retry-after` above 20 s fails at once** with the provider's value (20 s itself is still waited for), a caller abort is not retried, `httpStatus` and only an identifier-shaped `providerCode` recorded; the fallback only on rate limit or unavailable, used at once when the primary asks for a long wait, once with no retries (3 primary + 1 fallback requests), the primary's error rethrown with `fallbackProvider`/`fallbackCode`, no fallback without its key |
| Chat agent (Phase 4) | `chat/agent.test.ts` (15), `chat/systemPrompt.test.ts` (4) | A tool then an answer; max steps; results cut to 6,000 characters; `isError` surfaced; **invalid JSON arguments become a tool error**; **an unknown tool is reported to the model**; **an LLM error after a tool call keeps the trace**; timeout with a partial result (also while waiting on the model, and before a tool call, where the reply says no actions ran); an empty or whitespace-only final answer becomes the fixed "I couldn't produce an answer" reply; descriptions cut to 300; a result cannot close its own `<tool_result>`; the prompt's date and weekday in the store zone, its rules, plain text and no guessed currency |
| `/api/chat` (Phase 4) | `api/chat.test.ts` (14) | Tools called as the session user (audit `source=chat`, no key id), the `chat turn` log line without message text or JWTs, `nosniff`/`no-store` headers; 503 not configured (no upstream request); 401 and CSRF; every body validation case; the largest valid body (512 kb parser); 429 per-user with `Retry-After`; 409 in flight; a disconnecting client frees its slot; `LLM_RATE_LIMITED` → 429 with `Retry-After` and `details.toolCalls`; other LLM errors → 502; the status endpoint has no key material; a user disabled mid-turn gets a 401 tool error and an `auth_rejected` row |

### `apps/dashboard` (123 tests in 19 files, Phase 4)

Component tests run in jsdom with a mocked `fetch` (`test/helpers.tsx`); `vitest.config` includes only `test/**/*.test.{ts,tsx}`, so the Playwright specs in `e2e/` never run under `npm test`.

| Area | Files (tests) | Proves |
|---|---|---|
| API client and session | `api.test.ts` (11), `auth.test.tsx` (6), `Login.test.tsx` (16) | Error JSON to `ApiError`, JSON content type on a body-less `DELETE`, 204, network failure and non-JSON answers as `NETWORK`, an abort is not an error, `Retry-After` read; **401 redirects to login with `next`** and clears the cache, **logout treats 401 as success**, a member cannot see an admin page, an unreachable gateway shows a retry; login errors (wrong password, rate-limit seconds, network), and `safeNextPath` refusing `//evil.example` and nine other unsafe values |
| Shared components | `Button.test.tsx` (4), `ConfirmDialog.test.tsx` (7), `Dialog.test.tsx` (4), `AppShell.test.tsx` (4) | Loading and accessible names; focus moves into dialogs and back to the opener (also without a trigger, and to a fallback when the opener is gone); a non-dismissible dialog ignores Esc; the drawer's `aria-expanded`/`aria-controls`, Esc returns focus, widening closes it |
| Servers | `serverForm.test.ts` (6), `ServerFormDialog.test.tsx` (8), `Servers.test.tsx` (6), `ServerDetail.test.tsx` (1) | Slug and URL validation, **origin change requires a credential**, issue mapping to fields, no `enabled` on create, `enabled: false` on edit, a typed credential is cleared on Cancel; admin sees Add server, a member does not (after the role is known), row click opens the detail; Disable returns focus to the heading |
| Keys and team | `clientSnippets.test.ts` (2), `KeyCreatedDialog.test.tsx` (3), `Keys.test.tsx` (3), `Team.test.tsx` (12), `AcceptInvite.test.tsx` (7) | The three client setups contain the URL and the key exactly once; the one-time dialog cannot close before "I have copied the key" and leaves no storage trace; create and revoke with a confirmation; you cannot disable yourself, the issue-key form is hidden for other admins and a 409 for a disabled member is inline, a role change opens a confirm dialog first (a keyboard-style `change` sends nothing, Cancel keeps the role and returns focus to the select, the select is disabled while saving) and then sends only the role, invites list with an Expired badge and cancel, the invite link is shown once, focus stays in the row; the invite page's invalid-link state, read-only email, password mismatch and length, success, and `no-referrer` while mounted |
| Audit and chat | `AuditFilters.test.tsx` (7), `Chat.test.tsx` (8), `useChat.test.tsx` (8) | Filters round-trip through the address and members get no user filter; a prefixed tool name (`woo__create_product`) sets the server and tool filters, or keeps a different chosen server with an inline hint; the chat's not-configured state, the provider badge, **replies rendered as text, not HTML**, **executed tool calls shown on error**, Retry disabled for the `Retry-After` seconds, friendly messages for the other codes, a reply that stopped early, Shift+Enter; only role and content of the last 20 messages are sent, the user's text is kept on error, Retry resends without duplicating, an empty reply is never sent back, after a failure with tool calls the next request carries a note of what already ran and Retry asks to continue, no two user messages are ever sent back to back, New conversation clears |

The manager tests (`test/upstreams/manager.test.ts`) pin the five inputs that hurt a user most: a tool with an invalid prefixed name is skipped alone and listed in `skippedTools`; a restarted upstream gets a **fresh** client and returns to `connected` within one interval; a 302 to `169.254.169.254` is never followed (`HTTP 302 from upstream (redirects are not followed)`); a timeout leaves the server connected; a DNS-rebinding resolver is stopped at connect time. Also: a 413 fails one call only; a call cut by an upsert or remove reports `reconfigured`; a health check whose connection a failed call dropped publishes nothing; the SSRF DNS lookup is bounded by the health timeout; `findTool`; long requested names are capped at 200 characters. The suite uses a 5 s health timeout and waits for servers to connect after `start()` (refreshing any that a slow first check left unreachable), so it is stable when every test file runs in parallel.

## 4. How the fakes work

- **Database.** `test/helpers/testDb.ts` starts **PGlite**, a WebAssembly build of Postgres that runs inside the Node process, and applies the real migrations from `apps/gateway/drizzle/`. No Docker or container is needed. Differences to the real server (for example `bytea` returns a `Uint8Array`) are absorbed in one place, the `bytea` column type. The node-postgres path (`pg`) is not exercised by these tests; it was exercised by a local smoke against Postgres 17.11 in a container and by the cluster checks.
- **Fake upstreams.** `test/helpers/fakeUpstream.ts` starts a **real** MCP server on a free loopback port, built from the same `packages/shared` server the real upstreams use, with a chosen set of tool names, a chosen auth (bearer or header), an optional delay and an optional tool that returns `isError`. It records every HTTP request header so tests can prove the client's key never reaches an upstream. Tests start, stop and restart it on the same port to simulate a pod restart.
- **Harness.** `test/helpers/harness.ts` wires PGlite, an `UpstreamManager`, the real `startGateway` on port 0, an injectable clock (to move sessions, invites and the rate limiter forward) and a log sink. Loopback is allowed there (`allowLoopback`) because the fakes live on `127.0.0.1`; the production setting is off, and `SSRF_ALLOW_LOOPBACK` is never set by Helm.
- **Fake LLM (Phase 4).** `test/helpers/fakeLlm.ts` has `ScriptedLlm`, which answers a scripted list of steps (`toolStep(...)`, `finalStep(...)`) or throws a chosen `LlmError`, so the chat tests run the real agent, the real loopback client and the real `/mcp` with no provider. The adapter tests inject `fetch`, `sleep`, `random` and `now`, so backoff and deadlines are tested without waiting. `test/fixtures/gateway-tools.json` is the live 15-tool catalogue captured from the cluster (no secrets).
- **Dashboard.** `apps/dashboard/test/helpers.tsx` mocks `fetch` per URL and wraps components in the router, the query client and the auth provider; `matchMedia` is mocked with a controllable width for the drawer and card layouts.
- **Timing.** Vitest timeouts are 30 s because PGlite start-up plus argon2 take seconds when files run in parallel; the suite takes 45-60 s.

## 5. Cluster checks

### `scripts\check-gateway.ps1`

Reads the admin email and password from Secret `gateway-bootstrap` into environment variables of the script only, runs `scripts/dev/gateway-smoke.mjs`, then clears them. The Node script logs in, creates a temporary API key named `gateway-smoke <time>`, connects the MCP SDK client to `http://app.localhost/mcp`, and asserts:

- **15 tools** (woo 6, notes 5, utils 4);
- the three `ping` tools answer;
- `woo__list_orders` returns a list and `utils__calculate` returns the right number (the run printed `14`);
- the key is revoked at the end and the next request gets **401**;
- the audit API contains rows for `notes`, `utils` and `woo`.

| Option | Adds |
|---|---|
| `-Write` | `notes__create_note` and `notes__search_notes`. |
| `-Isolation` | Scales `mcp-utilities` to 0 replicas, polls until the `utils__` tools disappear (up to 45 s), checks that `woo__ping` still works, scales back to 1, polls until all 15 tools return. Restores the replica count in a `finally`, on Ctrl+C, and at the start if an earlier run was aborted. |
| `-Base <url>` | Uses another base URL, for example a `kubectl port-forward` to `svc/gateway`. |

Verified 2026-10-19: plain, `-Write` and `-Isolation` runs passed. Isolation timings: `utils__` tools gone after 12.2 s (first run) and 4.1 s (later run), back after 16.4 s both times; the whole isolation block took 28.8 s. A run interrupted by hand, with `mcp-utilities` left at 0 replicas, was healed by the next `-Isolation` run (printed `restored to 1`). The Ctrl+C handler itself was **not** exercised. The scripts never print the password, the cookie or the key.

### Other cluster checks

- Persistence: deleting `postgres-0` and letting it return kept the data (1 user, audit rows grew from 27 to 35 across runs, and the bootstrap admin was not created again) (Task 3.8).
- `SIGTERM` (after the final-review fix wave): `kubectl -n gateway rollout restart deploy/gateway` made the old pod log, in order, `shutting down: no new connections`, `shutdown: http server closed`, `shutdown: upstream clients stopped` and `shutdown: database pool closed; exiting`, about 6 s after the restart (the 5 s `preStop` sleep comes first). Before the fix wave the same command logged a single `shutting down` line and the pod was gone after 8 s.
- MCP Inspector 2.11.0 (`--cli`) against `http://app.localhost/mcp`: `tools/list` (15 tools) and `woo__list_orders` with `period=today` worked (Task 3.8), and `utils__calculate` with `expression=6*7` returned `42` while writing these docs.
- Chart: `helm lint` passes with `deploy/values-local.yaml` and `deploy/values-prod.yaml`; the rendered chart has no `SSRF_ALLOW_LOOPBACK`.
- Not tested: Claude Code and Cursor against the gateway (snippets are in the [run guide](run-guide.md#connect-claude-code-for-you-to-try) and labelled as such), a multi-replica gateway, the production values on a real cluster.

### `scripts\check-dashboard.ps1` (Playwright, Phase 4)

Checks Node 24, `node_modules/@playwright/test` (1.64.1, pinned) and that the Chromium build this Playwright version expects is installed (otherwise it prints `npx playwright install chromium` and stops; verified by pointing `PLAYWRIGHT_BROWSERS_PATH` at an empty folder). It reads the admin email and password from Secret `gateway-bootstrap` into `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` for its own process, runs `npx playwright test -c apps/dashboard/playwright.config.ts`, and clears them in `finally`. The configuration records nothing (`screenshot`, `trace` and `video` are `off`), runs one worker with no retries, and has three projects: `setup` (signs in through the login form once and saves the session to the git-ignored `apps/dashboard/e2e/.auth/`), `desktop` (1440 × 900) and `mobile` (390 × 844, touch).

| Spec | Projects | What it checks |
|---|---|---|
| `e2e/smoke.spec.ts` | desktop, mobile | Overview shows at least 3 connected servers; `woo`, `notes`, `utils` are **Connected** and `utils` lists 4 tools; a key is created, its one-time dialog checked **inside the page** (only true/false values come back, so a failure never prints the key) and revoked; the audit log has rows and the `utils` server filter works; an invite is created, its link dialog seen and the invite cancelled; on mobile the drawer navigates and servers render as cards with no table; log out returns to `/login` (it signs in separately, so the shared session survives) |
| `e2e/chat-layout.spec.ts` | mobile only | Opens `/chat` at 390 px **without sending** (any `POST /api/chat` fails the test): the composer, Send, the suggestions and New conversation are visible (or the not-configured message), and the page does not scroll sideways (`scrollWidth <= innerWidth`) |
| `e2e/chat.spec.ts` | desktop only (it spends real LLM tokens) | Skips with a reason when `GET /api/chat/status` says not configured; sends "Use the calculator: what is 6 times 7?", expects a `utils__calculate` trace marked **Succeeded** and a reply containing 42, then the newest `utils__calculate` audit row has the **Chat** source and `success` |

Verified 2026-10-22 on images `8f6b79f` (the final-review fix wave): **17 tests, 16 passed, 1 skipped** (the mobile-only drawer test on the desktop project, by design), 18.0 s, exit 0, including the new phone-width chat check and one live chat turn (`utils__calculate`, 3,167 tokens). Earlier, on images `e799bcd` (2026-10-19): 16 tests, 15 passed, 1 skipped. Each run leaves two revoked keys named `e2e …` and cancelled invites. **Not tested:** the chat spec's skip path (the Secret was left in place), sending a chat message at phone width (only the layout is checked there, to save tokens), the invite accept page and server edits on the cluster (component and API tests only).

### Live chat checks (Phase 4)

On 2026-10-19, with Groq `openai/gpt-oss-120b` and no fallback, through the browser on the deployed images: four prompts each called the expected tool with success (`woo__create_product` → draft #36, `woo__list_orders` → the COD order #33 placed by `scripts\dev\customer-order-smoke.ps1`, `notes__create_note`, `notes__list_notes`), each tool call appeared in the Audit page with source **Chat**, and the draft products showed in wp-admin. Each single-tool turn cost 3.1-3.3K tokens (two model calls); a four-tool turn 9.1K. The first round showed Markdown and a guessed ₹ currency; the system prompt was fixed (plain text, currency only from a tool result), redeployed and re-checked. The `chat turn` log lines contained no message text. On 2026-10-20 one turn was also captured at the wire level for [learning/04-chat-agent.md](learning/04-chat-agent.md) (3,151 tokens).

## 6. Not yet in place

`scripts/smoke-test.ps1`, NetworkPolicy probes and `npm audit` (Phase 5), the complete strategy and a coverage statement (Phase 6). Gaps noted in Phase 4 reviews and deferred: no unit tests for the Overview page, the responsive table's card branch, theme persistence or the status badge labels (the Playwright mobile run covers the cards); no test that counts internal-token mints per loopback request; the `useChat` race guards (double send, reset mid-turn, unmount) and the 4,000-character clipping are untested; the audit filters do not reject a `from` later than `to`.
