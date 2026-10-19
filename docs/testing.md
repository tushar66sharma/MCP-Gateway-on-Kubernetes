# Testing

> **Status: partial (end of Phase 3).** Covers the automated tests and cluster checks that exist today (shared package, the three MCP servers and the gateway). The dashboard tests, the Playwright smoke test, the NetworkPolicy checks and `scripts/smoke-test.ps1` belong to Phases 4-5 and do not exist yet. The complete document is Phase 6.

Test counts below come from a full run on 2026-10-19 (`npm test` from the repository root: **362 tests, all passing**).

## 1. The layers

| Layer | What it proves | Tools |
|---|---|---|
| Unit | Pure logic: naming, crypto, SSRF classification, calculator, period maths, error descriptions | Vitest |
| Integration, in process | The real gateway code over a real (in-memory) Postgres and real MCP over HTTP, against fake upstream servers | Vitest, PGlite, supertest, the MCP SDK client |
| Chart render | The Helm templates produce what the code expects | `helm lint`, `helm template` |
| Cluster end to end | The deployed system works: login, key, `/mcp`, audit, isolation | `scripts\check-gateway.ps1`, `scripts\check-mcp-woocommerce.ps1` |
| Manual | MCP Inspector against `http://app.localhost/mcp`; the PowerShell snippets in the run guide | by hand |

## 2. Commands

Run from the repository root.

| Command | Does |
|---|---|
| `npm ci` | Install the pinned packages (once; Node 24). |
| `npm test` | Runs `vitest run` in every workspace, about 60 s (the gateway suite is most of it). |
| `npm test -w @urumi/gateway` | Only the gateway (also `@urumi/shared`, `@urumi/mcp-notes`, `@urumi/mcp-utilities`, `@urumi/mcp-woocommerce`). |
| `npm test -w @urumi/gateway -- test/upstreams` | Only the files under one folder. |
| `npm run typecheck` | Builds `packages/shared`, then `tsc --noEmit` per workspace. |
| `npm run lint` | ESLint over the whole repository. |
| `helm lint charts/urumi-platform -f deploy/values-local.yaml` (and `-f deploy/values-prod.yaml`) | Chart lint. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-gateway.ps1` | Cluster end-to-end check, read-only calls. Add `-Write` and/or `-Isolation`. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1` | The WooCommerce MCP server check through a port-forward (`-Write` also creates a draft product). |

## 3. What each suite proves (counts from the 2026-10-19 run)

### `packages/shared` (52 tests)

| File | Tests | Proves |
|---|---|---|
| `mcpHttpServer.test.ts` | 20 | The shared MCP HTTP server: Host check before auth, auth hook (a function or a bearer/header config), `extraRoutes`, request ids, `logPath` redaction of mounted paths, 405, malformed JSON, 413, probes, exactly one of `registerTools` or `buildServer` |
| `upstreamAuth.test.ts` | 12 | The bearer and header upstream auth middleware (timing-safe compare) |
| `logger.test.ts` | 7 | Secret redaction, including keys ending in `key` or `secret` |
| `period.test.ts` | 7 | `today`, `yesterday`, `last_7_days` in a time zone |
| `env.test.ts` | 3 | The env loader names variables, never values |
| `tools.test.ts` | 3 | `defineTool`, `registerTools`, `ok`, `toolError` |

### The three upstream servers

| Workspace | Tests | Proves |
|---|---|---|
| `mcp-notes` | 11 | The in-memory store (limits, ids never reused, search) and the five tools over HTTP, including a 401 without the bearer token |
| `mcp-utilities` | 27 | The hand-written calculator (precedence, `^` right-associative, `-2^2`, nesting depth, division by zero, no `eval`), the time tools, header auth |
| `mcp-woocommerce` | 70 | OAuth1 signing against a known vector, the REST client (timeouts, redirects not followed, redaction), the six tools, the server |

### `apps/gateway` (202 tests in 21 files)

| Area | Files (tests) | Proves |
|---|---|---|
| Config and scaffold | `config.test.ts` (10), `scaffold.test.ts` (9), `api.test.ts` (3) | Env validation names variables only; the 32-byte key rule; `SEED_SERVERS` rules; the six tables exist; foreign key actions; `/healthz`, `/readyz` (503 until the database answers); the startup retry succeeds and gives up; error shapes; invite tokens redacted in logs |
| Security | `crypto.test.ts` (6), `passwords.test.ts` (2), `ssrf.test.ts` (39) | AES-GCM round trip, tampering, wrong associated data, unique nonces; argon2id; SSRF: metadata, private, loopback and IPv6 forms, DNS failure, allow-list, connect-time lookup |
| Auth | `bearer.test.ts` (13), `internalToken.test.ts` (3), `rateLimit.test.ts` (1) | API keys and the HS256-only internal token, revoked and disabled users, the limiter window |
| API | `auth` (15), `invites` (9), `keys` (7), `users` (5), `servers` (12), `audit` (5), `trustProxy` (2) | Login (case and whitespace in emails, one answer for every failure, 429), CSRF, sessions, invite lifecycle (single use, 72 h, conflict), key lifecycle and ownership, role checks, server CRUD without any credential in any response, audit filters and pagination, `TRUST_PROXY` |
| Upstreams | `naming` (8), `errors` (15), `seed` (5), `manager` (20) | Naming and the 64-character rule; the `lastError` texts derived from real SDK errors; seeding is insert-if-absent; the manager (below) |
| `/mcp` | `endpoint.test.ts` (13) | The aggregated list, routing, collision prefixes, per-user audit, 401 variants and their audit rows, `isError` becomes outcome `error`, unknown tool becomes `denied`, no secrets in logs |

The manager tests (`test/upstreams/manager.test.ts`) pin the five inputs that hurt a user most: a tool with an invalid prefixed name is skipped alone and listed in `skippedTools`; a restarted upstream gets a **fresh** client and returns to `connected` within one interval; a 302 to `169.254.169.254` is never followed (`HTTP 302 from upstream (redirects are not followed)`); a timeout leaves the server connected; a DNS-rebinding resolver is stopped at connect time.

## 4. How the fakes work

- **Database.** `test/helpers/testDb.ts` starts **PGlite**, a WebAssembly build of Postgres that runs inside the Node process, and applies the real migrations from `apps/gateway/drizzle/`. No Docker or container is needed. Differences to the real server (for example `bytea` returns a `Uint8Array`) are absorbed in one place, the `bytea` column type. The node-postgres path (`pg`) is not exercised by these tests; it was exercised by a local smoke against Postgres 17.11 in a container and by the cluster checks.
- **Fake upstreams.** `test/helpers/fakeUpstream.ts` starts a **real** MCP server on a free loopback port, built from the same `packages/shared` server the real upstreams use, with a chosen set of tool names, a chosen auth (bearer or header), an optional delay and an optional tool that returns `isError`. It records every HTTP request header so tests can prove the client's key never reaches an upstream. Tests start, stop and restart it on the same port to simulate a pod restart.
- **Harness.** `test/helpers/harness.ts` wires PGlite, an `UpstreamManager`, the real `startGateway` on port 0, an injectable clock (to move sessions, invites and the rate limiter forward) and a log sink. Loopback is allowed there (`allowLoopback`) because the fakes live on `127.0.0.1`; the production setting is off, and `SSRF_ALLOW_LOOPBACK` is never set by Helm.
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
- `SIGTERM`: `kubectl -n gateway rollout restart deploy/gateway` logged `shutting down` and the old pod was gone after 8 s.
- MCP Inspector 2.11.0 (`--cli`) against `http://app.localhost/mcp`: `tools/list` (15 tools) and `woo__list_orders` with `period=today` worked (Task 3.8), and `utils__calculate` with `expression=6*7` returned `42` while writing these docs.
- Chart: `helm lint` passes with `deploy/values-local.yaml` and `deploy/values-prod.yaml`; the rendered chart has no `SSRF_ALLOW_LOOPBACK`.
- Not tested: Claude Code and Cursor against the gateway (snippets are in the [run guide](run-guide.md#connect-claude-code-for-you-to-try) and labelled as such), a multi-replica gateway, the production values on a real cluster.

## 6. Not yet in place

Dashboard component tests and Playwright (Phase 4), `scripts/smoke-test.ps1`, NetworkPolicy probes and `npm audit` (Phase 5), the complete strategy and a coverage statement (Phase 6).
